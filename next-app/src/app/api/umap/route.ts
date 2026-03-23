import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

const UMAP_SERVICE_URL =
  process.env.UMAP_SERVICE_URL || "http://127.0.0.1:8000";

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session.accessToken) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json();

  let response: Response;
  try {
    response = await fetch(`${UMAP_SERVICE_URL}/umap`, {
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

  if (!response.ok) {
    const error = await response.text();
    return NextResponse.json(
      { error: `UMAP computation failed: ${error}` },
      { status: 502 },
    );
  }

  const data = await response.json();
  return NextResponse.json(data);
}
