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

## Domain knowledge

- Use `127.0.0.1`, never `localhost`, in development. Spotify redirect URIs and browser cookies are domain-scoped — mixing them causes silent auth failures.
- The project deploys to an Oracle Cloud ARM64 VPS. Docker builds must work on `linux/arm64`. UMAP and HDBSCAN compile C extensions, so the Python Dockerfile includes `gcc` and `python3-dev`.
- The Spotify app is in development mode with limited users. New test users must be added under User Management in the Spotify developer dashboard.
