"use client";

import { useState, useMemo, useCallback } from "react";
import type { LibraryData, PlotPoint } from "@/lib/types";
import LibraryLoader from "@/components/LibraryLoader";
import ScatterPlot, {
  type PlaylistColor,
  type HoveredPoint,
} from "@/components/ScatterPlot";
import SongTooltip from "@/components/SongTooltip";
import PlaylistLegend from "@/components/PlaylistLegend";

// 20 visually distinct colors for playlist assignment
const PALETTE = [
  "#22c55e", "#3b82f6", "#ef4444", "#f59e0b", "#a855f7",
  "#ec4899", "#14b8a6", "#f97316", "#6366f1", "#84cc16",
  "#06b6d4", "#e11d48", "#8b5cf6", "#10b981", "#d946ef",
  "#0ea5e9", "#facc15", "#fb923c", "#34d399", "#c084fc",
];

function parseReleaseYear(date: string): number {
  const year = parseInt(date.slice(0, 4), 10);
  return isNaN(year) ? 2000 : year;
}

export default function DashboardClient() {
  const [libraryData, setLibraryData] = useState<LibraryData | null>(null);
  const [hovered, setHovered] = useState<HoveredPoint | null>(null);
  const [playlistVisibility, setPlaylistVisibility] = useState<
    Record<string, boolean>
  >({});

  // Deduplicated playlists
  const playlists = useMemo(() => {
    if (!libraryData) return [];
    const seen = new Set<string>();
    return libraryData.playlists.filter((p) => {
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });
  }, [libraryData]);

  // Build reverse lookup: trackId -> playlistIds[]
  const trackPlaylistMap = useMemo(() => {
    if (!libraryData) return new Map<string, string[]>();
    const map = new Map<string, string[]>();
    for (const [pid, trackIds] of Object.entries(libraryData.playlistTracks)) {
      for (const tid of trackIds) {
        const existing = map.get(tid);
        if (existing) {
          if (!existing.includes(pid)) existing.push(pid);
        } else {
          map.set(tid, [pid]);
        }
      }
    }
    return map;
  }, [libraryData]);

  // Playlist color assignments
  const playlistColors = useMemo((): PlaylistColor[] => {
    return playlists.map((p, i) => ({
      id: p.id,
      name: p.name,
      color: PALETTE[i % PALETTE.length],
      visible: playlistVisibility[p.id] ?? true,
    }));
  }, [playlists, playlistVisibility]);

  // Playlist name lookup for tooltip
  const playlistNames = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of playlists) m.set(p.id, p.name);
    return m;
  }, [playlists]);

  // Transform tracks into plot points
  const points = useMemo((): PlotPoint[] => {
    if (!libraryData) return [];

    // Collect all unique tracks (saved + playlist)
    const trackMap = new Map<string, PlotPoint>();

    for (const track of libraryData.tracks) {
      trackMap.set(track.id, {
        id: track.id,
        x: parseReleaseYear(track.album.release_date),
        y: track.popularity,
        track,
        playlistIds: trackPlaylistMap.get(track.id) ?? [],
      });
    }

    // Also add tracks that are only in playlists
    for (const [pid, trackIds] of Object.entries(libraryData.playlistTracks)) {
      for (const tid of trackIds) {
        if (trackMap.has(tid)) continue;
        // We don't have full track data for playlist-only tracks
        // They were fetched but stored as IDs only — skip for now
      }
    }

    return [...trackMap.values()];
  }, [libraryData, trackPlaylistMap]);

  const handleToggle = useCallback((id: string) => {
    setPlaylistVisibility((prev) => ({ ...prev, [id]: !(prev[id] ?? true) }));
  }, []);

  const handleShowAll = useCallback(() => {
    setPlaylistVisibility({});
  }, []);

  const handleHideAll = useCallback(() => {
    const vis: Record<string, boolean> = {};
    for (const p of playlists) vis[p.id] = false;
    setPlaylistVisibility(vis);
  }, [playlists]);

  const handleClick = useCallback((point: PlotPoint) => {
    window.open(point.track.external_urls.spotify, "_blank");
  }, []);

  if (!libraryData) {
    return (
      <div className="flex h-full items-center justify-center">
        <LibraryLoader onLoaded={setLibraryData} />
      </div>
    );
  }

  return (
    <div className="flex h-full w-full">
      {/* Main scatter plot area */}
      <div className="relative flex-1">
        <ScatterPlot
          points={points}
          playlistColors={playlistColors}
          onHover={setHovered}
          onClick={handleClick}
          xLabel="Release Year"
          yLabel="Popularity"
        />
        {/* Stats bar */}
        <div className="absolute left-4 top-4 flex gap-3">
          <StatBadge label="Tracks" value={points.length} />
          <StatBadge label="Playlists" value={playlists.length} />
          <StatBadge label="Artists" value={libraryData.artists.length} />
        </div>
        {/* Tooltip */}
        {hovered && (
          <SongTooltip info={hovered} playlistNames={playlistNames} />
        )}
      </div>

      {/* Playlist legend sidebar */}
      <div className="w-56">
        <PlaylistLegend
          playlists={playlistColors}
          onToggle={handleToggle}
          onShowAll={handleShowAll}
          onHideAll={handleHideAll}
        />
      </div>
    </div>
  );
}

function StatBadge({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-900/80 px-2.5 py-1 backdrop-blur-sm">
      <span className="text-xs font-medium tabular-nums text-white">
        {value.toLocaleString()}
      </span>
      <span className="ml-1 text-xs text-zinc-500">{label}</span>
    </div>
  );
}
