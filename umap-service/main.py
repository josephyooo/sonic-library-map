import asyncio
import json
import logging
import os
import tempfile

from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from ytmusicapi import YTMusic

from audio_source import (
    TrackQuery,
    cache_features,
    get_all_cached_features,
    get_cached_features,
    get_cached_match,
    search_and_download,
)
from feature_extract import extract_features

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
    n_neighbors: int = 15
    min_dist: float = 0.1


class UMAPResponse(BaseModel):
    coordinates: dict[str, list[float]]


def _compute_umap(
    track_ids: list[str],
    features: dict[str, list[float]],
    n_neighbors: int,
    min_dist: float,
) -> dict[str, list[float]]:
    import hashlib
    import numpy as np
    from sklearn.preprocessing import StandardScaler
    from umap import UMAP

    # Filter to tracks that have features
    valid_ids = [tid for tid in track_ids if tid in features]
    if len(valid_ids) < 2:
        return {}

    matrix = np.array([features[tid] for tid in valid_ids], dtype=np.float64)

    # Check cache
    cache_key = hashlib.sha256(matrix.tobytes()).hexdigest()[:16]
    cached = _get_umap_cache(cache_key)
    if cached is not None:
        return cached

    # Z-score normalize
    scaler = StandardScaler()
    matrix = scaler.fit_transform(matrix)

    # Replace any NaN/inf from constant features with 0
    matrix = np.nan_to_num(matrix, nan=0.0, posinf=0.0, neginf=0.0)

    # Clamp n_neighbors to valid range
    effective_neighbors = min(n_neighbors, len(valid_ids) - 1)
    if effective_neighbors < 2:
        effective_neighbors = 2

    reducer = UMAP(
        n_components=2,
        n_neighbors=effective_neighbors,
        min_dist=min_dist,
        random_state=42,
        n_jobs=1,
    )
    coords = reducer.fit_transform(matrix)

    result = {tid: coords[i].tolist() for i, tid in enumerate(valid_ids)}
    _cache_umap(cache_key, result)
    return result


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
    coords = await asyncio.to_thread(
        _compute_umap,
        request.track_ids,
        request.features,
        request.n_neighbors,
        request.min_dist,
    )
    return UMAPResponse(coordinates=coords)


# ─── Audio sourcing (Phase 4a) ──────────────────────────────────────────────


class TrackInput(BaseModel):
    spotify_id: str
    name: str
    artist: str
    duration_ms: int


class FeaturesRequest(BaseModel):
    tracks: list[TrackInput]


@app.post("/features")
async def run_feature_extraction(request: FeaturesRequest):
    """Search YouTube Music, download audio, extract Essentia features, cache results.

    Returns SSE stream with progress events and final results.
    Audio files are deleted immediately after feature extraction.
    """

    async def generate():
        def send(obj: dict):
            return f"data: {json.dumps(obj)}\n\n"

        yt = get_yt()
        total = len(request.tracks)
        extracted = 0
        failed = 0

        with tempfile.TemporaryDirectory() as tmpdir:
            for i, track in enumerate(request.tracks):
                # Skip if we already have cached features
                cached = await asyncio.to_thread(get_cached_features, track.spotify_id)
                if cached is not None:
                    extracted += 1
                    yield send({
                        "type": "progress",
                        "message": f"Cached: {track.name}",
                        "current": i + 1,
                        "total": total,
                        "extracted": extracted,
                        "failed": failed,
                        "feature": {track.spotify_id: cached},
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

                # Search + download
                result = await asyncio.to_thread(
                    search_and_download, yt, query, tmpdir
                )

                if result is None:
                    failed += 1
                    continue

                # Extract features with Essentia
                features = await asyncio.to_thread(
                    extract_features, result.file_path
                )

                # Delete audio immediately
                if os.path.exists(result.file_path):
                    os.remove(result.file_path)

                if features is not None:
                    await asyncio.to_thread(
                        cache_features, track.spotify_id, features
                    )
                    extracted += 1
                    yield send({
                        "type": "progress",
                        "message": f"Extracted: {track.name}",
                        "current": i + 1,
                        "total": total,
                        "extracted": extracted,
                        "failed": failed,
                        "feature": {track.spotify_id: features},
                    })
                else:
                    failed += 1

            # Return summary with all cached features
            all_features = await asyncio.to_thread(get_all_cached_features)
            yield send({
                "type": "complete",
                "extracted": extracted,
                "failed": failed,
                "total": total,
                "cached_total": len(all_features),
                "features": all_features,
            })

    return StreamingResponse(generate(), media_type="text/event-stream")


# ─── Query cached matches ───────────────────────────────────────────────────


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
