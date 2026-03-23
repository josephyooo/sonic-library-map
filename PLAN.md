# Implementation Plan

## Vision

Plot a user's entire Spotify library as an interactive scatter plot. Draw boundaries around playlist groupings. Reveal latent clusters (songs that could be playlists but aren't) and discordant playlists (playlists with scattered songs). Portfolio-worthy, shareable.

## Data flow

```
Spotify OAuth  ->  Fetch tracks, playlists, artists (paginated, rate-limited)
               ->  Cache in SQLite (24h TTL)
               ->  Python sidecar: ytmusicapi search -> yt-dlp download -> Essentia extraction
               ->  Discard audio, cache features + YouTube link indefinitely
               ->  UMAP on Essentia features -> 2D coordinates
               ->  D3 Canvas scatter plot with playlist hulls + cluster overlays
```

## Phases

### Phase 0: Scaffolding -- DONE
- Git repo, Next.js app, FastAPI skeleton, Docker Compose, `.env.example`
- Spotify developer app with `127.0.0.1` redirect URI

### Phase 1: Spotify OAuth -- DONE
- `/api/auth/login` — generate state, redirect to Spotify authorize URL
- `/api/auth/callback` — exchange code for tokens, store in `iron-session` cookie
- `/api/auth/refresh` — refresh expired tokens (60s buffer)
- `/api/auth/logout` — destroy session
- Landing page with "Connect with Spotify" button
- Dashboard showing logged-in user's name

**Gotchas discovered**: `redirect()` from `next/navigation` throws `NEXT_REDIRECT` internally — must NOT be inside try/catch. `cookies()` and `redirect()` share the same implicit response; don't mix with `NextResponse.redirect()`.

### Phase 2: Library Data Fetching -- DONE
- `lib/spotify.ts` — `getSavedTracks`, `getUserPlaylists`, `getPlaylistTracks`, `getAudioFeatures`, `getArtists`
- Pagination: 50 tracks/page, 100 audio features/batch, 50 artists/batch
- Rate limiting: `p-queue` (concurrency 10, intervalCap 25/sec)
- SQLite cache with 24h TTL (`lib/db.ts`)
- `/api/library` — SSE streaming route with progress events
- `LibraryLoader.tsx` — progress bar consumer

**Gotcha discovered**: Spotify deprecated `/audio-features` for new apps (Nov 2024). Wrapped in try/catch, falls back to empty array.

### Phase 3: Basic Scatter Plot -- DONE
- `ScatterPlot.tsx` — D3 Canvas renderer (not SVG, for 5000+ point performance)
- Temporary axes: Release Year (x) vs. Popularity (y) — replaced by UMAP in Phase 4
- `d3.zoom()` for pan/zoom
- `d3.quadtree` for O(log n) hover/click hit-testing
- Color points by first visible playlist membership
- `SongTooltip.tsx` — hover card with album art, track name, artist, playlist
- `PlaylistLegend.tsx` — sidebar with color toggles, show all / hide all
- Click opens track in Spotify
- DPR-aware canvas rendering

**Gotcha discovered**: `allowedDevOrigins` in Next.js 16 must be bare hostnames (`["127.0.0.1"]`), not full URLs. Wrong format silently blocks HMR websocket, preventing React hydration.

### Phase 4: Audio Feature Extraction + UMAP

Spotify's `/audio-features` endpoint is deprecated and `preview_url` returns null for all tracks. We source audio from YouTube Music instead.

#### 4a: Audio sourcing pipeline (Python sidecar) -- DONE
- `ytmusicapi` with **unauthenticated search** (sufficient for song lookup)
- For each Spotify track: search YouTube Music by `"{track name}" "{artist name}"` (parenthetical suffixes stripped for cleaner search)
- Match on duration (±5s tolerance) to filter wrong versions
- Download audio with `yt-dlp` (lowest quality sufficient — 128kbps, opus/m4a)
- **Discard audio immediately after feature extraction** — no persistent audio storage
- Cache YouTube Music link in SQLite indefinitely (keyed by Spotify track ID)
- FastAPI `/features` endpoint — accepts list of track metadata, SSE progress streaming
- Next.js `/api/features` proxy route streams SSE through to FeatureExtractor component
- `asyncio.to_thread()` for blocking I/O (ytmusicapi + yt-dlp) to keep uvicorn event loop responsive
- ~96% match rate on 907 tracks (336 matched, 20 failed in test run)

**Gotcha discovered**: Synchronous blocking calls (ytmusicapi search, yt-dlp download) inside an async SSE generator block uvicorn's event loop, preventing SSE events from flushing. Must use `asyncio.to_thread()` for all blocking I/O.

#### 4b: Essentia feature extraction -- DONE
- `feature_extract.py` — 41-dimensional feature vector per track:
  - MFCC mean + std (26 dims) — timbre
  - Spectral centroid, rolloff, flatness (3 dims) — brightness/texture
  - BPM, beat confidence (2 dims) — rhythm
  - Key, scale, key strength (3 dims) — tonality
  - Integrated loudness, loudness range, dynamic complexity (3 dims) — dynamics
  - Danceability, energy (log-scaled), RMS, zero crossing rate (4 dims) — groove/power
- Features cached indefinitely in SQLite `audio_features` table (keyed by Spotify track ID)
- Audio files deleted immediately after extraction
- yt-dlp uses Chrome cookies + EJS challenge solver for YouTube authentication

**Gotcha discovered**: yt-dlp requires the EJS challenge solver script (`--remote-components ejs:github`) to solve YouTube's signature verification. Without it, downloads fail with "Requested format is not available." Also, the `bestaudio[abr<=128]` format filter fails when authenticated — use `bestaudio` instead.

