import asyncio
import hashlib
import json
import logging
import os
import subprocess
import sys

import numpy as np
from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from ytmusicapi import YTMusic

from audio_source import (
    TrackQuery,
    cache_embedding,
    cache_features,
    get_all_cached_embeddings,
    get_all_cached_features,
    get_cached_embedding,
    get_cached_features,
    get_cached_match,
    search_and_download,
)
from feature_extract import extract_features
from tf_extract import extract_embedding

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="UMAP Service", version="0.2.0")

# Unauthenticated YTMusic client — sufficient for search
_yt: YTMusic | None = None


def get_yt() -> YTMusic:
    global _yt
    if _yt is None:
        _yt = YTMusic()
    return _yt


class HealthResponse(BaseModel):
    status: str


@app.get("/health", response_model=HealthResponse)
async def health():
    return HealthResponse(status="ok")


# ─── UMAP (Phase 4c) ────────────────────────────────────────────────────────


class UMAPRequest(BaseModel):
    track_ids: list[str]
    features: dict[str, list[float]]
    raw_features: dict[str, list[float]] | None = None
    n_neighbors: int = 15
    min_dist: float = 0.1


class AxisLabel(BaseModel):
    name: str
    correlation: float  # Pearson r, can be negative
    direction_low: str
    direction_high: str


class UMAPResponse(BaseModel):
    coordinates: dict[str, list[float]]
    x_axis: AxisLabel | None = None
    y_axis: AxisLabel | None = None


def _compute_umap(
    track_ids: list[str],
    features: dict[str, list[float]],
    raw_features: dict[str, list[float]] | None,
    n_neighbors: int,
    min_dist: float,
) -> UMAPResponse:
    from feature_extract import AXIS_FEATURE_NAMES

    # Filter to tracks that have features
    valid_ids = [tid for tid in track_ids if tid in features]
    if len(valid_ids) < 5:
        return UMAPResponse(coordinates={})

    matrix = np.array([features[tid] for tid in valid_ids], dtype=np.float64)

    # Check cache
    cache_key = hashlib.sha256(matrix.tobytes()).hexdigest()[:16]
    cached = _get_umap_cache(cache_key)
    if cached is not None:
        return UMAPResponse(coordinates=cached)

    # Run PCA + UMAP in a subprocess to avoid numba/TF mutex conflict
    coords_list = _run_umap_subprocess(matrix, n_neighbors, min_dist)

    coordinates = {tid: coords_list[i] for i, tid in enumerate(valid_ids)}
    _cache_umap(cache_key, coordinates)

    # Compute axis correlations using raw features (interpretable dimensions)
    x_axis = None
    y_axis = None
    if raw_features:
        raw_ids = [tid for tid in valid_ids if tid in raw_features]
        if len(raw_ids) > 10:
            raw_matrix = np.array([raw_features[tid] for tid in raw_ids], dtype=np.float64)
            raw_coords_x = np.array([coordinates[tid][0] for tid in raw_ids])
            raw_coords_y = np.array([coordinates[tid][1] for tid in raw_ids])
            x_axis = _best_axis_correlation(raw_matrix, raw_coords_x, AXIS_FEATURE_NAMES)
            y_axis = _best_axis_correlation(raw_matrix, raw_coords_y, AXIS_FEATURE_NAMES)

    return UMAPResponse(coordinates=coordinates, x_axis=x_axis, y_axis=y_axis)


def _run_umap_subprocess(matrix: np.ndarray, n_neighbors: int, min_dist: float) -> list[list[float]]:
    """Run PCA + UMAP in a subprocess to isolate numba from TensorFlow."""
    script = """
import sys, json, numpy as np
from sklearn.preprocessing import StandardScaler
from sklearn.decomposition import PCA
from umap import UMAP

data = json.loads(sys.stdin.read())
matrix = np.array(data["matrix"], dtype=np.float64)
n_neighbors = data["n_neighbors"]
min_dist = data["min_dist"]

normalized = StandardScaler().fit_transform(matrix)
normalized = np.nan_to_num(normalized, nan=0.0, posinf=0.0, neginf=0.0)

if normalized.shape[1] > 50:
    n_comp = min(50, normalized.shape[0] - 1)
    normalized = PCA(n_components=n_comp, random_state=42).fit_transform(normalized)

eff_neighbors = max(2, min(n_neighbors, matrix.shape[0] - 1))
coords = UMAP(n_components=2, n_neighbors=eff_neighbors, min_dist=min_dist, random_state=42, n_jobs=1).fit_transform(normalized)
print(json.dumps(coords.tolist()))
"""
    input_data = json.dumps({
        "matrix": matrix.tolist(),
        "n_neighbors": n_neighbors,
        "min_dist": min_dist,
    })
    result = subprocess.run(
        [sys.executable, "-c", script],
        input=input_data,
        capture_output=True,
        text=True,
        timeout=300,
    )
    if result.returncode != 0:
        raise RuntimeError(f"UMAP subprocess failed: {result.stderr}")
    return json.loads(result.stdout)


