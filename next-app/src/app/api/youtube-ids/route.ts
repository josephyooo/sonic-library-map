import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

const UMAP_SERVICE_URL =
  process.env.UMAP_SERVICE_URL || "http://127.0.0.1:8000";

export async function GET() {
  const session = await getSession();
  if (!session.accessToken || !session.userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { getCachedLibrary } = await import("@/lib/db");
  const library = getCachedLibrary(session.userId);
  const trackIds = library?.tracks.map((t: { id: string }) => t.id) ?? [];

  try {
    const response = await fetch(`${UMAP_SERVICE_URL}/youtube-ids`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ track_ids: trackIds }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      return NextResponse.json({ ids: {} }, { status: 200 });
    }
    return NextResponse.json(await response.json());
  } catch {
    return NextResponse.json({ ids: {} }, { status: 200 });
  }
}
