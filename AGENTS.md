# Agent Guidelines

Rules and conventions for any AI agent working on this codebase.

## Next.js 16 breaking changes

This project uses Next.js 16 (not 14 or 15). Key differences from training data:

- `cookies()` from `next/headers` is **async** — must `await`
- `params` in page/layout components is a **Promise** — must `await`
- `redirect()` from `next/navigation` throws a `NEXT_REDIRECT` error internally — **never call inside try/catch** or it gets caught as an error. Set a destination variable inside try/catch, then call `redirect(destination)` after.
- `cookies()` and `redirect()` operate on the same implicit response. Do not mix with `NextResponse.redirect()` — it has a separate cookie store and sessions won't persist.
- `allowedDevOrigins` in `next.config.ts` expects **bare hostnames** (`["127.0.0.1"]`), not full URLs. Wrong format silently blocks HMR.
- When unsure about an API, check `node_modules/next/dist/docs/` for the actual documentation.

## Code conventions

### TypeScript
- Strict mode is on. All functions should have explicit return types when non-trivial.
- Shared types go in `src/lib/types.ts`. Component-level types stay in the component file.
- Use `interface` for object shapes, `type` for unions/intersections.

### React patterns
- Server components (no `"use client"`) for pages that only need auth checks or data loading.
- Client components (`"use client"`) for anything interactive.
- D3 bindss to Canvas via `useRef` + `useEffect`. React never touches the Canvas DOM — D3 owns it entirely.
- Use `useMemo` for expensive derived data (scales, quadtrees, color maps). Use `useCallback` for event handlers passed as props.
- Avoid `useState` for values derivable from other state — use `useMemo` instead.

### Naming
- Components: `PascalCase` (files and exports)
- Functions/variables: `camelCase`
- Constants: `UPPER_SNAKE_CASE`
- API routes: lowercase kebab-style paths (`/api/auth/login`)

### Styling
- Tailwind CSS 4 with `@import "tailwindcss"` in `globals.css` (not `@tailwind` directives).
- Dark theme throughout. Background: `bg-zinc-950`, text: `text-white`, borders: `border-zinc-800`.
- No CSS modules or styled-components.

## Architecture rules

### Auth
- All auth uses `iron-session` with encrypted HTTP-only cookies. Tokens never reach the client.
- Session is read via `getSession()` from `src/lib/auth.ts` — works in both server components and API routes.
- Token refresh happens server-side in `/api/library` before data fetching (60s buffer).

### Spotify API
- All Spotify calls go through `spotifyFetch()` in `src/lib/spotify.ts`, which handles rate limiting via `p-queue` and 429 retries.
- Pagination is handled by `fetchAllPages()` — never manually paginate.
- Audio features endpoint is deprecated for new apps (Nov 2024). Always wrap in try/catch.
- `preview_url` is null for all tracks — Spotify no longer provides preview audio for new apps.

### Audio feature extraction (Python sidecar)
- Spotify provides no usable audio. Features are extracted via a YouTube Music pipeline: `ytmusicapi` search → `yt-dlp` download → Essentia extraction.
- **ytmusicapi uses browser auth** (cookie-based, no API quota limits). Google Cloud OAuth auth is impractical (100 searches/day at 100 units/search).
- Audio files are **temporary** — downloaded, processed by Essentia, then immediately deleted. Only the extracted feature vectors and the YouTube Music link are cached.
- Feature cache is **indefinite** (keyed by Spotify track ID). No TTL — audio characteristics don't change.
- Match Spotify tracks to YouTube Music results using track name + artist name search, filtered by duration (±5s tolerance).
- If a track can't be found or downloaded, skip it gracefully. UMAP handles incomplete data.
- **yt-dlp requires Chrome cookies** (`cookiesfrombrowser: ('chrome',)`) and the **EJS challenge solver** (`yt-dlp --remote-components ejs:github --skip-download URL`) for YouTube authentication. Without EJS, downloads fail.
- Use `bestaudio` format — the `bestaudio[abr<=128]` filter fails when authenticated with cookies.
- **Two types of Essentia features are extracted**:
  1. **Raw features** (41-dim): MFCCs, spectral, rhythm, tonal, dynamics — stored in `audio_features` table. Used for "Color by" overlay (BPM, loudness, etc.) but NOT for UMAP.
  2. **TF embeddings** (2048-dim): Discogs-EffNet model output — stored in `tf_embeddings` table. Used as UMAP input. Captures learned genre/style/mood similarity.
- Raw spectral features (MFCCs) produce nonsensical UMAP clusters. Always use TF embeddings for dimensionality reduction.
- The Discogs-EffNet model file must be downloaded separately (~20MB) and placed in `umap-service/models/`.
- All blocking I/O in the sidecar (ytmusicapi search, yt-dlp download, Essentia extraction) must use `asyncio.to_thread()` to avoid blocking uvicorn's event loop.

### Caching
- SQLite via `better-sqlite3` (synchronous, server-side only). WAL mode enabled.
- `db.ts` is imported only in server code (API routes). Never import in client components — `better-sqlite3` is a native module and will crash Turbopack bundling.
- Cache TTL is 24 hours.

### Visualization
- Canvas, not SVG. SVG DOM manipulation is too slow at 5000+ points.
- `d3.quadtree` for all spatial queries (hover hit-testing, viewport culling).
- Scales (`d3.scaleLinear`) should be memoized with `useMemo`, not recreated per frame.
- The `draw()` function is the single entry point for all canvas rendering — called on zoom, hover, and data changes.

### Data flow
- Library data is fetched via SSE from `/api/library` and consumed by `LibraryLoader.tsx`.
- Once loaded, `DashboardClient.tsx` transforms raw `LibraryData` into `PlotPoint[]` for the scatter plot.
- Playlist-to-track membership is a reverse lookup map built in `DashboardClient`.
- Three view modes (Year/Pop, UMAP, Genre) controlled by `ViewToggle.tsx`. Each has its own coordinate set; switching views swaps `activeCoords` which drives point positions and playlist filtering.
- UMAP view auto-loads cached features via `GET /api/features` on first switch. Extract button only shown in UMAP mode.
- Genre view fetches lazily via `GET /api/genres` (SQLite-cached, 1-week TTL). Tracks mapped by averaging their artists' genre coordinates from Every Noise.
- Toggling playlists controls color/hull visibility only — songs are never hidden, only grayed out.

## Domain knowledge

- Use `127.0.0.1`, never `localhost`, in development. Spotify redirect URIs and browser cookies are domain-scoped — mixing them causes silent auth failures.
- The project deploys to an Oracle Cloud ARM64 VPS. Docker builds must work on `linux/arm64`. UMAP, HDBSCAN, and Essentia compile C extensions, so the Python Dockerfile includes `gcc`, `python3-dev`, and `ffmpeg`.
- The Spotify app is in development mode with limited users. New test users must be added under User Management in the Spotify developer dashboard.
- YouTube Music browser auth headers are stored in a config file consumed by `ytmusicapi`. These expire periodically and must be refreshed by the user.