def _run_hdbscan_subprocess(matrix: np.ndarray, min_cluster_size: int) -> list[int]:
    """Run HDBSCAN in a subprocess to isolate numba from TensorFlow."""
    script = """
import sys, json, numpy as np
from hdbscan import HDBSCAN

data = json.loads(sys.stdin.read())
matrix = np.array(data["matrix"], dtype=np.float64)
labels = HDBSCAN(min_cluster_size=data["min_cluster_size"], min_samples=3).fit_predict(matrix)
print(json.dumps(labels.tolist()))
"""
    input_data = json.dumps({
        "matrix": matrix.tolist(),
        "min_cluster_size": min_cluster_size,
    })
    result = subprocess.run(
        [sys.executable, "-c", script],
        input=input_data,
        capture_output=True,
        text=True,
        timeout=60,
    )
    if result.returncode != 0:
        raise RuntimeError(f"HDBSCAN subprocess failed: {result.stderr}")
    return json.loads(result.stdout)


# Direction hints for named features (low → high)
_FEATURE_DIRECTIONS: dict[str, tuple[str, str]] = {
    "Brightness": ("Dark", "Bright"),
    "BPM": ("Slow", "Fast"),
    "Beat Strength": ("Weak Beat", "Strong Beat"),
    "Key": ("Low Key", "High Key"),
    "Major/Minor": ("Minor", "Major"),
    "Key Confidence": ("Ambiguous Key", "Clear Key"),
    "Loudness": ("Quiet", "Loud"),
    "Loudness Range": ("Compressed", "Dynamic"),
    "Dynamic Range": ("Flat", "Dynamic"),
    "Danceability": ("Still", "Danceable"),
    "Energy": ("Calm", "Energetic"),
    "RMS": ("Soft", "Loud"),
    "Noisiness": ("Clean", "Noisy"),
    "High-Freq Energy": ("Mellow", "Crisp"),
    "Tonal vs Noise": ("Tonal", "Noisy"),
}


def _best_axis_correlation(
    feature_matrix: "np.ndarray",
    axis_coords: "np.ndarray",
    names: list[str],
) -> AxisLabel | None:

    best_name = ""
    best_r = 0.0

    for i, name in enumerate(names):
        if not name:  # skip MFCCs
            continue
        col = feature_matrix[:, i]
        if np.std(col) < 1e-10:
            continue
        r = float(np.corrcoef(col, axis_coords)[0, 1])
        if abs(r) > abs(best_r):
            best_r = r
            best_name = name

    if not best_name:
        return None

    low, high = _FEATURE_DIRECTIONS.get(best_name, ("Low", "High"))
    if best_r < 0:
        low, high = high, low

    return AxisLabel(
        name=best_name,
        correlation=round(best_r, 3),
        direction_low=low,
        direction_high=high,
    )


def _get_umap_cache(cache_key: str) -> dict[str, list[float]] | None:
    from audio_source import _get_db
    conn = _get_db()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS umap_cache (
            cache_key TEXT PRIMARY KEY,
            coordinates TEXT NOT NULL
        )
    """)
    row = conn.execute(
        "SELECT coordinates FROM umap_cache WHERE cache_key = ?", (cache_key,)
    ).fetchone()
    conn.close()
    if row is None:
        return None
    return json.loads(row[0])


def _cache_umap(cache_key: str, coordinates: dict[str, list[float]]) -> None:
    from audio_source import _get_db
    conn = _get_db()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS umap_cache (
            cache_key TEXT PRIMARY KEY,
            coordinates TEXT NOT NULL
        )
    """)
    conn.execute(
        "INSERT OR REPLACE INTO umap_cache (cache_key, coordinates) VALUES (?, ?)",
        (cache_key, json.dumps(coordinates)),
    )
    conn.commit()
    conn.close()


@app.post("/umap", response_model=UMAPResponse)
async def compute_umap(request: UMAPRequest):
    """Run UMAP on feature vectors. Z-score normalizes, caches by feature hash."""
    return await asyncio.to_thread(
        _compute_umap,
        request.track_ids,
        request.features,
        request.raw_features,
        request.n_neighbors,
        request.min_dist,
    )


