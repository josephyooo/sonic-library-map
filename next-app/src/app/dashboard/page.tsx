import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import DashboardClient from "./DashboardClient";
import ThemeToggle from "@/components/ThemeToggle";

export default async function Dashboard() {
  const session = await getSession();

  if (!session.accessToken) {
    redirect("/");
  }

  return (
    <div
      className="flex h-screen flex-col"
      style={{ background: "var(--ctp-crust)", color: "var(--ctp-text)" }}
    >
      <header
        className="flex items-center justify-between px-6 py-3"
        style={{ borderBottom: "1px solid var(--ctp-surface0)" }}
      >
        <h1 className="text-lg font-bold">Sonic Library Map</h1>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <span className="text-sm" style={{ color: "var(--ctp-subtext0)" }}>
            {session.displayName}
          </span>
          <form action="/api/auth/logout" method="post">
            <button
              type="submit"
              className="rounded-full px-3 py-1 text-sm transition-colors"
              style={{
                border: "1px solid var(--ctp-surface1)",
                color: "var(--ctp-subtext1)",
              }}
            >
              Log out
            </button>
          </form>
        </div>
      </header>
      <main className="flex-1 overflow-hidden">
        <DashboardClient />
      </main>
    </div>
  );
}
