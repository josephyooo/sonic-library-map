import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { refreshAccessToken } from "@/lib/spotify";
import {
  getSavedTracks,
  getUserPlaylists,
  getPlaylistTracks,
  getAudioFeatures,
  getArtists,
} from "@/lib/spotify";
import { getCachedLibrary, cacheLibrary, type LibraryData } from "@/lib/db";

export const dynamic = "force-dynamic";

async function getValidAccessToken(): Promise<{
  accessToken: string;
  userId: string;
} | null> {
  const session = await getSession();

  if (!session.accessToken || !session.userId) {
    return null;
  }

  // Refresh token if expired (with 60s buffer)
  if (session.tokenExpiry && Date.now() > session.tokenExpiry - 60_000) {
    if (!session.refreshToken) return null;
    try {
      const tokens = await refreshAccessToken(session.refreshToken);
      session.accessToken = tokens.access_token;
      if (tokens.refresh_token) session.refreshToken = tokens.refresh_token;
      session.tokenExpiry = Date.now() + tokens.expires_in * 1000;
      await session.save();
    } catch {
      session.destroy();
      return null;
    }
  }

  return { accessToken: session.accessToken, userId: session.userId };
}

export async function GET() {
  const auth = await getValidAccessToken();
  if (!auth) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Fetch data from Spotify using SSE for progress (or return cached)
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function send(obj: Record<string, unknown>) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      }

      function sendProgress(message: string, current: number, total: number) {
        send({ type: "progress", message, current, total });
      }

      // Check cache first
      const cached = getCachedLibrary(auth.userId);
      if (cached) {
        send({ type: "complete", data: cached, fromCache: true });
        controller.close();
        return;
      }

      try {
        // 1. Fetch saved tracks
        const tracks = await getSavedTracks(auth.accessToken, sendProgress);

        // 2. Fetch playlists
        const playlists = await getUserPlaylists(auth.accessToken, sendProgress);

        // 3. Fetch tracks for each playlist
        const playlistTracks: Record<string, string[]> = {};
        for (let i = 0; i < playlists.length; i++) {
          sendProgress("Fetching playlist tracks", i + 1, playlists.length);
          const pTracks = await getPlaylistTracks(
            playlists[i].id,
            auth.accessToken,
          );
          playlistTracks[playlists[i].id] = pTracks.map((t) => t.id);
        }

        // 4. Collect unique track IDs and try to fetch audio features
        // Note: Spotify deprecated this endpoint for new apps (Nov 2024)
        const allTrackIds = new Set<string>();
        tracks.forEach((t) => allTrackIds.add(t.id));
        Object.values(playlistTracks)
          .flat()
          .forEach((id) => allTrackIds.add(id));

        let audioFeatures: Awaited<ReturnType<typeof getAudioFeatures>> = [];
        try {
          audioFeatures = await getAudioFeatures(
            [...allTrackIds],
            auth.accessToken,
            sendProgress,
          );
        } catch {
          sendProgress("Audio features unavailable (API restricted)", 0, 0);
        }

        // 5. Collect unique artist IDs and fetch artist data (for genres)
        const artistIds = new Set<string>();
        tracks.forEach((t) => t.artists.forEach((a) => artistIds.add(a.id)));
        const artists = await getArtists(
          [...artistIds],
          auth.accessToken,
          sendProgress,
        );

        // 6. Cache and return
        const libraryData: LibraryData = {
          tracks,
          playlists,
          playlistTracks,
          audioFeatures,
          artists,
          fetchedAt: Date.now(),
        };

        cacheLibrary(auth.userId, libraryData);

        send({ type: "complete", data: libraryData });
        controller.close();
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : "Unknown error";
        console.error("Library fetch error:", errMsg);
        send({ type: "error", message: errMsg });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
