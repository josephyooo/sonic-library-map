import Database from "better-sqlite3";
import path from "path";
import type { LibraryData } from "./types";
import type { SpotifyArtist } from "./spotify";

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
  db.exec(`
    CREATE TABLE IF NOT EXISTS genre_cache (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      genres TEXT NOT NULL,
      fetched_at INTEGER NOT NULL
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS artists_cache (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      genres TEXT NOT NULL,
      popularity INTEGER NOT NULL,
      fetched_at INTEGER NOT NULL
    );
  `);
}

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const ARTISTS_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

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

export function getStaleLibrary(userId: string): LibraryData | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM library_cache WHERE user_id = ? AND fetched_at > 0")
    .get(userId) as
    | {
        tracks: string;
        playlists: string;
        playlist_tracks: string;
        audio_features: string;
        artists: string;
        fetched_at: number;
      }
    | undefined;

  if (!row) return null;

  return {
    tracks: JSON.parse(row.tracks),
    playlists: JSON.parse(row.playlists),
    playlistTracks: JSON.parse(row.playlist_tracks),
    audioFeatures: JSON.parse(row.audio_features),
    artists: JSON.parse(row.artists),
    fetchedAt: row.fetched_at,
  };
}

import type { GenreCoord } from "./genre-scraper";

const GENRE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 1 week

export function getCachedGenres(): GenreCoord[] | null {
  const db = getDb();
  const row = db
    .prepare("SELECT genres, fetched_at FROM genre_cache WHERE id = 1")
    .get() as { genres: string; fetched_at: number } | undefined;

  if (!row) return null;
  if (Date.now() - row.fetched_at > GENRE_CACHE_TTL_MS) return null;

  return JSON.parse(row.genres);
}

export function cacheGenres(genres: GenreCoord[]): void {
  const db = getDb();
  db.prepare(
    "INSERT OR REPLACE INTO genre_cache (id, genres, fetched_at) VALUES (1, ?, ?)",
  ).run(JSON.stringify(genres), Date.now());
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

// Partial cache: written after the expensive per-playlist fetches complete but
// before audio_features / artists. fetched_at = 0 is the sentinel —
// getCachedLibrary rejects it (age > TTL); getPartialLibrary picks it up for
// resume.
export function savePartialLibrary(
  userId: string,
  data: {
    tracks: LibraryData["tracks"];
    playlists: LibraryData["playlists"];
    playlistTracks: LibraryData["playlistTracks"];
  },
): void {
  const db = getDb();
  db.prepare(
    `INSERT OR REPLACE INTO library_cache
     (user_id, tracks, playlists, playlist_tracks, audio_features, artists, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, 0)`,
  ).run(
    userId,
    JSON.stringify(data.tracks),
    JSON.stringify(data.playlists),
    JSON.stringify(data.playlistTracks),
    "[]",
    "[]",
  );
}

export function getPartialLibrary(userId: string): {
  tracks: LibraryData["tracks"];
  playlists: LibraryData["playlists"];
  playlistTracks: LibraryData["playlistTracks"];
} | null {
  const db = getDb();
  const row = db
    .prepare(
      "SELECT tracks, playlists, playlist_tracks FROM library_cache WHERE user_id = ? AND fetched_at = 0",
    )
    .get(userId) as
    | { tracks: string; playlists: string; playlist_tracks: string }
    | undefined;
  if (!row) return null;
  return {
    tracks: JSON.parse(row.tracks),
    playlists: JSON.parse(row.playlists),
    playlistTracks: JSON.parse(row.playlist_tracks),
  };
}

export function getCachedArtists(ids: string[]): {
  hits: SpotifyArtist[];
  miss: string[];
} {
  if (ids.length === 0) return { hits: [], miss: [] };
  const db = getDb();
  const placeholders = ids.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT id, name, genres, popularity, fetched_at FROM artists_cache WHERE id IN (${placeholders})`,
    )
    .all(...ids) as {
    id: string;
    name: string;
    genres: string;
    popularity: number;
    fetched_at: number;
  }[];

  const now = Date.now();
  const hits: SpotifyArtist[] = [];
  const fresh = new Set<string>();
  for (const row of rows) {
    if (now - row.fetched_at <= ARTISTS_CACHE_TTL_MS) {
      hits.push({
        id: row.id,
        name: row.name,
        genres: JSON.parse(row.genres),
        popularity: row.popularity,
      });
      fresh.add(row.id);
    }
  }
  const miss = ids.filter((id) => !fresh.has(id));
  return { hits, miss };
}

export function cacheArtists(artists: SpotifyArtist[]): void {
  if (artists.length === 0) return;
  const db = getDb();
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO artists_cache (id, name, genres, popularity, fetched_at) VALUES (?, ?, ?, ?, ?)`,
  );
  const now = Date.now();
  const insertMany = db.transaction((rows: SpotifyArtist[]) => {
    for (const a of rows) {
      stmt.run(a.id, a.name, JSON.stringify(a.genres), a.popularity, now);
    }
  });
  insertMany(artists);
}
