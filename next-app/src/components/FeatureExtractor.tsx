"use client";

import { useState, useCallback, useRef } from "react";
import type { LibraryData } from "@/lib/types";
import { handleApiError } from "@/lib/api";

const UMAP_UPDATE_INTERVAL = 10;

interface Progress {
  message: string;
  current: number;
  total: number;
  extracted: number;
  failed: number;
}

interface FeatureExtractorProps {
  libraryData: LibraryData;
  cachedCount: number;
  showButton: boolean;
  onFeaturesReady: (features: Record<string, number[]>) => void;
  onRawFeaturesReady?: (features: Record<string, number[]>) => void;
}

export default function FeatureExtractor({
  libraryData,
  cachedCount,
  showButton,
  onFeaturesReady,
  onRawFeaturesReady,
}: FeatureExtractorProps) {
  const [progress, setProgress] = useState<Progress | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{
    extracted: number;
    failed: number;
    total: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const startExtraction = useCallback(async () => {
    setRunning(true);
    setError(null);
    setResult(null);

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const allTracks = libraryData.tracks.map((t) => ({
      spotify_id: t.id,
      name: t.name,
      artist: t.artists[0]?.name ?? "Unknown",
      duration_ms: t.duration_ms,
    }));

    try {
      // Bulk-load cached features first (instant)
      const accumulated: Record<string, number[]> = {};
      const cachedResponse = await fetch("/api/features", {
        signal: controller.signal,
      });
      handleApiError(cachedResponse);
      if (cachedResponse.ok) {
        const cachedData = await cachedResponse.json();
        if (cachedData.features) {
          Object.assign(accumulated, cachedData.features);
          if (Object.keys(accumulated).length >= 5) {
            onFeaturesReady({ ...accumulated });
          }
        }
        if (cachedData.raw_features && onRawFeaturesReady) {
          onRawFeaturesReady(cachedData.raw_features);
        }
      }

      // Only send uncached tracks to the extraction endpoint
      const cachedIds = new Set(Object.keys(accumulated));
      const uncachedTracks = allTracks.filter(
        (t) => !cachedIds.has(t.spotify_id),
      );

      if (uncachedTracks.length === 0) {
        setResult({
          extracted: Object.keys(accumulated).length,
          failed: 0,
          total: allTracks.length,
        });
        setRunning(false);
        return;
      }

      const response = await fetch("/api/features", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tracks: uncachedTracks }),
        signal: controller.signal,
      });
      handleApiError(response);

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }
      if (!response.body) {
        throw new Error("No response body");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      // accumulated was pre-loaded with cached features above
      let lastUpdateCount = Object.keys(accumulated).length;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const dataLine = line.trim();
          if (!dataLine.startsWith("data: ")) continue;

          const data = JSON.parse(dataLine.slice(6));

          if (data.type === "progress") {
            const cachedCount = Object.keys(accumulated).length - (data.extracted ?? 0);
            setProgress({
              message: data.message,
              current: cachedCount + data.current,
              total: cachedCount + data.total,
              extracted: cachedCount + (data.extracted ?? 0),
              failed: data.failed,
            });

            if (data.feature) {
              Object.assign(accumulated, data.feature);
            }

            const count = Object.keys(accumulated).length;
            if (
              count >= 5 &&
              count - lastUpdateCount >= UMAP_UPDATE_INTERVAL
            ) {
              lastUpdateCount = count;
              onFeaturesReady({ ...accumulated });
            }
          } else if (data.type === "complete") {
            if (data.features) {
              Object.assign(accumulated, data.features);
            }
            setResult({
              extracted: Object.keys(accumulated).length,
              failed: data.failed,
              total: allTracks.length,
            });
            if (Object.keys(accumulated).length > 0) {
              onFeaturesReady({ ...accumulated });
            }
            // Re-fetch raw features (extracted server-side, not in SSE stream)
            if (onRawFeaturesReady) {
              try {
                const rawResp = await fetch("/api/features", { signal: controller.signal });
                if (rawResp.ok) {
                  const rawData = await rawResp.json();
                  if (rawData.raw_features) onRawFeaturesReady(rawData.raw_features);
                }
              } catch { /* ignore */ }
            }
          }
        }
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setRunning(false);
    }
  }, [libraryData, onFeaturesReady, onRawFeaturesReady]);

  const percentage = progress
    ? Math.round((progress.current / progress.total) * 100)
    : 0;

  // Progress bar is always visible when running (regardless of view mode)
  if (running) {
    return (
      <div className="min-w-0 rounded-lg border border-zinc-800 bg-zinc-900/80 p-3 backdrop-blur-sm">
        <div className="space-y-1.5">
          <p className="truncate text-xs text-zinc-400" title={progress?.message}>
            {progress?.message ?? "Starting..."}
          </p>
          <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
            <div
              className="h-full rounded-full bg-green-500 transition-all duration-300"
              style={{ width: `${percentage}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-zinc-500">
            <span>
              {progress?.current.toLocaleString() ?? 0} /{" "}
              {progress?.total.toLocaleString() ?? "?"}
            </span>
            <span>
              {progress?.extracted ?? 0} extracted, {progress?.failed ?? 0} failed
            </span>
          </div>
        </div>
      </div>
    );
  }

  // Result summary after extraction completes
  if (result) {
    return (
      <div className="min-w-0 rounded-lg border border-zinc-800 bg-zinc-900/80 p-3 backdrop-blur-sm">
        <div className="text-xs text-zinc-300">
          <span className="font-medium text-green-400">
            {result.extracted.toLocaleString()}
          </span>{" "}
          extracted
          {result.failed > 0 && (
            <>
              {" / "}
              <span className="text-red-400">
                {result.failed.toLocaleString()}
              </span>{" "}
              failed
            </>
          )}
          {" / "}
          {result.total.toLocaleString()} total
        </div>
      </div>
    );
  }

  // Button only visible when showButton is true (UMAP mode)
  if (!showButton) return null;

  if (error) {
    return (
      <div className="min-w-0 rounded-lg border border-zinc-800 bg-zinc-900/80 p-3 backdrop-blur-sm">
        <div className="space-y-2">
          <p className="text-xs text-red-400">{error}</p>
          <button
            onClick={startExtraction}
            className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-w-0 rounded-lg border border-zinc-800 bg-zinc-900/80 p-3 backdrop-blur-sm">
      <button
        onClick={startExtraction}
        className="rounded bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-500"
      >
        {cachedCount > 0 ? "Resume extraction" : "Extract from YouTube Music"}
      </button>
    </div>
  );
}
