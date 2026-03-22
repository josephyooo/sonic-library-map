# Spotify Library Visualization

An interactive web app that plots your entire Spotify library as a scatter plot, draws boundaries around playlist groupings, and reveals latent clusters — songs that could be playlists but aren't. Inspired by [Every Noise at Once](https://everynoise.com), but personal.

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16, React 19, TypeScript, Tailwind CSS 4 |
| Visualization | D3.js on Canvas (not SVG — performs well at 5000+ points) |
| Auth | Spotify OAuth 2.0 + `iron-session` encrypted cookies |
| Database | SQLite via `better-sqlite3` (WAL mode, 24h cache TTL) |
| Rate limiting | `p-queue` (concurrency 10, 25 req/sec) |
| ML sidecar | FastAPI + `umap-learn` + `hdbscan` (Python 3.11) |
| Deployment | Docker Compose on Oracle Cloud VPS behind Cloudflare tunnel |

## Setup

### Prerequisites

- Node.js 20+
- A [Spotify Developer App](https://developer.spotify.com/dashboard) with your email added under User Management

### 1. Configure environment

```bash
cp .env.example .env.local
```

Fill in `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, and generate a random `SESSION_SECRET` (32+ chars). Set the redirect URI in your Spotify app to:

```
http://127.0.0.1:3000/api/auth/callback
```

Use `127.0.0.1`, not `localhost` — Spotify rejects HTTP localhost redirect URIs.

### 2. Run in development

```bash
cd next-app
npm install
npm run dev
```

Open `http://127.0.0.1:3000` (not `localhost` — cookies are domain-scoped).

### 3. Run with Docker Compose

```bash
docker compose up --build
```

This starts both the Next.js app (port 3000) and the Python UMAP sidecar (port 8000, internal only). The web service waits for the UMAP health check before starting.

## Architecture

```
User  ->  Spotify OAuth login
      ->  Fetch saved tracks + playlists + artist genres  (paginated, rate-limited)
      ->  Cache in SQLite
      ->  Send features to Python sidecar  ->  UMAP  ->  2D coordinates
      ->  D3 renders interactive scatter plot with playlist boundaries
```

### Key directories

```
next-app/src/
  app/
    api/auth/{login,callback,logout,refresh}/  -- OAuth routes
    api/library/                               -- SSE streaming data fetch
    dashboard/                                 -- scatter plot page
  components/
    ScatterPlot.tsx    -- D3 Canvas renderer (zoom, pan, quadtree hit-test)
    SongTooltip.tsx    -- hover card with album art
    PlaylistLegend.tsx -- color-coded playlist toggles
    LibraryLoader.tsx  -- SSE progress bar
  lib/
    spotify.ts  -- paginated Spotify API wrapper
    auth.ts     -- iron-session config
    db.ts       -- SQLite cache layer
    types.ts    -- shared TypeScript interfaces

umap-service/
  main.py      -- FastAPI: /umap, /cluster, /health
  cluster.py   -- HDBSCAN clustering
```

## Current state

Phases 0 through 3 are complete: OAuth, library data fetching with caching, and a basic scatter plot (Release Year vs. Popularity) with hover tooltips, click-to-open, zoom/pan, and playlist color filtering. See [PLAN.md](PLAN.md) for upcoming phases.

## Known limitations

- **Audio features unavailable**: Spotify deprecated the `/audio-features` endpoint for new apps in November 2024. The app gracefully falls back to zero audio features. UMAP (Phase 4) will need to use genre-based embeddings instead.
- **Scatter plot axes are temporary**: Release Year vs. Popularity are placeholder axes until UMAP coordinates replace them.

## License

[GPL-3.0](LICENSE)
