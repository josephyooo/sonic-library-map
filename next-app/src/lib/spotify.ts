import PQueue from "p-queue";

const SPOTIFY_AUTH_URL = "https://accounts.spotify.com/authorize";
const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const SPOTIFY_API_BASE = "https://api.spotify.com/v1";

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID!;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET!;
const REDIRECT_URI = process.env.SPOTIFY_REDIRECT_URI!;

// Rate limiter: Spotify allows ~30 req/sec, we use concurrency 10 to be safe
const queue = new PQueue({ concurrency: 10, interval: 1000, intervalCap: 25 });

const SCOPES = [
  "user-read-private",
  "user-read-email",
  "user-library-read",
  "playlist-read-private",
  "playlist-read-collaborative",
].join(" ");

export function getAuthUrl(state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    scope: SCOPES,
    redirect_uri: REDIRECT_URI,
    state,
  });
  return `${SPOTIFY_AUTH_URL}?${params.toString()}`;
}

export async function exchangeCode(code: string) {
  const response = await fetch(SPOTIFY_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64")}`,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token exchange failed: ${error}`);
  }

  return response.json() as Promise<{
    access_token: string;
    refresh_token: string;
    expires_in: number;
    token_type: string;
  }>;
}

export async function refreshAccessToken(refreshToken: string) {
  const response = await fetch(SPOTIFY_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64")}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token refresh failed: ${error}`);
  }

  return response.json() as Promise<{
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    token_type: string;
  }>;
}

export async function getMe(accessToken: string) {
  const response = await fetch(`${SPOTIFY_API_BASE}/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch profile: ${response.status}`);
  }

  return response.json() as Promise<{
    id: string;
    display_name: string;
    email: string;
    images: { url: string; width: number; height: number }[];
  }>;
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SpotifyTrack {
  id: string;
  name: string;
  artists: { id: string; name: string }[];
  album: {
    id: string;
    name: string;
    images: { url: string; width: number; height: number }[];
    release_date: string;
  };
  duration_ms: number;
  popularity: number;
  preview_url: string | null;
  uri: string;
  external_urls: { spotify: string };
}

export interface AudioFeatures {
  id: string;
  danceability: number;
  energy: number;
  key: number;
  loudness: number;
  mode: number;
  speechiness: number;
  acousticness: number;
  instrumentalness: number;
  liveness: number;
  valence: number;
  tempo: number;
  duration_ms: number;
  time_signature: number;
}

export interface SpotifyPlaylist {
  id: string;
  name: string;
  description: string | null;
  images: { url: string; width: number; height: number }[];
  owner: { id: string; display_name: string };
  tracks: { total: number };
}

export interface SpotifyArtist {
  id: string;
  name: string;
  genres: string[];
  popularity: number;
}

export type ProgressCallback = (message: string, current: number, total: number) => void;

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function spotifyFetch<T>(url: string, accessToken: string): Promise<T> {
  return queue.add(async () => {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (response.status === 429) {
      const retryAfter = parseInt(response.headers.get("Retry-After") || "1", 10);
      await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
      // Retry once after waiting
      const retry = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!retry.ok) throw new Error(`Spotify API error: ${retry.status}`);
      return retry.json() as Promise<T>;
    }

    if (!response.ok) {
      throw new Error(`Spotify API error: ${response.status} ${url}`);
    }

    return response.json() as Promise<T>;
  }) as Promise<T>;
}

async function fetchAllPages<T>(
  initialUrl: string,
  accessToken: string,
  extractItems: (body: unknown) => T[],
  onProgress?: ProgressCallback,
  progressLabel?: string,
): Promise<T[]> {
  const allItems: T[] = [];
  let url: string | null = initialUrl;
  let total = 0;

  interface PaginatedResponse {
    items: unknown[];
    next: string | null;
    total: number;
  }

  while (url) {
    const body: PaginatedResponse = await spotifyFetch<PaginatedResponse>(url, accessToken);

    total = body.total;
    const items = extractItems(body);
    allItems.push(...items);

    if (onProgress && progressLabel) {
      onProgress(progressLabel, allItems.length, total);
    }

    url = body.next;
  }

  return allItems;
}

// ─── Library Fetching ────────────────────────────────────────────────────────

export async function getSavedTracks(
  accessToken: string,
  onProgress?: ProgressCallback,
): Promise<SpotifyTrack[]> {
  return fetchAllPages<SpotifyTrack>(
    `${SPOTIFY_API_BASE}/me/tracks?limit=50`,
    accessToken,
    (body) => {
      const b = body as { items: { track: SpotifyTrack }[] };
      return b.items.map((item) => item.track);
    },
    onProgress,
    "Fetching saved tracks",
  );
}

export async function getUserPlaylists(
  accessToken: string,
  onProgress?: ProgressCallback,
): Promise<SpotifyPlaylist[]> {
  return fetchAllPages<SpotifyPlaylist>(
    `${SPOTIFY_API_BASE}/me/playlists?limit=50`,
    accessToken,
    (body) => (body as { items: SpotifyPlaylist[] }).items,
    onProgress,
    "Fetching playlists",
  );
}

export async function getPlaylistTracks(
  playlistId: string,
  accessToken: string,
): Promise<SpotifyTrack[]> {
  return fetchAllPages<SpotifyTrack>(
    `${SPOTIFY_API_BASE}/playlists/${playlistId}/tracks?limit=50&fields=items(track(id,name,artists(id,name),album(id,name,images,release_date),duration_ms,popularity,preview_url,uri,external_urls)),next,total`,
    accessToken,
    (body) => {
      const b = body as { items: { track: SpotifyTrack | null }[] };
      return b.items
        .filter((item) => item.track !== null)
        .map((item) => item.track as SpotifyTrack);
    },
  );
}

export async function getAudioFeatures(
  trackIds: string[],
  accessToken: string,
  onProgress?: ProgressCallback,
): Promise<AudioFeatures[]> {
  const allFeatures: AudioFeatures[] = [];
  const batchSize = 100;

  for (let i = 0; i < trackIds.length; i += batchSize) {
    const batch = trackIds.slice(i, i + batchSize);
    const ids = batch.join(",");

    const data = await spotifyFetch<{ audio_features: (AudioFeatures | null)[] }>(
      `${SPOTIFY_API_BASE}/audio-features?ids=${ids}`,
      accessToken,
    );

    const valid = data.audio_features.filter(
      (f): f is AudioFeatures => f !== null,
    );
    allFeatures.push(...valid);

    if (onProgress) {
      onProgress(
        "Fetching audio features",
        Math.min(i + batchSize, trackIds.length),
        trackIds.length,
      );
    }
  }

  return allFeatures;
}

export async function getArtists(
  artistIds: string[],
  accessToken: string,
  onProgress?: ProgressCallback,
): Promise<SpotifyArtist[]> {
  const allArtists: SpotifyArtist[] = [];
  const batchSize = 50; // Spotify max for /artists endpoint

  for (let i = 0; i < artistIds.length; i += batchSize) {
    const batch = artistIds.slice(i, i + batchSize);
    const ids = batch.join(",");

    const data = await spotifyFetch<{ artists: SpotifyArtist[] }>(
      `${SPOTIFY_API_BASE}/artists?ids=${ids}`,
      accessToken,
    );

    allArtists.push(...data.artists);

    if (onProgress) {
      onProgress(
        "Fetching artist genres",
        Math.min(i + batchSize, artistIds.length),
        artistIds.length,
      );
    }
  }

  return allArtists;
}
