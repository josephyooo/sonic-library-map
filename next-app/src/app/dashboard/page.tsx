import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import DashboardClient from "./DashboardClient";

export default async function Dashboard() {
  const session = await getSession();

  if (!session.accessToken) {
    redirect("/");
  }

  return (
    <div className="flex flex-1 flex-col bg-zinc-950 text-white">
      <header className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
        <h1 className="text-xl font-bold">Spotify Library Viz</h1>
        <div className="flex items-center gap-4">
          <span className="text-sm text-zinc-400">
            Logged in as{" "}
            <span className="font-medium text-white">
              {session.displayName}
            </span>
          </span>
          <a
            href="/api/auth/logout"
            className="rounded-full border border-zinc-700 px-4 py-1.5 text-sm transition-colors hover:bg-zinc-800"
          >
            Log out
          </a>
        </div>
      </header>
      <main className="flex flex-1 items-center justify-center">
        <DashboardClient />
      </main>
    </div>
  );
}
