#!/usr/bin/env node
// Export a frozen snapshot of Joseph's library + UMAP + genres + clusters +
// raw features into the site's public dir for the static demo.
//
// Usage:
//   node scripts/export-demo.mjs [outDir]
//
// Default outDir: ../site/public/demo/spotify
// Requires the sidecar running on 127.0.0.1:8000 for cluster insights;
// if it's not up, clusters.json is skipped and the UI hides the panel.

import Database from "better-sqlite3";
import { mkdir, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "../..");

const NEXT_DB = path.join(ROOT, "next-app/data/spotify-library.db");
const SIDECAR_DB = path.join(ROOT, "umap-service/data/features.db");
const OUT = path.resolve(
  process.argv[2] ?? path.join(ROOT, "../site/public/demo/spotify"),
);
const SIDECAR_URL = process.env.UMAP_SERVICE_URL ?? "http://127.0.0.1:8000";

const nextDb = new Database(NEXT_DB, { readonly: true });
const sideDb = new Database(SIDECAR_DB, { readonly: true });

// ─── Library ─────────────────────────────────────────────────────────────
const libRow = nextDb
  .prepare("SELECT * FROM library_cache LIMIT 1")
  .get();
if (!libRow) throw new Error("No library_cache row — run a Spotify sync first");

const rawTracks = JSON.parse(libRow.tracks);
const playlistTracks = JSON.parse(libRow.playlist_tracks);

// Pick the smallest album image (usually 64px) to keep bundle tiny
function smallestImage(images) {
  if (!images || images.length === 0) return null;
  return images.reduce((a, b) =>
    (a.width ?? 999) < (b.width ?? 999) ? a : b,
  );
}

const tracks = rawTracks.map((t) => ({
  id: t.id,
  name: t.name,
  album: {
    name: t.album.name,
    images: [smallestImage(t.album.images)].filter(Boolean),
  },
  artists: t.artists.map((a) => ({ name: a.name })),
  external_urls: { spotify: t.external_urls?.spotify ?? "" },
}));

// ─── UMAP coords ─────────────────────────────────────────────────────────
// Pick the cache entry with the most tracks that intersect the current library.
const trackIds = new Set(tracks.map((t) => t.id));
const umapRows = sideDb.prepare("SELECT coordinates FROM umap_cache").all();
let bestCoords = null;
let bestCount = 0;
for (const row of umapRows) {
  try {
    const coords = JSON.parse(row.coordinates);
    let count = 0;
    for (const id of Object.keys(coords)) if (trackIds.has(id)) count++;
    if (count > bestCount) {
      bestCount = count;
      bestCoords = coords;
    }
  } catch {
    // skip malformed
  }
}
// Round to 3 decimals for smaller JSON (UMAP coords are unitless, 3dp is plenty)
const round3 = (n) => Math.round(n * 1000) / 1000;
const umapCoords = {};
if (bestCoords) {
  for (const [id, coord] of Object.entries(bestCoords)) {
    if (trackIds.has(id)) umapCoords[id] = [round3(coord[0]), round3(coord[1])];
  }
}

// ─── YouTube matches (for hover preview player) ─────────────────────────
const ytRows = sideDb
  .prepare("SELECT spotify_id, video_id, duration_s FROM youtube_matches")
  .all();
const youtubeIds = {};
for (const row of ytRows) {
  if (!trackIds.has(row.spotify_id)) continue;
  youtubeIds[row.spotify_id] = [row.video_id, row.duration_s];
}

// ─── Clusters (optional, requires sidecar) ───────────────────────────────
let clusterInsights = null;
let clusterLabels = null;
if (Object.keys(umapCoords).length >= 20) {
  try {
    const res = await fetch(`${SIDECAR_URL}/cluster`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        coordinates: umapCoords,
        playlist_tracks: playlistTracks,
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (res.ok) {
      const data = await res.json();
      clusterInsights = data.insights ?? [];
      clusterLabels = data.labels ?? null;
    } else {
      console.warn(`Sidecar /cluster returned ${res.status} — skipping`);
    }
  } catch (err) {
    console.warn(
      `Sidecar not reachable (${err.message}) — skipping clusters.json. ` +
        `Start with: cd umap-service && DEBUG=1 uvicorn main:app --host 127.0.0.1 --port 8000`,
    );
  }
}

// ─── Write bundle ────────────────────────────────────────────────────────
await mkdir(OUT, { recursive: true });

const bundle = {
  "library.json": { tracks },
  "umap.json": { coordinates: umapCoords },
  "youtube-ids.json": { ids: youtubeIds },
};
if (clusterInsights) {
  bundle["clusters.json"] = { insights: clusterInsights, labels: clusterLabels };
}

for (const [name, data] of Object.entries(bundle)) {
  const filePath = path.join(OUT, name);
  await writeFile(filePath, JSON.stringify(data));
  const { size } = await stat(filePath);
  console.log(`  ${name.padEnd(20)} ${(size / 1024).toFixed(1).padStart(7)} KB`);
}

console.log(`\nExported to ${OUT}`);
console.log(`Tracks: ${tracks.length} | UMAP: ${Object.keys(umapCoords).length} | ` +
  `YT ids: ${Object.keys(youtubeIds).length} | Clusters: ${clusterInsights?.length ?? "skipped"}`);

nextDb.close();
sideDb.close();
