import Database from "better-sqlite3";
import path from "path";
import type { LibraryData } from "./types";

export type { LibraryData } from "./types";

const DB_PATH =
  process.env.DATABASE_PATH ||
  path.join(process.cwd(), "data", "spotify-library.db");

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    initTables(db);
  }
  return db;
}

function initTables(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS library_cache (
      user_id TEXT PRIMARY KEY,
      tracks TEXT NOT NULL,
      playlists TEXT NOT NULL,
      playlist_tracks TEXT NOT NULL,
      audio_features TEXT NOT NULL,
      artists TEXT NOT NULL,
      fetched_at INTEGER NOT NULL
    );
  `);
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export function getCachedLibrary(userId: string): LibraryData | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM library_cache WHERE user_id = ?")
    .get(userId) as
    | {
        user_id: string;
        tracks: string;
        playlists: string;
        playlist_tracks: string;
        audio_features: string;
        artists: string;
        fetched_at: number;
      }
    | undefined;

  if (!row) return null;

  const age = Date.now() - row.fetched_at;
  if (age > CACHE_TTL_MS) return null;

  return {
    tracks: JSON.parse(row.tracks),
    playlists: JSON.parse(row.playlists),
    playlistTracks: JSON.parse(row.playlist_tracks),
    audioFeatures: JSON.parse(row.audio_features),
    artists: JSON.parse(row.artists),
    fetchedAt: row.fetched_at,
  };
}

export function cacheLibrary(userId: string, data: LibraryData) {
  const db = getDb();
  db.prepare(
    `INSERT OR REPLACE INTO library_cache
     (user_id, tracks, playlists, playlist_tracks, audio_features, artists, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    userId,
    JSON.stringify(data.tracks),
    JSON.stringify(data.playlists),
    JSON.stringify(data.playlistTracks),
    JSON.stringify(data.audioFeatures),
    JSON.stringify(data.artists),
    data.fetchedAt,
  );
}
