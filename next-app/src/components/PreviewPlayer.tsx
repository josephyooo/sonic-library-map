"use client";

import { useEffect, useRef } from "react";

type YTPlayer = {
  loadVideoById: (opts: { videoId: string; startSeconds?: number }) => void;
  stopVideo: () => void;
  setVolume: (v: number) => void;
  destroy?: () => void;
};

declare global {
  interface Window {
    YT?: {
      Player: new (
        el: HTMLElement | string,
        opts: {
          height: string | number;
          width: string | number;
          playerVars?: Record<string, unknown>;
          events?: {
            onReady?: (e: { target: YTPlayer }) => void;
            onStateChange?: (e: { data: number; target: YTPlayer }) => void;
          };
        },
      ) => YTPlayer;
      PlayerState?: { PLAYING: number; BUFFERING: number; ENDED: number; PAUSED: number; CUED: number };
      loaded?: number;
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<void> | null = null;

function loadYTApi(): Promise<void> {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve) => {
    if (window.YT?.Player) {
      resolve();
      return;
    }
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve();
    };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    s.async = true;
    document.head.appendChild(s);
  });
  return apiPromise;
}

interface PreviewPlayerProps {
  videoId: string | null;
  startSeconds?: number;
  enabled: boolean;
  onStateChange?: (state: "playing" | "buffering" | "stopped") => void;
}

export default function PreviewPlayer({ videoId, startSeconds = 30, enabled, onStateChange }: PreviewPlayerProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const readyRef = useRef(false);
  const onStateChangeRef = useRef(onStateChange);
  onStateChangeRef.current = onStateChange;

  useEffect(() => {
    if (!hostRef.current) return;
    let cancelled = false;
    loadYTApi().then(() => {
      if (cancelled || !hostRef.current || !window.YT) return;
      playerRef.current = new window.YT.Player(hostRef.current, {
        height: "100",
        width: "150",
        playerVars: {
          controls: 0,
          disablekb: 1,
          modestbranding: 1,
          playsinline: 1,
          rel: 0,
        },
        events: {
          onReady: () => {
            readyRef.current = true;
            playerRef.current?.setVolume(60);
          },
          onStateChange: (e) => {
            const s = window.YT?.PlayerState;
            if (!s) return;
            if (e.data === s.PLAYING) onStateChangeRef.current?.("playing");
            else if (e.data === s.BUFFERING) onStateChangeRef.current?.("buffering");
            else if (e.data === s.ENDED || e.data === s.PAUSED) onStateChangeRef.current?.("stopped");
          },
        },
      });
    });
    return () => {
      cancelled = true;
      playerRef.current?.destroy?.();
      playerRef.current = null;
      readyRef.current = false;
    };
  }, []);

  useEffect(() => {
    const p = playerRef.current;
    if (!readyRef.current || !p) return;
    if (enabled && videoId) {
      p.loadVideoById({ videoId, startSeconds });
    } else {
      p.stopVideo();
      onStateChangeRef.current?.("stopped");
    }
  }, [videoId, startSeconds, enabled]);

  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        width: 1,
        height: 1,
        overflow: "hidden",
        opacity: 0,
        pointerEvents: "none",
        left: -9999,
        top: -9999,
      }}
    >
      <div ref={hostRef} />
    </div>
  );
}
