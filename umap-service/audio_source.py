"""YouTube Music search + yt-dlp download for audio sourcing.

Spotify's audio-features endpoint and preview_url are both unavailable for new apps.
This module finds matching tracks on YouTube Music and downloads audio for
feature extraction by Essentia (Phase 4b).

Audio files are temporary — deleted after processing. Only the YouTube video ID
and extracted features are cached.
"""

import json
import logging
import os
import re
import sqlite3
import tempfile
from dataclasses import dataclass

import yt_dlp
from ytmusicapi import YTMusic

logger = logging.getLogger(__name__)

DB_PATH = os.environ.get("FEATURES_DB_PATH", os.path.join(os.path.dirname(__file__), "data", "features.db"))


@dataclass
class TrackQuery:
    spotify_id: str
    name: str
    artist: str
    duration_ms: int


@dataclass
class MatchResult:
    spotify_id: str
    video_id: str
    title: str
    artist: str
    duration_s: int


@dataclass
class DownloadResult:
    spotify_id: str
    video_id: str
    file_path: str
    duration_s: int


# ─── Database ────────────────────────────────────────────────────────────────

def _get_db() -> sqlite3.Connection:
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS youtube_matches (
            spotify_id TEXT PRIMARY KEY,
            video_id TEXT NOT NULL,
            title TEXT NOT NULL,
            artist TEXT NOT NULL,
            duration_s INTEGER NOT NULL
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS audio_features (
            spotify_id TEXT PRIMARY KEY,
            features TEXT NOT NULL,
            FOREIGN KEY (spotify_id) REFERENCES youtube_matches(spotify_id)
        )
    """)
    conn.commit()
    return conn


def get_cached_match(spotify_id: str) -> MatchResult | None:
    conn = _get_db()
    row = conn.execute(
        "SELECT spotify_id, video_id, title, artist, duration_s FROM youtube_matches WHERE spotify_id = ?",
        (spotify_id,),
    ).fetchone()
    conn.close()
    if row is None:
        return None
    return MatchResult(*row)


def cache_match(match: MatchResult) -> None:
    conn = _get_db()
    conn.execute(
        "INSERT OR REPLACE INTO youtube_matches (spotify_id, video_id, title, artist, duration_s) VALUES (?, ?, ?, ?, ?)",
        (match.spotify_id, match.video_id, match.title, match.artist, match.duration_s),
    )
    conn.commit()
    conn.close()


def get_all_cached_matches() -> list[MatchResult]:
    conn = _get_db()
    rows = conn.execute("SELECT spotify_id, video_id, title, artist, duration_s FROM youtube_matches").fetchall()
    conn.close()
    return [MatchResult(*row) for row in rows]


def get_cached_features(spotify_id: str) -> list[float] | None:
    conn = _get_db()
    row = conn.execute(
        "SELECT features FROM audio_features WHERE spotify_id = ?",
        (spotify_id,),
    ).fetchone()
    conn.close()
    if row is None:
        return None
    return json.loads(row[0])


def cache_features(spotify_id: str, features: list[float]) -> None:
    conn = _get_db()
    conn.execute(
        "INSERT OR REPLACE INTO audio_features (spotify_id, features) VALUES (?, ?)",
        (spotify_id, json.dumps(features)),
    )
    conn.commit()
    conn.close()


def get_all_cached_features() -> dict[str, list[float]]:
    conn = _get_db()
    rows = conn.execute("SELECT spotify_id, features FROM audio_features").fetchall()
    conn.close()
    return {row[0]: json.loads(row[1]) for row in rows}


# ─── YouTube Music Search ────────────────────────────────────────────────────

def _parse_duration(duration_str: str) -> int:
    """Parse YouTube Music duration string like '3:34' or '1:02:15' to seconds."""
    parts = duration_str.split(":")
    if len(parts) == 2:
        return int(parts[0]) * 60 + int(parts[1])
    if len(parts) == 3:
        return int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])
    return 0


def _clean_query(text: str) -> str:
    """Remove parenthetical suffixes like (feat. X), (Remastered), etc. for cleaner search."""
    return re.sub(r"\s*[\(\[].*?[\)\]]", "", text).strip()


def search_track(yt: YTMusic, query: TrackQuery, duration_tolerance_s: int = 5) -> MatchResult | None:
    """Search YouTube Music for a matching track.

    Matches on search relevance + duration within tolerance.
    """
    search_query = f"{_clean_query(query.name)} {_clean_query(query.artist)}"
    target_duration_s = query.duration_ms / 1000

    try:
        results = yt.search(search_query, filter="songs", limit=10)
    except Exception as e:
        logger.warning("YTMusic search failed for %s: %s", search_query, e)
        return None

    for result in results:
        if not result.get("videoId") or not result.get("duration"):
            continue

        yt_duration_s = _parse_duration(result["duration"])
        if abs(yt_duration_s - target_duration_s) > duration_tolerance_s:
            continue

        artist_names = ", ".join(a["name"] for a in result.get("artists", []))
        match = MatchResult(
            spotify_id=query.spotify_id,
            video_id=result["videoId"],
            title=result.get("title", ""),
            artist=artist_names,
            duration_s=yt_duration_s,
        )
        cache_match(match)
        return match

    logger.info("No match for '%s' (target %.0fs)", search_query, target_duration_s)
    return None


# ─── yt-dlp Download ─────────────────────────────────────────────────────────

def download_audio(video_id: str, output_dir: str) -> str | None:
    """Download audio for a YouTube video ID. Returns path to downloaded file."""
    opts = {
        "format": "bestaudio",
        "outtmpl": os.path.join(output_dir, f"{video_id}.%(ext)s"),
        "quiet": True,
        "no_warnings": True,
        "cookiesfrombrowser": ("chrome",),
    }

    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            ydl.download([f"https://music.youtube.com/watch?v={video_id}"])

        # Find the downloaded file (extension varies)
        for f in os.listdir(output_dir):
            if f.startswith(video_id):
                return os.path.join(output_dir, f)
    except Exception as e:
        logger.warning("Download failed for %s: %s", video_id, e)

    return None


# ─── Orchestration ───────────────────────────────────────────────────────────

def search_and_download(
    yt: YTMusic,
    query: TrackQuery,
    output_dir: str,
) -> DownloadResult | None:
    """Search for a track on YouTube Music, download if found.

    Checks cache first. Returns None if no match or download fails.
    """
    # Check cache
    match = get_cached_match(query.spotify_id)
    if match is None:
        match = search_track(yt, query)
    if match is None:
        return None

    file_path = download_audio(match.video_id, output_dir)
    if file_path is None:
        return None

    return DownloadResult(
        spotify_id=query.spotify_id,
        video_id=match.video_id,
        file_path=file_path,
        duration_s=match.duration_s,
    )