#### 4c: UMAP embedding -- DONE
- Z-score normalize feature vectors (StandardScaler) before UMAP
- `random_state=42`, `n_jobs=1` for determinism
- Cache UMAP results in SQLite `umap_cache` table (keyed by SHA-256 hash of feature matrix)
- Next.js `/api/umap` proxy route to Python sidecar
- FeatureExtractor passes features to DashboardClient via callback on completion
- DashboardClient calls `/api/umap`, updates PlotPoint x/y with UMAP coordinates
- Scatter plot axes switch from "Release Year / Popularity" to "UMAP 1 / UMAP 2"
- Tracks without features are filtered out in UMAP mode

### Phase 5: Playlist Boundaries -- DONE
- Convex hulls via `d3.polygonHull` drawn behind points in `draw()`
- Fallback: circle for single-point playlists, ellipse for two-point playlists
- Semi-transparent colored polygons (8% fill, 30% stroke) using playlist color
- Playlist labels at hull centroids (10px, 50% opacity)
- Toggle visibility per playlist (wired through existing PlaylistLegend)

### Phase 6: Every Noise Genre View -- DONE
- `lib/genre-scraper.ts` — scrape everynoise.com HTML with `cheerio`, extract genre coordinates from `<div class="genre">` inline styles (top/left px) and genre names from `playx()` onclick
- Coordinates normalized to [0, 1] from canvas pixel positions (1610×~22000px)
- `/api/genres` route: scrape (or return in-memory cached, 1-week TTL), map tracks to genre coordinates by averaging their artists' genre positions
- 555/907 tracks mapped (those with artists that have matching genres on Every Noise)
- `ViewToggle.tsx` — three-way toggle: Year/Pop, UMAP, Genre
- Genre axes: "Dense ← → Spiky" (x), "Organic ← → Electronic" (y)
- Genre view fetched lazily on first click

### Phase 7: Cluster Detection -- TODO
- HDBSCAN on UMAP coordinates in Python sidecar (`/cluster` endpoint)
- Identify songs clustered together but not sharing a playlist — "potential playlists"
- Identify playlists with high intra-cluster scatter — "discordant playlists"
- `ClusterPanel.tsx` to surface insights

### Phase 8: Polish & Deploy -- TODO
- Dark theme refinement, smooth animations, responsive layout
- Album art thumbnails on hover (lazy-loaded) — already implemented
- Error handling (expired tokens, API failures, empty libraries)
- Dockerize: multi-stage builds, `output: 'standalone'` in Next.js config
- Deploy to Oracle Cloud VPS, set up Cloudflare tunnel
- **ARM64 note**: `umap-learn`, `hdbscan`, and `essentia` compile C extensions; Dockerfiles need `gcc`, `python3-dev`, and Essentia system dependencies
- **yt-dlp in Docker**: ensure `ffmpeg` is installed in the Python container

### Phase 9: Last.fm Integration -- LATER
- `pylast` for scrobble counts and recency per track
- Bubble size = log-scaled play count
- Color temperature or opacity = recency
- Integrate into UMAP embedding weights (optional)

## Pitfalls

| Issue | Mitigation |
|-------|-----------|
| Spotify audio features + preview_url unavailable | Source audio from YouTube Music via ytmusicapi + yt-dlp, extract features with Essentia |
| ytmusicapi search returns wrong track | Match on duration (±5s tolerance); skip tracks with no confident match |
| ytmusicapi browser auth cookies expire | Detect 401 and prompt user to re-authenticate; store auth headers in a config file |
| yt-dlp download failures (geo-restricted, removed) | Skip track, log warning, proceed with remaining tracks; UMAP handles missing points |
| yt-dlp signature verification fails | Install EJS challenge solver: `yt-dlp --remote-components ejs:github --skip-download URL`; use `bestaudio` format (not `bestaudio[abr<=128]`) |
| D3 + React DOM conflict | `useRef` + `useEffect` pattern; D3 binds to Canvas, React doesn't touch it |
| Canvas hit-testing (no DOM events on circles) | `d3.quadtree` for O(log n) nearest-point lookup on mousemove |
| Convex hull with \<3 points or collinear points | Fallback to circle; handle `d3.polygonHull` returning null |
| UMAP non-determinism | Fixed `random_state=42` |
| Every Noise site changes | Defensive scraper with graceful degradation |
| Essentia + native deps on ARM | Include `gcc`, `python3-dev`, `ffmpeg`, and Essentia system deps in Dockerfile |
| `better-sqlite3` native compilation on ARM | Include `python3`, `make`, `gcc` in Dockerfile build stage |
| `localhost` vs `127.0.0.1` cookie mismatch | Always use `127.0.0.1` in development |
| `redirect()` throws NEXT_REDIRECT | Never call inside try/catch |

## Verification checklist

1. **Phase 1**: Dashboard shows Spotify display name after OAuth
2. **Phase 2**: `/api/library` returns full track list in <30 seconds; subsequent loads are instant (cached)
3. **Phase 3**: Scatter plot renders 900+ points with smooth zoom/pan; hover tooltips work
4. **Phase 4**: Audio features extracted for 90%+ of tracks; UMAP view shows meaningful clustering (similar songs nearby)
5. **Phase 5**: Playlist hulls visible, toggling works
6. **Phase 6**: Genre view shows recognizable neighborhoods, animated toggle works
7. **Phase 7**: Cluster panel identifies at least one latent cluster and one discordant playlist
8. **Phase 8**: `docker compose up` runs both services; accessible via Cloudflare tunnel
