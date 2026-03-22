"use client";

import { useState } from "react";
import type { LibraryData } from "@/lib/types";
import LibraryLoader from "@/components/LibraryLoader";

export default function DashboardClient() {
  const [libraryData, setLibraryData] = useState<LibraryData | null>(null);

  if (!libraryData) {
    return <LibraryLoader onLoaded={setLibraryData} />;
  }

  const trackCount = libraryData.tracks.length;
  const playlistCount = libraryData.playlists.length;
  const artistCount = libraryData.artists.length;
  const featuresCount = libraryData.audioFeatures.length;

  return (
    <div className="w-full max-w-2xl space-y-6 p-6">
      <div className="text-center">
        <p className="text-2xl font-semibold">Library loaded!</p>
        <p className="mt-1 text-sm text-zinc-400">
          Fetched{" "}
          {new Date(libraryData.fetchedAt).toLocaleString()}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Saved Tracks" value={trackCount} />
        <StatCard label="Playlists" value={playlistCount} />
        <StatCard label="Artists" value={artistCount} />
        <StatCard label="Audio Features" value={featuresCount} />
      </div>

      <div className="rounded-lg border border-zinc-800 p-4">
        <h2 className="mb-3 text-sm font-medium text-zinc-400">
          Your Playlists
        </h2>
        <div className="max-h-64 space-y-2 overflow-y-auto">
          {libraryData.playlists
            .filter((p, i, arr) => arr.findIndex((x) => x.id === p.id) === i)
            .map((p) => (
            <div
              key={p.id}
              className="flex items-center justify-between rounded-md bg-zinc-900 px-3 py-2"
            >
              <span className="text-sm">{p.name}</span>
              <span className="text-xs text-zinc-500">
                {libraryData.playlistTracks[p.id]?.length ?? 0} tracks
              </span>
            </div>
          ))}
        </div>
      </div>

      <p className="text-center text-sm text-zinc-500">
        Visualization coming in Phase 3...
      </p>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-zinc-800 p-4 text-center">
      <p className="text-2xl font-bold tabular-nums">{value.toLocaleString()}</p>
      <p className="mt-1 text-xs text-zinc-400">{label}</p>
    </div>
  );
}
