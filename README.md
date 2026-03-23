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
| Audio analysis | [Essentia](https://essentia.upf.edu) + Discogs-EffNet TF model (learned musical embeddings) |
| Audio sourcing | [ytmusicapi](https://github.com/sigma67/ytmusicapi) (search) + `yt-dlp` (download) |
| ML sidecar | FastAPI + `umap-learn` + `hdbscan` + Essentia (Python 3.11) |
| Deployment | Docker Compose on Oracle Cloud VPS behind Cloudflare tunnel |

## Setup

### Prerequisites

- Node.js 20+
- Python 3.11+ (for the analysis sidecar)
- A [Spotify Developer App](https://developer.spotify.com/dashboard) with your email added under User Management
- YouTube Music browser auth headers (for audio sourcing — see [ytmusicapi setup](https://ytmusicapi.readthedocs.io/en/stable/setup/browser.html))

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
      ->  Python sidecar: search YouTube Music  ->  download audio  ->  Essentia feature extraction
      ->  Discard audio, cache features + YouTube link in SQLite
      ->  UMAP on audio features  ->  2D coordinates
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
  main.py       -- FastAPI: /umap, /cluster, /features, /health
  cluster.py    -- HDBSCAN clustering
  audio_source.py -- ytmusicapi search + yt-dlp download + SQLite cache
```

## Current state

Phases 0 through 7 are complete. Currently pivoting feature extraction (Phase 4b) from raw spectral features (41-dim MFCCs) to Discogs-EffNet TF embeddings (2048-dim learned musical similarity) for dramatically better UMAP clustering. The pipeline, UI, and all other phases are fully functional. See [PLAN.md](PLAN.md) for details.

## Known limitations

- **Spotify audio features unavailable**: Spotify deprecated the `/audio-features` endpoint for new apps in November 2024, and `preview_url` returns null for all tracks. Audio features are instead extracted via YouTube Music (search with ytmusicapi → download with yt-dlp → analyze with Essentia). Audio files are discarded after processing.
- **YouTube Music browser auth expires**: The ytmusicapi browser auth cookies need periodic re-authentication.
- **Feature extraction pivot in progress**: Raw 41-dim spectral features produced poor UMAP clusters. Switching to Discogs-EffNet TF embeddings (2048-dim) for perceptually meaningful similarity. Requires re-downloading audio for existing tracks (YouTube links are cached).

## License

[GPL-3.0](LICENSE)
