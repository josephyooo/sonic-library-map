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
import type { ClusterInsight } from "@/components/ClusterPanel";
import FeatureOverlay, { OVERLAY_FEATURES } from "@/components/FeatureOverlay";
import AxisSelector, { AXIS_YEAR, AXIS_POPULARITY } from "@/components/AxisSelector";
import PreviewPlayer from "@/components/PreviewPlayer";
import { handleApiError, parseAxisLabel } from "@/lib/api";
import * as d3 from "d3";

const PALETTE = [
  "#22c55e", "#3b82f6", "#ef4444", "#f59e0b", "#a855f7",
  "#ec4899", "#14b8a6", "#f97316", "#6366f1", "#84cc16",
  "#06b6d4", "#e11d48", "#8b5cf6", "#10b981", "#d946ef",
  "#0ea5e9", "#facc15", "#fb923c", "#34d399", "#c084fc",
];

const formatYear = (tick: number) => String(Math.round(tick));

/** Tick formatters for raw feature axes. BPM is stored as bpm/250. */
const AXIS_TICK_FORMATTERS: Record<number, (v: number) => string> = {
  27: (v) => `${Math.round(v * 250)}`,       // BPM (stored normalized)
  26: (v) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}`, // Brightness (Hz)
  39: (v) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}`, // High-Freq Energy (Hz)
  32: (v) => `${v.toFixed(0)}`,               // Loudness (LUFS)
};

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
  const [rawFeatures, setRawFeatures] = useState<Record<string, number[]> | null>(null);
  const [colorFeatureIdx, setColorFeatureIdx] = useState<number | null>(null);
  const cachedFeaturesLoaded = useRef(false);
  const [clusterInsights, setClusterInsights] = useState<ClusterInsight[]>([]);
  const [clusterLabels, setClusterLabels] = useState<Record<string, number> | null>(null);
  const [highlightedTracks, setHighlightedTracks] = useState<Set<string> | null>(null);
  const [customXIdx, setCustomXIdx] = useState(AXIS_YEAR);
  const [customYIdx, setCustomYIdx] = useState(AXIS_POPULARITY);
  const [youtubeIds, setYoutubeIds] = useState<Record<string, [string, number]>>({});
  const [previewEnabled, setPreviewEnabled] = useState(false);
  const [previewVideoId, setPreviewVideoId] = useState<string | null>(null);
  const [previewStart, setPreviewStart] = useState(30);
  const [previewStatus, setPreviewStatus] = useState<"idle" | "waiting" | "loading" | "playing">("idle");

  // Auto-load cached features when UMAP is first selected
  useEffect(() => {
    if (viewMode !== "umap" || cachedFeaturesLoaded.current || !libraryData) return;
    cachedFeaturesLoaded.current = true;

    (async () => {
      try {
        const response = await fetch("/api/features");
        handleApiError(response);
        if (!response.ok) return;
        const data = await response.json();
        const count = data.count ?? 0;
        setCachedFeatureCount(count);
        if (data.raw_features) setRawFeatures(data.raw_features);

        if (count >= 5) {
          // Compute UMAP from cached TF embeddings, with raw features for axis labels
          const trackIds = libraryData.tracks.map((t) => t.id);
          setUmapLoading(true);
          const umapResponse = await fetch("/api/umap", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              track_ids: trackIds,
              features: data.features,
              raw_features: data.raw_features ?? null,
            }),
          });
          handleApiError(umapResponse);
          if (umapResponse.ok) {
            const umapData = await umapResponse.json();
            setUmapCoords(umapData.coordinates);
            if (umapData.x_axis || umapData.y_axis) {
              setUmapAxisLabels({
                x: parseAxisLabel(umapData.x_axis),
                y: parseAxisLabel(umapData.y_axis),
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
        handleApiError(response);
        if (response.ok) {
          const data = await response.json();
          setClusterInsights(data.insights ?? []);
          setClusterLabels(data.labels ?? null);
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

  // Load YouTube IDs once per session for hover-preview playback.
  useEffect(() => {
    if (!libraryData) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/youtube-ids");
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setYoutubeIds(data.ids ?? {});
      } catch {
        // silent — preview just won't work
      }
    })();
    return () => { cancelled = true; };
  }, [libraryData]);

  // Hover-triggered preview: wait 1s on the same point, then cue up its YT video.
  const hoveredId = hovered?.point.id ?? null;
  useEffect(() => {
    if (!previewEnabled || !hoveredId) {
      setPreviewVideoId(null);
      setPreviewStatus("idle");
      return;
    }
    const match = youtubeIds[hoveredId];
    if (!match) {
      setPreviewVideoId(null);
      setPreviewStatus("idle");
      return;
    }
    const [videoId, durationS] = match;
    setPreviewStart(durationS > 60 ? Math.max(0, Math.floor(durationS / 3)) : 0);
    setPreviewVideoId(videoId);
    setPreviewStatus("loading");
  }, [hoveredId, previewEnabled, youtubeIds]);

  // Custom axes: build coordinate map from raw features or track metadata
  const customCoords = useMemo((): Record<string, [number, number]> | null => {
    if (viewMode !== "custom" || !libraryData) return null;
    const tracks = libraryData.tracks;

    function getVal(track: typeof tracks[0], idx: number): number | null {
      if (idx === AXIS_YEAR) return parseReleaseYear(track.album.release_date);
      if (idx === AXIS_POPULARITY) return track.popularity;
      // Raw feature index
      if (!rawFeatures) return null;
      const feats = rawFeatures[track.id];
      return feats?.[idx] ?? null;
    }

    const coords: Record<string, [number, number]> = {};
    for (const track of tracks) {
      const x = getVal(track, customXIdx);
      const y = getVal(track, customYIdx);
      if (x !== null && y !== null) coords[track.id] = [x, y];
    }
    return Object.keys(coords).length > 0 ? coords : null;
  }, [viewMode, libraryData, rawFeatures, customXIdx, customYIdx]);

  // Active coordinate set based on view mode
  const activeCoords = viewMode === "umap" ? umapCoords
    : viewMode === "genre" ? genreCoords
    : viewMode === "custom" ? customCoords
    : null;

  // In coord-based modes with no coords, show empty plot (no fallback)
  const showEmptyPlot = (viewMode === "umap" && !umapCoords)
    || (viewMode === "genre" && !genreCoords)
    || (viewMode === "custom" && !customCoords);

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

  // Cluster overlay: in UMAP mode, synthesize an extra "playlist" per HDBSCAN cluster
  // label (skipping noise = -1) so ScatterPlot draws a hull for each. These are *not*
  // shown in the legend — they only exist as visual hulls on the map.
  const { clusterColors, trackClusterMap } = useMemo(() => {
    if (viewMode !== "umap" || !clusterLabels) {
      return { clusterColors: [] as PlaylistColor[], trackClusterMap: new Map<string, string[]>() };
    }
    const byLabel = new Map<number, string[]>();
    for (const [tid, label] of Object.entries(clusterLabels)) {
      if (label === -1) continue;
      const arr = byLabel.get(label);
      if (arr) arr.push(tid);
      else byLabel.set(label, [tid]);
    }
    const colors: PlaylistColor[] = [];
    const map = new Map<string, string[]>();
    const sorted = [...byLabel.keys()].sort((a, b) => a - b);
    sorted.forEach((label, i) => {
      const members = byLabel.get(label)!;
      const id = `_cluster_${label}`;
      colors.push({
        id,
        name: `${members.length}`,
        color: PALETTE[i % PALETTE.length],
        visible: true,
      });
      for (const tid of members) map.set(tid, [id]);
    });
    return { clusterColors: colors, trackClusterMap: map };
  }, [viewMode, clusterLabels]);

  const scatterPlotColors = useMemo(
    () => [...playlistColors, ...clusterColors],
    [playlistColors, clusterColors],
  );

  const points = useMemo((): PlotPoint[] => {
    if (!libraryData || showEmptyPlot) return [];
    return libraryData.tracks
      .filter((track) => !activeCoords || track.id in activeCoords)
      .map((track) => {
        const coord = activeCoords?.[track.id];
        const realIds = trackPlaylistMap.get(track.id) ?? [];
        const clusterIds = trackClusterMap.get(track.id) ?? [];
        return {
          id: track.id,
          x: coord ? coord[0] : parseReleaseYear(track.album.release_date),
          y: coord ? coord[1] : track.popularity,
          track,
          playlistIds: clusterIds.length > 0 ? [...realIds, ...clusterIds] : realIds,
        };
      });
  }, [libraryData, trackPlaylistMap, trackClusterMap, activeCoords, showEmptyPlot]);

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
    if (viewMode === "custom") {
      const nameFor = (idx: number) => {
        if (idx === AXIS_YEAR) return "Release Year";
        if (idx === AXIS_POPULARITY) return "Popularity";
        return OVERLAY_FEATURES.find((f) => f.idx === idx)?.name ?? "?";
      };
      return { x: nameFor(customXIdx), y: nameFor(customYIdx) };
    }
    return { x: "Release Year", y: "Popularity" };
  }, [viewMode, umapAxisLabels, customXIdx, customYIdx]);

  const customAxisFormats = useMemo(() => {
    if (viewMode !== "custom") return { x: undefined, y: undefined };
    const fmtFor = (idx: number) => {
      if (idx === AXIS_YEAR) return formatYear;
      return AXIS_TICK_FORMATTERS[idx];
    };
    return { x: fmtFor(customXIdx), y: fmtFor(customYIdx) };
  }, [viewMode, customXIdx, customYIdx]);

  // Feature color overlay: map track ID -> color + normalized value (0-1)
  const { featureColorMap, featureValueMap } = useMemo(() => {
    if (colorFeatureIdx === null || !rawFeatures)
      return { featureColorMap: null, featureValueMap: null };
    const values: { id: string; val: number }[] = [];
    for (const [id, feats] of Object.entries(rawFeatures)) {
      if (feats[colorFeatureIdx] !== undefined) {
        values.push({ id, val: feats[colorFeatureIdx] });
      }
    }
    if (values.length === 0)
      return { featureColorMap: null, featureValueMap: null };
    const extent = d3.extent(values, (v) => v.val) as [number, number];
    const colorScale = d3.scaleSequential(d3.interpolateViridis).domain(extent);
    const normScale = d3.scaleLinear().domain(extent).range([0, 1]);
    const cMap = new Map<string, string>();
    const vMap = new Map<string, number>();
    for (const { id, val } of values) {
      cMap.set(id, colorScale(val));
      vMap.set(id, normScale(val));
    }
    return { featureColorMap: cMap, featureValueMap: vMap };
  }, [colorFeatureIdx, rawFeatures]);

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
    window.open(point.track.external_urls.spotify, "_blank", "noopener,noreferrer");
  }, []);

  const handleFeaturesReady = useCallback(
    async (features: Record<string, number[]>) => {
      if (!libraryData) return;

      setCachedFeatureCount(Object.keys(features).length);

      umapAbortRef.current?.abort();
      const controller = new AbortController();
      umapAbortRef.current = controller;

      setUmapLoading(true);
      try {
        const trackIds = libraryData.tracks.map((t) => t.id);
        // Skip raw_features during progressive updates to keep payload small
        // (1280-dim embeddings alone can be ~10MB for a large library)
        const response = await fetch("/api/umap", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ track_ids: trackIds, features }),
          signal: controller.signal,
        });
        handleApiError(response);
        if (!response.ok) throw new Error(`UMAP failed: ${response.status}`);
        const data = await response.json();
        if (!controller.signal.aborted) {
          setUmapCoords(data.coordinates);
          if (data.x_axis || data.y_axis) {
            setUmapAxisLabels({
              x: parseAxisLabel(data.x_axis),
              y: parseAxisLabel(data.y_axis),
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
          handleApiError(response);
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
          playlistColors={scatterPlotColors}
          highlightedTracks={highlightedTracks}
          featureColorMap={featureColorMap}
          featureValueMap={featureValueMap}
          onHover={setHovered}
          onClick={handleClick}
          xLabel={axisLabels.x}
          yLabel={axisLabels.y}
          xFormat={viewMode === "default" ? formatYear : customAxisFormats.x}
          yFormat={customAxisFormats.y}
        />
        {points.length === 0 && !umapLoading && !genreLoading && viewMode !== "default" && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <p className="text-sm text-zinc-400">
              {viewMode === "umap"
                ? "No audio features extracted yet. Click \u2018Resume extraction\u2019 to start."
                : viewMode === "custom"
                ? "No audio features extracted yet. Extract features in UMAP mode first."
                : "No genre data available for your tracks."}
            </p>
          </div>
        )}
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
          {viewMode === "umap" && rawFeatures && (
            <FeatureOverlay
              selected={colorFeatureIdx}
              onChange={setColorFeatureIdx}
            />
          )}
          {viewMode === "custom" && (
            <AxisSelector
              xIdx={customXIdx}
              yIdx={customYIdx}
              onChangeX={setCustomXIdx}
              onChangeY={setCustomYIdx}
            />
          )}
          <div className="w-0 min-w-full">
            <FeatureExtractor
              libraryData={libraryData}
              cachedCount={cachedFeatureCount}
              showButton={viewMode === "umap"}
              onFeaturesReady={handleFeaturesReady}
              onRawFeaturesReady={setRawFeatures}
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
          <SongTooltip
            info={hovered}
            playlistNames={playlistNames}
            previewStatus={previewEnabled ? previewStatus : "idle"}
            featureLabel={(() => {
              if (colorFeatureIdx === null || !rawFeatures) return null;
              const feat = OVERLAY_FEATURES.find((f) => f.idx === colorFeatureIdx);
              const raw = rawFeatures[hovered.point.id]?.[colorFeatureIdx];
              if (!feat || raw === undefined) return null;
              return `${feat.name}: ${feat.format(raw)}`;
            })()}
          />
        )}
        <button
          type="button"
          onClick={() => setPreviewEnabled((v) => !v)}
          className="absolute bottom-4 right-4 rounded-md border border-zinc-800 bg-zinc-900/80 px-2.5 py-1 text-xs text-zinc-300 backdrop-blur-sm transition-colors hover:border-zinc-700 hover:bg-zinc-900"
          title={previewEnabled ? "Hover a point for 1s to preview" : "Enable YouTube preview on hover"}
        >
          {previewEnabled ? "🔊 Preview: on" : "🔇 Preview: off"}
        </button>
        <PreviewPlayer
          videoId={previewVideoId}
          startSeconds={previewStart}
          enabled={previewEnabled}
          onStateChange={(s) => {
            setPreviewStatus((prev) => {
              if (s === "playing") return "playing";
              if (s === "buffering") return prev === "playing" ? "playing" : "loading";
              if (s === "stopped") return prev === "waiting" ? "waiting" : "idle";
              return prev;
            });
          }}
        />
      </div>

      <div className="flex w-56 flex-col overflow-y-auto">
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
