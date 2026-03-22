import { redirect } from "next/navigation";
import { randomBytes } from "crypto";
import { getAuthUrl } from "@/lib/spotify";
import { getSession } from "@/lib/auth";

export async function GET() {
  const state = randomBytes(16).toString("hex");

  const session = await getSession();
  session.oauthState = state;
  await session.save();

  redirect(getAuthUrl(state));
}