# ─── Cluster detection (Phase 7) ─────────────────────────────────────────────


class ClusterRequest(BaseModel):
    coordinates: dict[str, list[float]]  # spotify_id -> [x, y] from UMAP
    playlist_tracks: dict[str, list[str | None]]  # playlist_id -> [track_ids], may contain nulls
    min_cluster_size: int = 5


class ClusterInsight(BaseModel):
    type: str  # "potential_playlist" or "discordant_playlist"
    title: str
    description: str
    track_ids: list[str]
    score: float


class ClusterResponse(BaseModel):
    labels: dict[str, int]  # spotify_id -> cluster label (-1 = noise)
    insights: list[ClusterInsight]


def _compute_clusters(
    coordinates: dict[str, list[float]],
    playlist_tracks: dict[str, list[str]],
    min_cluster_size: int,
) -> ClusterResponse:

    track_ids = list(coordinates.keys())
    if len(track_ids) < min_cluster_size:
        return ClusterResponse(labels={}, insights=[])

    matrix = np.array([coordinates[tid] for tid in track_ids], dtype=np.float64)

    labels_list = _run_hdbscan_subprocess(matrix, min_cluster_size)

    label_map = {tid: labels_list[i] for i, tid in enumerate(track_ids)}

    # Build reverse map: cluster_id -> set of track_ids
    clusters: dict[int, list[str]] = {}
    for tid, label in label_map.items():
        if label == -1:
            continue  # noise
        clusters.setdefault(label, []).append(tid)

    # Build reverse map: track_id -> set of playlist_ids (filter nulls)
    track_to_playlists: dict[str, set[str]] = {}
    clean_playlist_tracks: dict[str, list[str]] = {}
    for pid, tids in playlist_tracks.items():
        clean = [tid for tid in tids if tid is not None]
        clean_playlist_tracks[pid] = clean
        for tid in clean:
            track_to_playlists.setdefault(tid, set()).add(pid)

    insights: list[ClusterInsight] = []

    # 1. Potential playlists: clusters where tracks share no common playlist
    for cluster_id, cluster_tids in clusters.items():
        if len(cluster_tids) < min_cluster_size:
            continue

        # Find playlists shared by ALL tracks in this cluster
        playlist_sets = [track_to_playlists.get(tid, set()) for tid in cluster_tids]
        common = set.intersection(*playlist_sets) if playlist_sets else set()

        # Tracks not in any playlist at all
        unplaylisted = [tid for tid in cluster_tids if tid not in track_to_playlists]
        unplaylisted_ratio = len(unplaylisted) / len(cluster_tids)

        if not common and unplaylisted_ratio > 0.3:
            insights.append(ClusterInsight(
                type="potential_playlist",
                title=f"Cluster {cluster_id} ({len(cluster_tids)} songs)",
                description=f"{len(cluster_tids)} similar songs with no shared playlist. "
                            f"{len(unplaylisted)} aren't in any playlist.",
                track_ids=cluster_tids,
                score=unplaylisted_ratio,
            ))

    # 2. Discordant playlists: playlists whose tracks are scattered across many clusters
    for pid, tids in clean_playlist_tracks.items():
        # Only consider tracks that have UMAP coordinates
        mapped_tids = [tid for tid in tids if tid in label_map]
        if len(mapped_tids) < 5:
            continue

        cluster_labels = [label_map[tid] for tid in mapped_tids]
        non_noise = [l for l in cluster_labels if l != -1]
        if len(non_noise) < 3:
            continue

        unique_clusters = set(non_noise)
        scatter_ratio = len(unique_clusters) / len(non_noise)

        if scatter_ratio > 0.5 and len(unique_clusters) >= 3:
            insights.append(ClusterInsight(
                type="discordant_playlist",
                title=pid,  # Will be resolved to name on the client
                description=f"{len(mapped_tids)} tracks spread across {len(unique_clusters)} clusters "
                            f"(scatter ratio: {scatter_ratio:.0%})",
                track_ids=mapped_tids,
                score=scatter_ratio,
            ))

    # Sort: potential playlists by size desc, discordant by scatter desc
    insights.sort(key=lambda i: -i.score)

    return ClusterResponse(labels=label_map, insights=insights)


@app.post("/cluster", response_model=ClusterResponse)
async def compute_clusters(request: ClusterRequest):
    """Run HDBSCAN on UMAP coordinates. Returns cluster labels and insights."""
    result = await asyncio.to_thread(
        _compute_clusters,
        request.coordinates,
        request.playlist_tracks,
        request.min_cluster_size,
    )
    return result


