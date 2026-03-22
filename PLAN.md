# Implementation Plan

## Vision

Plot a user's entire Spotify library as an interactive scatter plot. Draw boundaries around playlist groupings. Reveal latent clusters (songs that could be playlists but aren't) and discordant playlists (playlists with scattered songs). Portfolio-worthy, shareable.

## Data flow

```
Spotify OAuth  ->  Fetch tracks, playlists, artists (paginated, rate-limited)
               ->  Cache in SQLite (24h TTL)
               ->  Compute 2D embedding (UMAP on genre/audio features)
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

### Phase 4: UMAP Integration -- TODO
- FastAPI `/umap` endpoint — accept feature vectors, return 2D coordinates
- **Since audio features are unavailable**, build feature vectors from:
  - Artist genre presence (binary vector across all genres in library)
  - Track popularity, duration
  - Album release year
- Z-score normalize before UMAP; `random_state=42` for determinism
- Cache UMAP results in SQLite (keyed by feature matrix hash)
- Next.js `/api/umap` proxy route to Python sidecar
- Wire coordinates into ScatterPlot, replace Release Year / Popularity axes
- Animate transition from old to new coordinates

### Phase 5: Playlist Boundaries -- TODO
- Convex hulls via `d3.polygonHull` (fallback: circle for 1-2 song playlists)
- Semi-transparent colored polygons behind song dots
- Playlist labels at hull centroids
- Toggle visibility per playlist (already wired in PlaylistLegend)
- Optional: `d3-contour` kernel density for smoother boundaries

### Phase 6: Every Noise Genre View -- TODO
- `lib/genre-scraper.ts` — fetch everynoise.com HTML, parse with `cheerio`, extract genre coordinates from inline styles
- Cache in SQLite, re-scrape weekly
- Map songs to genre coordinates via artist genres (average if multiple)
- `ViewToggle.tsx` — animated transition between UMAP and genre views (~800ms D3 transition)

### Phase 7: Cluster Detection -- TODO
- HDBSCAN on UMAP coordinates in Python sidecar (`/cluster` endpoint)
- Identify songs clustered together but not sharing a playlist — "potential playlists"
- Identify playlists with high intra-cluster scatter — "discordant playlists"
- `ClusterPanel.tsx` to surface insights

### Phase 8: Polish & Deploy -- TODO
- Dark theme refinement, smooth animations, responsive layout
- Album art thumbnails on hover (lazy-loaded) — already implemented
- Song preview playback (30-sec Spotify previews; many tracks have null `preview_url`)
- Error handling (expired tokens, API failures, empty libraries)
- Dockerize: multi-stage builds, `output: 'standalone'` in Next.js config
- Deploy to Oracle Cloud VPS, set up Cloudflare tunnel
- **ARM64 note**: `umap-learn` and `hdbscan` compile C extensions; Dockerfiles need `gcc` and `python3-dev`

### Phase 9: Last.fm Integration -- LATER
- `pylast` for scrobble counts and recency per track
- Bubble size = log-scaled play count
- Color temperature or opacity = recency
- Integrate into UMAP embedding weights (optional)

## Pitfalls

| Issue | Mitigation |
|-------|-----------|
| Audio features API restricted for new apps | Fallback to genre-based embeddings; apply for extended quota |
| D3 + React DOM conflict | `useRef` + `useEffect` pattern; D3 binds to Canvas, React doesn't touch it |
| Canvas hit-testing (no DOM events on circles) | `d3.quadtree` for O(log n) nearest-point lookup on mousemove |
| Convex hull with <3 points or collinear points | Fallback to circle; handle `d3.polygonHull` returning null |
| UMAP non-determinism | Fixed `random_state=42` |
| Every Noise site changes | Defensive scraper with graceful degradation |
| `better-sqlite3` native compilation on ARM | Include `python3`, `make`, `gcc` in Dockerfile build stage |
| `localhost` vs `127.0.0.1` cookie mismatch | Always use `127.0.0.1` in development |
| `redirect()` throws NEXT_REDIRECT | Never call inside try/catch |

## Verification checklist

1. **Phase 1**: Dashboard shows Spotify display name after OAuth
2. **Phase 2**: `/api/library` returns full track list in <30 seconds; subsequent loads are instant (cached)
3. **Phase 3**: Scatter plot renders 900+ points with smooth zoom/pan; hover tooltips work
4. **Phase 4**: UMAP view shows meaningful clustering (similar songs nearby)
5. **Phase 5**: Playlist hulls visible, toggling works
6. **Phase 6**: Genre view shows recognizable neighborhoods, animated toggle works
7. **Phase 7**: Cluster panel identifies at least one latent cluster and one discordant playlist
8. **Phase 8**: `docker compose up` runs both services; accessible via Cloudflare tunnel
