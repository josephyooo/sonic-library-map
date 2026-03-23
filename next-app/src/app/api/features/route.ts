import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

const UMAP_SERVICE_URL =
  process.env.UMAP_SERVICE_URL || "http://127.0.0.1:8000";

export async function GET() {
  const session = await getSession();
  if (!session.accessToken) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let response: Response;
  try {
    response = await fetch(`${UMAP_SERVICE_URL}/features`, {
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    return NextResponse.json(
      { error: "Analysis service unavailable — is the Python sidecar running?" },
      { status: 502 },
    );
  }

  if (!response.ok) {
    return NextResponse.json(
      { error: "Failed to fetch cached features" },
      { status: 502 },
    );
  }

  const data = await response.json();
  return NextResponse.json(data);
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session.accessToken) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json();

  // Proxy to Python sidecar, streaming SSE back to client
  let response: Response;
  try {
    response = await fetch(`${UMAP_SERVICE_URL}/features`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    return NextResponse.json(
      { error: "Analysis service unavailable — is the Python sidecar running?" },
      { status: 502 },
    );
  }

  if (!response.ok || !response.body) {
    return NextResponse.json(
      { error: "Feature extraction failed" },
      { status: 502 },
    );
  }

  // Stream the SSE response through to the client
  return new Response(response.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
