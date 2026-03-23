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
    get_all_cached_matches,
    get_cached_match,
    search_and_download,
)

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


# ─── UMAP (placeholder, Phase 4c) ───────────────────────────────────────────


class UMAPRequest(BaseModel):
    features: list[list[float]]
    n_neighbors: int = 15
    min_dist: float = 0.1


class UMAPResponse(BaseModel):
    coordinates: list[list[float]]


@app.post("/umap", response_model=UMAPResponse)
async def compute_umap(request: UMAPRequest):
    """Placeholder — will implement UMAP computation in Phase 4c."""
    return UMAPResponse(coordinates=[[0.0, 0.0] for _ in request.features])


# ─── Audio sourcing (Phase 4a) ──────────────────────────────────────────────


class TrackInput(BaseModel):
    spotify_id: str
    name: str
    artist: str
    duration_ms: int


class FeaturesRequest(BaseModel):
    tracks: list[TrackInput]


@app.post("/features")
async def extract_features(request: FeaturesRequest):
    """Search YouTube Music, download audio, and extract features.

    Returns SSE stream with progress events and final results.
    Phase 4a: search + download only. Essentia extraction added in Phase 4b.
    """

    async def generate():
        def send(obj: dict):
            return f"data: {json.dumps(obj)}\n\n"

        yt = get_yt()
        total = len(request.tracks)
        matched = 0
        failed = 0

        with tempfile.TemporaryDirectory() as tmpdir:
            for i, track in enumerate(request.tracks):
                # Skip if we already have cached features for this track
                cached = await asyncio.to_thread(get_cached_match, track.spotify_id)
                if cached is not None:
                    matched += 1
                    yield send({
                        "type": "progress",
                        "message": f"Cached: {track.name}",
                        "current": i + 1,
                        "total": total,
                        "matched": matched,
                        "failed": failed,
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
                    "message": f"Searching: {track.name} — {track.artist}",
                    "current": i + 1,
                    "total": total,
                    "matched": matched,
                    "failed": failed,
                })

                result = await asyncio.to_thread(
                    search_and_download, yt, query, tmpdir
                )

                if result is not None:
                    matched += 1
                    # Delete audio file immediately (Phase 4b will process before deleting)
                    if os.path.exists(result.file_path):
                        os.remove(result.file_path)
                else:
                    failed += 1

            # Return summary
            all_matches = await asyncio.to_thread(get_all_cached_matches)
            yield send({
                "type": "complete",
                "matched": matched,
                "failed": failed,
                "total": total,
                "cached_total": len(all_matches),
            })

    return StreamingResponse(generate(), media_type="text/event-stream")


# ─── Query cached matches ───────────────────────────────────────────────────


@app.get("/matches")
async def list_matches():
    """Return all cached YouTube Music matches."""
    matches = get_all_cached_matches()
    return [
        {
            "spotify_id": m.spotify_id,
            "video_id": m.video_id,
            "title": m.title,
            "artist": m.artist,
            "duration_s": m.duration_s,
            "youtube_url": f"https://music.youtube.com/watch?v={m.video_id}",
        }
        for m in matches
    ]