# ─── Cached features ─────────────────────────────────────────────────────────


@app.get("/features")
async def get_cached():
    """Return all cached TF embeddings (for UMAP) and raw features (for overlay)."""
    all_embeddings = await asyncio.to_thread(get_all_cached_embeddings)
    all_raw = await asyncio.to_thread(get_all_cached_features)
    return {
        "features": all_embeddings,
        "raw_features": all_raw,
        "count": len(all_embeddings),
    }


# ─── Audio sourcing (Phase 4a) ──────────────────────────────────────────────


class TrackInput(BaseModel):
    spotify_id: str
    name: str
    artist: str
    duration_ms: int


class FeaturesRequest(BaseModel):
    tracks: list[TrackInput]


@app.post("/features")
async def run_feature_extraction(body: FeaturesRequest, request: Request):
    """Search YouTube Music, download audio, extract Essentia features, cache results.

    Returns SSE stream with progress events and final results.
    """

    async def generate():
        def send(obj: dict):
            return f"data: {json.dumps(obj)}\n\n"

        yt = get_yt()
        total = len(body.tracks)
        extracted = 0
        failed = 0

        for i, track in enumerate(body.tracks):
            # Stop if client disconnected
            if await request.is_disconnected():
                logger.info("Client disconnected, stopping extraction at %d/%d", i, total)
                return
            # Skip if we already have cached TF embedding
            cached_emb = await asyncio.to_thread(get_cached_embedding, track.spotify_id)
            if cached_emb is not None:
                extracted += 1
                yield send({
                    "type": "progress",
                    "message": f"Cached: {track.name}",
                    "current": i + 1,
                    "total": total,
                    "extracted": extracted,
                    "failed": failed,
                    "feature": {track.spotify_id: cached_emb},
                })
                continue

            query = TrackQuery(
                spotify_id=track.spotify_id,
                name=track.name,
                artist=track.artist,
                duration_ms=track.duration_ms,
            )

            yield send({
                "type": "progress",
                "message": f"Processing: {track.name} — {track.artist}",
                "current": i + 1,
                "total": total,
                "extracted": extracted,
                "failed": failed,
            })

            # Search + download (persistent directory, checks cache)
            result = await asyncio.to_thread(
                search_and_download, yt, query
            )

            if result is None:
                failed += 1
                continue

            # Extract TF embedding (for UMAP)
            embedding = await asyncio.to_thread(
                extract_embedding, result.file_path
            )

            # Extract raw features (for "Color by" overlay) — non-critical
            raw_features = await asyncio.to_thread(
                extract_features, result.file_path
            )

            if embedding is not None:
                await asyncio.to_thread(
                    cache_embedding, track.spotify_id, embedding
                )
                if raw_features is not None:
                    await asyncio.to_thread(
                        cache_features, track.spotify_id, raw_features
                    )
                extracted += 1
                yield send({
                    "type": "progress",
                    "message": f"Extracted: {track.name}",
                    "current": i + 1,
                    "total": total,
                    "extracted": extracted,
                    "failed": failed,
                    "feature": {track.spotify_id: embedding},
                })
            else:
                failed += 1

        # Return summary with all cached embeddings
        all_embeddings = await asyncio.to_thread(get_all_cached_embeddings)
        yield send({
            "type": "complete",
            "extracted": extracted,
            "failed": failed,
            "total": total,
            "cached_total": len(all_embeddings),
            "features": all_embeddings,
        })

    return StreamingResponse(generate(), media_type="text/event-stream")


# ─── Query cached matches ───────────────────────────────────────────────────


@app.get("/downloads")
async def list_downloads():
    """Return all cached audio downloads with file status (debug endpoint)."""
    from audio_source import get_all_downloads
    downloads = await asyncio.to_thread(get_all_downloads)
    total_size = sum(d["file_size"] for d in downloads if d["exists"])
    return {
        "downloads": downloads,
        "count": len(downloads),
        "on_disk": sum(1 for d in downloads if d["exists"]),
        "total_size_mb": round(total_size / (1024 * 1024), 1),
    }


@app.get("/matches")
async def list_matches():
    """Return all cached YouTube Music matches with feature status."""
    from audio_source import get_all_cached_matches
    matches = get_all_cached_matches()
    all_features = get_all_cached_features()
    return [
        {
            "spotify_id": m.spotify_id,
            "video_id": m.video_id,
            "title": m.title,
            "artist": m.artist,
            "duration_s": m.duration_s,
            "youtube_url": f"https://music.youtube.com/watch?v={m.video_id}",
            "has_features": m.spotify_id in all_features,
        }
        for m in matches
    ]
