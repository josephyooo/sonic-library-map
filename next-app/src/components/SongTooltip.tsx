"use client";

import type { HoveredPoint } from "./ScatterPlot";

interface SongTooltipProps {
  info: HoveredPoint;
  playlistNames: Map<string, string>;
}

export default function SongTooltip({ info, playlistNames }: SongTooltipProps) {
  const { point, screenX, screenY } = info;
  const { track } = point;
  const albumArt = track.album.images.find((img) => img.width <= 64)?.url
    ?? track.album.images[track.album.images.length - 1]?.url;

  // Position tooltip offset from cursor, flip if near edges
  const style: React.CSSProperties = {
    position: "fixed",
    left: screenX + 16,
    top: screenY - 10,
    zIndex: 50,
    pointerEvents: "none",
  };

  // Flip horizontally if too close to right edge
  if (typeof window !== "undefined" && screenX > window.innerWidth - 280) {
    style.left = screenX - 280;
  }
  // Flip vertically if too close to bottom
  if (typeof window !== "undefined" && screenY > window.innerHeight - 150) {
    style.top = screenY - 120;
  }

  const playlists = point.playlistIds
    .map((id) => playlistNames.get(id))
    .filter(Boolean);

  return (
    <div
      style={style}
      className="flex w-64 gap-3 rounded-lg border border-zinc-700 bg-zinc-900 p-3 shadow-xl"
    >
      {albumArt && (
        <img
          src={albumArt}
          alt=""
          className="h-12 w-12 flex-shrink-0 rounded"
          width={48}
          height={48}
        />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-white">{track.name}</p>
        <p className="truncate text-xs text-zinc-400">
          {track.artists.map((a) => a.name).join(", ")}
        </p>
        <p className="truncate text-xs text-zinc-500">{track.album.name}</p>
        {playlists.length > 0 && (
          <p className="mt-1 truncate text-xs text-zinc-500">
            {playlists.length === 1
              ? playlists[0]
              : `${playlists[0]} +${playlists.length - 1} more`}
          </p>
        )}
      </div>
    </div>
  );
}
