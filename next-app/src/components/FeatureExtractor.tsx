"use client";

import { useState, useCallback, useRef } from "react";
import type { LibraryData } from "@/lib/types";

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
  onFeaturesReady: (features: Record<string, number[]>) => void;
}

export default function FeatureExtractor({
  libraryData,
  onFeaturesReady,
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

    const tracks = libraryData.tracks.map((t) => ({
        spotify_id: t.id,
        name: t.name,
        artist: t.artists[0]?.name ?? "Unknown",
        duration_ms: t.duration_ms,
      }));

    try {
      const response = await fetch("/api/features", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tracks }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }
      if (!response.body) {
        throw new Error("No response body");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const accumulated: Record<string, number[]> = {};
      let lastUpdateCount = 0;

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
            setProgress({
              message: data.message,
              current: data.current,
              total: data.total,
              extracted: data.extracted,
              failed: data.failed,
            });

            // Accumulate features from progress events
            if (data.feature) {
              Object.assign(accumulated, data.feature);
            }

            // Trigger UMAP update every N extracted tracks
            const count = Object.keys(accumulated).length;
            if (
              count >= 5 &&
              count - lastUpdateCount >= UMAP_UPDATE_INTERVAL
            ) {
              lastUpdateCount = count;
              onFeaturesReady({ ...accumulated });
            }
          } else if (data.type === "complete") {
            setResult({
              extracted: data.extracted,
              failed: data.failed,
              total: data.total,
            });
            // Final update with all features
            if (data.features) {
              Object.assign(accumulated, data.features);
            }
            if (Object.keys(accumulated).length > 0) {
              onFeaturesReady({ ...accumulated });
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
  }, [libraryData, onFeaturesReady]);

  const percentage = progress
    ? Math.round((progress.current / progress.total) * 100)
    : 0;

  return (
    <div className="min-w-0 rounded-lg border border-zinc-800 bg-zinc-900/80 p-3 backdrop-blur-sm">
      <h3 className="mb-2 text-xs font-medium text-zinc-400">
        Audio Features
      </h3>

      {result ? (
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
      ) : running ? (
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
      ) : error ? (
        <div className="space-y-2">
          <p className="text-xs text-red-400">{error}</p>
          <button
            onClick={startExtraction}
            className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-700"
          >
            Retry
          </button>
        </div>
      ) : (
        <button
          onClick={startExtraction}
          className="rounded bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-500"
        >
          Extract from YouTube Music
        </button>
      )}
    </div>
  );
}
