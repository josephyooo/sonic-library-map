"use client";

import type { PlaylistColor } from "./ScatterPlot";

interface PlaylistLegendProps {
  playlists: PlaylistColor[];
  onToggle: (id: string) => void;
  onShowAll: () => void;
  onHideAll: () => void;
}

export default function PlaylistLegend({
  playlists,
  onToggle,
  onShowAll,
  onHideAll,
}: PlaylistLegendProps) {
  const visibleCount = playlists.filter((p) => p.visible).length;

  return (
    <div className="flex h-full flex-col border-l border-zinc-800 bg-zinc-950">
      <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
        <span className="text-xs font-medium text-zinc-400">
          Playlists ({visibleCount}/{playlists.length})
        </span>
        <div className="flex gap-1">
          <button
            onClick={onShowAll}
            className="rounded px-1.5 py-0.5 text-xs text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
          >
            All
          </button>
          <button
            onClick={onHideAll}
            className="rounded px-1.5 py-0.5 text-xs text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
          >
            None
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {playlists.map((pl) => (
          <button
            key={pl.id}
            onClick={() => onToggle(pl.id)}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-colors hover:bg-zinc-800/50"
          >
            <span
              className="h-3 w-3 flex-shrink-0 rounded-full border border-zinc-700"
              style={{
                backgroundColor: pl.visible ? pl.color : "transparent",
              }}
            />
            <span
              className={`truncate text-xs ${pl.visible ? "text-zinc-200" : "text-zinc-600"}`}
            >
              {pl.name}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
