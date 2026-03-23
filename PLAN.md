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

**Original approach (41-dim raw features)**: MFCCs (26), spectral (3), rhythm (2), tonality (3), dynamics (3), groove/power (4). Produced nonsensical UMAP clusters because MFCCs dominated the vector and raw spectral features aren't perceptually meaningful.

**New approach (Discogs-EffNet embeddings)**: Essentia's TensorFlow model `discogs-effnet-bs64-1` extracts a 1280-dimensional embedding per track. The model produces one embedding per ~1s patch; these are averaged to a single track-level vector. Trained on millions of tracks to capture genre, style, mood, and instrumentation — songs that sound alike have similar embeddings.

Implementation:
- `essentia-tensorflow` + `tensorflow` installed in conda env
- Discogs-EffNet model (~18MB) downloaded to `umap-service/models/`
- `tf_extract.py`: MonoLoader (16kHz) → TensorflowPredictEffnetDiscogs → average patches → 1280-dim embedding
- TF embeddings stored in separate SQLite table `tf_embeddings` (keyed by Spotify track ID)
- Raw 41-dim features retained in `audio_features` table for "Color by" overlay
- Both extracted per track during SSE streaming; only TF embeddings sent to client for UMAP
- UMAP axis correlation labels use raw features (interpretable) correlated against TF-based UMAP coordinates
- YouTube links cached from 4a; tracks need re-download for TF extraction but search is skipped
- Audio files persisted in `data/audio/` during development; tracked in `downloads` SQLite table for reuse across runs

**Gotchas discovered**:
- yt-dlp requires the EJS challenge solver script (`--remote-components ejs:github`) to solve YouTube's signature verification. Without it, downloads fail with "Requested format is not available." Also, the `bestaudio[abr<=128]` format filter fails when authenticated — use `bestaudio` instead.
- UMAP/HDBSCAN (numba) and TensorFlow (essentia-tensorflow) crash with `mutex lock failed` when imported in the same process. UMAP and HDBSCAN must run in subprocesses.
- PCA pre-processing (1280 → 50 dims) before UMAP removes noise and speeds up computation.
- The SSE features proxy must have no timeout — extraction can run 30+ minutes. The sidecar checks `request.is_disconnected()` to stop work on client disconnect.

#### 4c: UMAP embedding -- DONE
- Z-score normalize feature vectors (StandardScaler) before UMAP
- `random_state=42`, `n_jobs=1` for determinism
- Cache UMAP results in SQLite `umap_cache` table (keyed by SHA-256 hash of feature matrix) — cache auto-invalidates when features change
- Next.js `/api/umap` proxy route to Python sidecar
- FeatureExtractor passes features to DashboardClient via callback every 10 tracks
- DashboardClient calls `/api/umap`, updates PlotPoint x/y with UMAP coordinates
- Correlation-based axis labels (e.g., "Soft ← → Loud") instead of "UMAP 1 / UMAP 2"
- Scatter plot shows empty plot when no features yet (no Year/Pop fallback)
- `GET /api/features` returns cached features — UMAP auto-loads from cache on first view switch
- Extract button only appears in UMAP mode; says "Resume extraction" when cached results exist
- Progress bar visible regardless of view mode while extraction runs
- Playlist sidebar filtered to only playlists with tracks in the current view
- Feature color overlay ("Color by" selector) for BPM, danceability, loudness, etc. with Turbo heatmap gradient

### Phase 5: Playlist Boundaries -- DONE
- Convex hulls via `d3.polygonHull` drawn behind points in `draw()`
- Fallback: circle for single-point playlists, ellipse for two-point playlists
- Semi-transparent colored polygons (8% fill, 30% stroke) using playlist color
- Playlist labels at hull centroids (10px, 50% opacity)
- Toggle visibility per playlist (wired through existing PlaylistLegend)
- Toggling a playlist off only changes its color/hull — songs are never hidden (shown as gray)

### Phase 6: Every Noise Genre View -- DONE
- `lib/genre-scraper.ts` — scrape everynoise.com HTML with `cheerio`, extract genre coordinates from `<div class="genre">` inline styles (top/left px) and genre names from `playx()` onclick
- Coordinates normalized to [0, 1] from canvas pixel positions (1610×~22000px)
- `/api/genres` route: scrape (or return SQLite-cached, 1-week TTL), map tracks to genre coordinates by averaging their artists' genre positions
- 555/907 tracks mapped (those with artists that have matching genres on Every Noise)
- `ViewToggle.tsx` — three-way toggle: Year/Pop, UMAP, Genre
- Genre axes: "Dense ← → Spiky" (x), "Organic ← → Electronic" (y)
- Genre view fetched lazily on first click

### Phase 7: Cluster Detection -- DONE
- HDBSCAN on UMAP 2D coordinates in Python sidecar (`POST /cluster`)
- `min_cluster_size=5`, `min_samples=3`
- Two insight types:
  - **Potential playlists**: clusters where tracks share no common playlist and >30% are unplaylisted
  - **Discordant playlists**: playlists with tracks scattered across 3+ clusters (scatter ratio >50%)
- `ClusterPanel.tsx` in sidebar (UMAP view only) — click insight to highlight its tracks on scatter plot
- Non-highlighted points dimmed to 10% opacity for visual focus
- Clusters auto-computed when UMAP coordinates have 20+ tracks

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
| Raw spectral features produce nonsensical UMAP clusters | Pivot to Discogs-EffNet TF embeddings (1280-dim learned musical similarity) instead of 41-dim MFCCs/spectral |
| UMAP non-determinism | Fixed `random_state=42` |
| Every Noise site changes | Defensive scraper with graceful degradation |
| Essentia + native deps on ARM | Include `gcc`, `python3-dev`, `ffmpeg`, and Essentia system deps in Dockerfile |
| `better-sqlite3` native compilation on ARM | Include `python3`, `make`, `gcc` in Dockerfile build stage |
| `localhost` vs `127.0.0.1` cookie mismatch | Always use `127.0.0.1` in development |
| `redirect()` throws NEXT_REDIRECT | Never call inside try/catch |
| numba (UMAP/HDBSCAN) + TensorFlow mutex crash | Run UMAP and HDBSCAN in subprocesses; never import `umap` or `hdbscan` in the same process as `essentia-tensorflow` |
| SSE proxy timeout kills long extractions | Remove `AbortSignal.timeout` on `POST /api/features`; sidecar checks `request.is_disconnected()` to self-cancel |
| UMAP slow on 1280-dim embeddings | PCA pre-processing reduces to 50 dims; subprocess startup ~10s (numba JIT), cached calls ~80ms |

## Verification checklist

1. **Phase 1**: Dashboard shows Spotify display name after OAuth
2. **Phase 2**: `/api/library` returns full track list in <30 seconds; subsequent loads are instant (cached)
3. **Phase 3**: Scatter plot renders 900+ points with smooth zoom/pan; hover tooltips work
4. **Phase 4**: Audio features extracted for 90%+ of tracks; UMAP view shows meaningful clustering (similar songs nearby)
5. **Phase 5**: Playlist hulls visible, toggling works
6. **Phase 6**: Genre view shows recognizable neighborhoods, animated toggle works
7. **Phase 7**: Cluster panel identifies at least one latent cluster and one discordant playlist
8. **Phase 8**: `docker compose up` runs both services; accessible via Cloudflare tunnel
