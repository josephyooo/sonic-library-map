import { redirect } from "next/navigation";
import { NextRequest } from "next/server";
import { exchangeCode, getMe } from "@/lib/spotify";
import { getSession } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  if (error) {
    redirect(`/?error=${encodeURIComponent(error)}`);
  }

  if (!code || !state) {
    redirect("/?error=missing_params");
  }

  const session = await getSession();

  if (state !== session.oauthState) {
    redirect("/?error=state_mismatch");
  }

  let destination = "/dashboard";

  try {
    const tokens = await exchangeCode(code);
    const profile = await getMe(tokens.access_token);

    session.accessToken = tokens.access_token;
    session.refreshToken = tokens.refresh_token;
    session.tokenExpiry = Date.now() + tokens.expires_in * 1000;
    session.userId = profile.id;
    session.displayName = profile.display_name;
    session.oauthState = undefined;
    await session.save();
  } catch (err) {
    console.error("OAuth callback error:", err);
    destination = "/?error=auth_failed";
  }

  redirect(destination);
}
