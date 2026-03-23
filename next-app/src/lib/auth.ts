import { getIronSession, type SessionOptions } from "iron-session";
import { cookies } from "next/headers";

export interface SessionData {
  accessToken?: string;
  refreshToken?: string;
  tokenExpiry?: number;
  userId?: string;
  displayName?: string;
  oauthState?: string;
}

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  throw new Error(
    "SESSION_SECRET environment variable is required and must be at least 32 characters",
  );
}

export const sessionOptions: SessionOptions = {
  password: process.env.SESSION_SECRET,
  cookieName: "spotify-viz-session",
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
  },
};

export async function getSession() {
  const cookieStore = await cookies();
  return getIronSession<SessionData>(cookieStore, sessionOptions);
}
