import { NextResponse } from "next/server";
import { refreshAccessToken } from "@/lib/spotify";
import { getSession } from "@/lib/auth";

export async function POST() {
  const session = await getSession();

  if (!session.refreshToken) {
    return NextResponse.json({ error: "No refresh token" }, { status: 401 });
  }

  try {
    const tokens = await refreshAccessToken(session.refreshToken);

    session.accessToken = tokens.access_token;
    if (tokens.refresh_token) {
      session.refreshToken = tokens.refresh_token;
    }
    session.tokenExpiry = Date.now() + tokens.expires_in * 1000;
    await session.save();

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Token refresh error:", err);
    session.destroy();
    return NextResponse.json({ error: "Refresh failed" }, { status: 401 });
  }
}
