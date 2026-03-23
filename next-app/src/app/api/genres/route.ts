import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { scrapeGenreCoordinates, type GenreCoord } from "@/lib/genre-scraper";
import { getCachedLibrary } from "@/lib/db";

export const dynamic = "force-dynamic";

// In-memory cache (persists across requests within the same server process)
let genreCache: { coords: GenreCoord[]; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 1 week

async function getGenreCoords(): Promise<GenreCoord[]> {
  if (genreCache && Date.now() - genreCache.fetchedAt < CACHE_TTL_MS) {
    return genreCache.coords;
  }

  const coords = await scrapeGenreCoordinates();
  genreCache = { coords, fetchedAt: Date.now() };
  return coords;
}

export async function GET() {
  const session = await getSession();
  if (!session.accessToken || !session.userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const library = getCachedLibrary(session.userId);
  if (!library) {
    return NextResponse.json(
      { error: "Library not loaded" },
      { status: 404 },
    );
  }

  try {
    const genreCoords = await getGenreCoords();

    // Build genre name → coordinate lookup
    const genreLookup = new Map<string, { x: number; y: number }>();
    for (const gc of genreCoords) {
      genreLookup.set(gc.name, { x: gc.x, y: gc.y });
    }

    // Build artist ID → genres lookup
    const artistGenres = new Map<string, string[]>();
    for (const artist of library.artists) {
      if (artist.genres.length > 0) {
        artistGenres.set(
          artist.id,
          artist.genres.map((g) => g.toLowerCase()),
        );
      }
    }

    // Map each track to genre coordinates (average of its artists' genres)
    const trackCoords: Record<string, [number, number]> = {};
    for (const track of library.tracks) {
      const xs: number[] = [];
      const ys: number[] = [];

      for (const artist of track.artists) {
        const genres = artistGenres.get(artist.id);
        if (!genres) continue;

        for (const genre of genres) {
          const coord = genreLookup.get(genre);
          if (coord) {
            xs.push(coord.x);
            ys.push(coord.y);
          }
        }
      }

      if (xs.length > 0) {
        trackCoords[track.id] = [
          xs.reduce((a, b) => a + b) / xs.length,
          ys.reduce((a, b) => a + b) / ys.length,
        ];
      }
    }

    return NextResponse.json({
      coordinates: trackCoords,
      genreCount: genreCoords.length,
      mappedTracks: Object.keys(trackCoords).length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Genre scraping failed: ${message}` },
      { status: 502 },
    );
  }
}
