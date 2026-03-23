"use client";

import type { HoveredPoint } from "./ScatterPlot";

interface SongTooltipProps {
  info: HoveredPoint;
  playlistNames: Map<string, string>;
  featureLabel?: string | null;
}

export default function SongTooltip({ info, playlistNames, featureLabel }: SongTooltipProps) {
  const { point, screenX, screenY } = info;
  const { track } = point;
  const albumArt = track.album.images.find((img) => img.width <= 64)?.url
    ?? track.album.images[track.album.images.length - 1]?.url;

  const flipX = screenX > window.innerWidth - 280;
  const flipY = screenY > window.innerHeight - 150;
  const style: React.CSSProperties = {
    position: "fixed",
    left: flipX ? screenX - 280 : screenX + 16,
    top: flipY ? screenY - 120 : screenY - 10,
    zIndex: 50,
    pointerEvents: "none",
  };

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
        {featureLabel && (
          <p className="mt-1 text-xs font-medium text-green-400">{featureLabel}</p>
        )}
        {playlists.length > 0 && (
          <p className={`${featureLabel ? "" : "mt-1 "}truncate text-xs text-zinc-500`}>
            {playlists.length === 1
              ? playlists[0]
              : `${playlists[0]} +${playlists.length - 1} more`}
          </p>
        )}
      </div>
    </div>
  );
}
