"use client";

import { useState, useMemo, useCallback, useRef } from "react";
import type { LibraryData, PlotPoint } from "@/lib/types";
import LibraryLoader from "@/components/LibraryLoader";
import ScatterPlot, {
  type PlaylistColor,
  type HoveredPoint,
} from "@/components/ScatterPlot";
import SongTooltip from "@/components/SongTooltip";
import PlaylistLegend from "@/components/PlaylistLegend";
import FeatureExtractor from "@/components/FeatureExtractor";
import ViewToggle, { type ViewMode } from "@/components/ViewToggle";

const PALETTE = [
  "#22c55e", "#3b82f6", "#ef4444", "#f59e0b", "#a855f7",
  "#ec4899", "#14b8a6", "#f97316", "#6366f1", "#84cc16",
  "#06b6d4", "#e11d48", "#8b5cf6", "#10b981", "#d946ef",
  "#0ea5e9", "#facc15", "#fb923c", "#34d399", "#c084fc",
];

const formatYear = (tick: number) => String(Math.round(tick));

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
  const [viewMode, setViewMode] = useState<ViewMode>("default");
  const [umapCoords, setUmapCoords] = useState<Record<string, [number, number]> | null>(null);
  const [umapLoading, setUmapLoading] = useState(false);
  const umapAbortRef = useRef<AbortController | null>(null);
  const [genreCoords, setGenreCoords] = useState<Record<string, [number, number]> | null>(null);
  const [genreLoading, setGenreLoading] = useState(false);

  const playlists = useMemo(() => {
    if (!libraryData) return [];
    const seen = new Set<string>();
    return libraryData.playlists.filter((p) => {
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });
  }, [libraryData]);

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

  // Active coordinate set based on view mode
  const activeCoords = viewMode === "umap" ? umapCoords
    : viewMode === "genre" ? genreCoords
    : null;

  // Filter playlists to only those with at least one visible track in the current view
  const visiblePlaylists = useMemo(() => {
    if (!activeCoords || !libraryData) return playlists;
    return playlists.filter((p) => {
      const trackIds = libraryData.playlistTracks[p.id];
      if (!trackIds) return false;
      return trackIds.some((tid) => tid in activeCoords);
    });
  }, [playlists, activeCoords, libraryData]);

  const playlistColors = useMemo((): PlaylistColor[] => {
    return visiblePlaylists.map((p, i) => ({
      id: p.id,
      name: p.name,
      color: PALETTE[i % PALETTE.length],
      visible: playlistVisibility[p.id] ?? true,
    }));
  }, [visiblePlaylists, playlistVisibility]);

  const playlistNames = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of visiblePlaylists) m.set(p.id, p.name);
    return m;
  }, [visiblePlaylists]);

  const points = useMemo((): PlotPoint[] => {
    if (!libraryData) return [];
    return libraryData.tracks
      .filter((track) => !activeCoords || track.id in activeCoords)
      .map((track) => {
        const coord = activeCoords?.[track.id];
        return {
          id: track.id,
          x: coord ? coord[0] : parseReleaseYear(track.album.release_date),
          y: coord ? coord[1] : track.popularity,
          track,
          playlistIds: trackPlaylistMap.get(track.id) ?? [],
        };
      });
  }, [libraryData, trackPlaylistMap, activeCoords]);

  const axisLabels = useMemo(() => {
    if (viewMode === "umap" && umapCoords) return { x: "UMAP 1", y: "UMAP 2" };
    if (viewMode === "genre" && genreCoords) return { x: "Dense ← → Spiky", y: "Organic ← → Electronic" };
    return { x: "Release Year", y: "Popularity" };
  }, [viewMode, umapCoords, genreCoords]);

  const handleToggle = useCallback((id: string) => {
    setPlaylistVisibility((prev) => ({ ...prev, [id]: !(prev[id] ?? true) }));
  }, []);

  const handleShowAll = useCallback(() => {
    setPlaylistVisibility({});
  }, []);

  const handleHideAll = useCallback(() => {
    const vis: Record<string, boolean> = {};
    for (const p of visiblePlaylists) vis[p.id] = false;
    setPlaylistVisibility(vis);
  }, [visiblePlaylists]);

  const handleClick = useCallback((point: PlotPoint) => {
    window.open(point.track.external_urls.spotify, "_blank");
  }, []);

  const handleFeaturesReady = useCallback(
    async (features: Record<string, number[]>) => {
      if (!libraryData) return;

      umapAbortRef.current?.abort();
      const controller = new AbortController();
      umapAbortRef.current = controller;

      setUmapLoading(true);
      try {
        const trackIds = libraryData.tracks.map((t) => t.id);
        const response = await fetch("/api/umap", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ track_ids: trackIds, features }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`UMAP failed: ${response.status}`);
        const data = await response.json();
        if (!controller.signal.aborted) {
          setUmapCoords(data.coordinates);
          // Auto-switch to UMAP view on first result
          setViewMode((prev) => (prev === "default" ? "umap" : prev));
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        console.error("UMAP error:", err);
      } finally {
        if (!controller.signal.aborted) {
          setUmapLoading(false);
        }
      }
    },
    [libraryData],
  );

  const handleViewChange = useCallback(
    async (mode: ViewMode) => {
      setViewMode(mode);

      // Fetch genre coordinates on first switch to genre view
      if (mode === "genre" && !genreCoords && !genreLoading) {
        setGenreLoading(true);
        try {
          const response = await fetch("/api/genres");
          if (!response.ok) throw new Error(`Genres failed: ${response.status}`);
          const data = await response.json();
          setGenreCoords(data.coordinates);
        } catch (err) {
          console.error("Genre fetch error:", err);
        } finally {
          setGenreLoading(false);
        }
      }
    },
    [genreCoords, genreLoading],
  );

  if (!libraryData) {
    return (
      <div className="flex h-full items-center justify-center">
        <LibraryLoader onLoaded={setLibraryData} />
      </div>
    );
  }

  return (
    <div className="flex h-full w-full">
      <div className="relative flex-1">
        <ScatterPlot
          points={points}
          playlistColors={playlistColors}
          onHover={setHovered}
          onClick={handleClick}
          xLabel={axisLabels.x}
          yLabel={axisLabels.y}
          xFormat={viewMode === "default" ? formatYear : undefined}
        />
        <div className="absolute left-4 top-4 flex flex-col gap-3">
          <div className="flex gap-3">
            <StatBadge label="Tracks" value={points.length} />
            <StatBadge label="Playlists" value={playlists.length} />
            <StatBadge label="Artists" value={libraryData.artists.length} />
          </div>
          <ViewToggle
            current={viewMode}
            umapAvailable={umapCoords !== null}
            genreAvailable={genreCoords !== null}
            genreLoading={genreLoading}
            onChange={handleViewChange}
          />
          <div className="w-0 min-w-full">
            <FeatureExtractor
              libraryData={libraryData}
              onFeaturesReady={handleFeaturesReady}
            />
          </div>
          {umapLoading && (
            <div className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900/80 px-2.5 py-1 backdrop-blur-sm">
              <div className="h-3 w-3 animate-spin rounded-full border border-zinc-600 border-t-green-500" />
              <span className="text-xs text-zinc-400">Computing UMAP...</span>
            </div>
          )}
        </div>
        {hovered && (
          <SongTooltip info={hovered} playlistNames={playlistNames} />
        )}
      </div>

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
