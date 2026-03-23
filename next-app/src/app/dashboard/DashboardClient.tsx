"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
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
import ClusterPanel, { type ClusterInsight } from "@/components/ClusterPanel";
import FeatureOverlay from "@/components/FeatureOverlay";
import * as d3 from "d3";

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
  const [umapAxisLabels, setUmapAxisLabels] = useState<{
    x: { name: string; directionLow: string; directionHigh: string } | null;
    y: { name: string; directionLow: string; directionHigh: string } | null;
  }>({ x: null, y: null });
  const [umapLoading, setUmapLoading] = useState(false);
  const umapAbortRef = useRef<AbortController | null>(null);
  const [genreCoords, setGenreCoords] = useState<Record<string, [number, number]> | null>(null);
  const [genreLoading, setGenreLoading] = useState(false);
  const [cachedFeatureCount, setCachedFeatureCount] = useState(0);
  const [trackFeatures, setTrackFeatures] = useState<Record<string, number[]> | null>(null);
  const [colorFeatureIdx, setColorFeatureIdx] = useState<number | null>(null);
  const cachedFeaturesLoaded = useRef(false);
  const [clusterInsights, setClusterInsights] = useState<ClusterInsight[]>([]);
  const [highlightedTracks, setHighlightedTracks] = useState<Set<string> | null>(null);

  // Auto-load cached features when UMAP is first selected
  useEffect(() => {
    if (viewMode !== "umap" || cachedFeaturesLoaded.current || !libraryData) return;
    cachedFeaturesLoaded.current = true;

    (async () => {
      try {
        const response = await fetch("/api/features");
        if (!response.ok) return;
        const data = await response.json();
        const count = data.count ?? 0;
        setCachedFeatureCount(count);
        if (data.features) setTrackFeatures(data.features);

        if (count >= 5) {
          // Compute UMAP from cached features
          const trackIds = libraryData.tracks.map((t) => t.id);
          setUmapLoading(true);
          const umapResponse = await fetch("/api/umap", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ track_ids: trackIds, features: data.features }),
          });
          if (umapResponse.ok) {
            const umapData = await umapResponse.json();
            setUmapCoords(umapData.coordinates);
            if (umapData.x_axis || umapData.y_axis) {
              setUmapAxisLabels({
                x: umapData.x_axis ? { name: umapData.x_axis.name, directionLow: umapData.x_axis.direction_low, directionHigh: umapData.x_axis.direction_high } : null,
                y: umapData.y_axis ? { name: umapData.y_axis.name, directionLow: umapData.y_axis.direction_low, directionHigh: umapData.y_axis.direction_high } : null,
              });
            }
          }
          setUmapLoading(false);
        }
      } catch (err) {
        console.error("Failed to load cached features:", err);
      }
    })();
  }, [viewMode, libraryData]);

  // Fetch clusters when UMAP coordinates update (with enough tracks)
  useEffect(() => {
    if (!umapCoords || !libraryData) return;
    if (Object.keys(umapCoords).length < 20) return;

    const controller = new AbortController();

    (async () => {
      try {
        const response = await fetch("/api/cluster", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            coordinates: umapCoords,
            playlist_tracks: libraryData.playlistTracks,
          }),
          signal: controller.signal,
        });
        if (response.ok) {
          const data = await response.json();
          setClusterInsights(data.insights ?? []);
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        console.error("Cluster fetch error:", err);
      }
    })();

    return () => controller.abort();
  }, [umapCoords, libraryData]);

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

  const trackLookup = useMemo(() => {
    if (!libraryData) return new Map();
    const m = new Map<string, typeof libraryData.tracks[0]>();
    for (const t of libraryData.tracks) m.set(t.id, t);
    return m;
  }, [libraryData]);

  const handleHighlight = useCallback((trackIds: string[] | null) => {
    setHighlightedTracks(trackIds ? new Set(trackIds) : null);
  }, []);

  // Active coordinate set based on view mode
  const activeCoords = viewMode === "umap" ? umapCoords
    : viewMode === "genre" ? genreCoords
    : null;

  // In UMAP/Genre mode with no coords, show empty plot (no fallback)
  const showEmptyPlot = (viewMode === "umap" && !umapCoords)
    || (viewMode === "genre" && !genreCoords);

  // Filter playlists to only those with at least one visible track in the current view
  const visiblePlaylists = useMemo(() => {
    if (!activeCoords || !libraryData) return showEmptyPlot ? [] : playlists;
    return playlists.filter((p) => {
      const trackIds = libraryData.playlistTracks[p.id];
      if (!trackIds) return false;
      return trackIds.some((tid) => tid in activeCoords);
    });
  }, [playlists, activeCoords, libraryData, showEmptyPlot]);

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
    if (!libraryData || showEmptyPlot) return [];
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
  }, [libraryData, trackPlaylistMap, activeCoords, showEmptyPlot]);

  const axisLabels = useMemo(() => {
    if (viewMode === "umap") {
      const xLabel = umapAxisLabels.x
        ? `${umapAxisLabels.x.directionLow} ← → ${umapAxisLabels.x.directionHigh}`
        : "UMAP 1";
      const yLabel = umapAxisLabels.y
        ? `${umapAxisLabels.y.directionLow} ← → ${umapAxisLabels.y.directionHigh}`
        : "UMAP 2";
      return { x: xLabel, y: yLabel };
    }
    if (viewMode === "genre") return { x: "Dense ← → Spiky", y: "Organic ← → Electronic" };
    return { x: "Release Year", y: "Popularity" };
  }, [viewMode, umapAxisLabels]);

  // Feature color overlay: map track ID -> color + normalized value (0-1)
  const { featureColorMap, featureValueMap } = useMemo(() => {
    if (colorFeatureIdx === null || !trackFeatures)
      return { featureColorMap: null, featureValueMap: null };
    const values: { id: string; val: number }[] = [];
    for (const [id, feats] of Object.entries(trackFeatures)) {
      if (feats[colorFeatureIdx] !== undefined) {
        values.push({ id, val: feats[colorFeatureIdx] });
      }
    }
    if (values.length === 0)
      return { featureColorMap: null, featureValueMap: null };
    const extent = d3.extent(values, (v) => v.val) as [number, number];
    const colorScale = d3.scaleSequential(d3.interpolateTurbo).domain(extent);
    const normScale = d3.scaleLinear().domain(extent).range([0, 1]);
    const cMap = new Map<string, string>();
    const vMap = new Map<string, number>();
    for (const { id, val } of values) {
      cMap.set(id, colorScale(val));
      vMap.set(id, normScale(val));
    }
    return { featureColorMap: cMap, featureValueMap: vMap };
  }, [colorFeatureIdx, trackFeatures]);

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

      setCachedFeatureCount(Object.keys(features).length);
      setTrackFeatures({ ...features });

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
          if (data.x_axis || data.y_axis) {
            setUmapAxisLabels({
              x: data.x_axis ? { name: data.x_axis.name, directionLow: data.x_axis.direction_low, directionHigh: data.x_axis.direction_high } : null,
              y: data.y_axis ? { name: data.y_axis.name, directionLow: data.y_axis.direction_low, directionHigh: data.y_axis.direction_high } : null,
            });
          }
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
          highlightedTracks={highlightedTracks}
          featureColorMap={featureColorMap}
          featureValueMap={featureValueMap}
          onHover={setHovered}
          onClick={handleClick}
          xLabel={axisLabels.x}
          yLabel={axisLabels.y}
          xFormat={viewMode === "default" ? formatYear : undefined}
        />
        <div className="absolute left-4 top-4 flex flex-col gap-3">
          <div className="flex gap-3">
            <StatBadge label="Tracks" value={points.length} />
            <StatBadge label="Playlists" value={visiblePlaylists.length} />
            <StatBadge label="Artists" value={libraryData.artists.length} />
          </div>
          <ViewToggle
            current={viewMode}
            genreLoading={genreLoading}
            onChange={handleViewChange}
          />
          {viewMode === "umap" && trackFeatures && (
            <FeatureOverlay
              selected={colorFeatureIdx}
              onChange={setColorFeatureIdx}
            />
          )}
          <div className="w-0 min-w-full">
            <FeatureExtractor
              libraryData={libraryData}
              cachedCount={cachedFeatureCount}
              showButton={viewMode === "umap"}
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

      <div className="flex w-56 flex-col overflow-y-auto">
        <PlaylistLegend
          playlists={playlistColors}
          onToggle={handleToggle}
          onShowAll={handleShowAll}
          onHideAll={handleHideAll}
        />
        {viewMode === "umap" && clusterInsights.length > 0 && (
          <div className="border-t border-zinc-800">
            <ClusterPanel
              insights={clusterInsights}
              trackLookup={trackLookup}
              playlistNames={playlistNames}
              onHighlight={handleHighlight}
            />
          </div>
        )}
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
