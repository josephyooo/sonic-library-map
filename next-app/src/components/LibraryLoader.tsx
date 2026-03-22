"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { LibraryData } from "@/lib/types";

interface Progress {
  message: string;
  current: number;
  total: number;
}

interface LibraryLoaderProps {
  onLoaded: (data: LibraryData) => void;
}

export default function LibraryLoader({ onLoaded }: LibraryLoaderProps) {
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const fetchLibrary = useCallback(async () => {
    setStarted(true);
    setError(null);

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch("/api/library", {
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

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE messages from buffer
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || ""; // Keep incomplete chunk in buffer

        for (const line of lines) {
          const dataLine = line.trim();
          if (!dataLine.startsWith("data: ")) continue;

          const jsonStr = dataLine.slice(6); // Remove "data: " prefix
          const data = JSON.parse(jsonStr);

          if (data.type === "progress") {
            setProgress({
              message: data.message,
              current: data.current,
              total: data.total,
            });
          } else if (data.type === "complete") {
            onLoaded(data.data);
            return;
          } else if (data.type === "error") {
            throw new Error(data.message);
          }
        }
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(message);
      setStarted(false);
    }
  }, [onLoaded]);

  useEffect(() => {
    fetchLibrary();
    return () => abortRef.current?.abort();
  }, [fetchLibrary]);

  const percentage = progress
    ? Math.round((progress.current / progress.total) * 100)
    : 0;

  return (
    <div className="flex flex-col items-center gap-6">
      {error ? (
        <>
          <div className="rounded-lg border border-red-800 bg-red-950/50 px-6 py-4 text-red-300">
            {error}
          </div>
          <button
            onClick={fetchLibrary}
            className="rounded-full bg-green-600 px-6 py-2 font-medium text-white transition-colors hover:bg-green-500"
          >
            Retry
          </button>
        </>
      ) : started ? (
        <>
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-600 border-t-green-500" />
          <div className="w-80 text-center">
            {progress ? (
              <>
                <p className="mb-2 text-sm text-zinc-400">
                  {progress.message}
                </p>
                <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
                  <div
                    className="h-full rounded-full bg-green-500 transition-all duration-300"
                    style={{ width: `${percentage}%` }}
                  />
                </div>
                <p className="mt-1 text-xs text-zinc-500">
                  {progress.current.toLocaleString()} /{" "}
                  {progress.total.toLocaleString()}
                </p>
              </>
            ) : (
              <p className="text-sm text-zinc-400">
                Connecting to Spotify...
              </p>
            )}
          </div>
        </>
      ) : (
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-600 border-t-green-500" />
      )}
    </div>
  );
}
