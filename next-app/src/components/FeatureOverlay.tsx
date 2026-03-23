"use client";

function fmtHz(v: number): string {
  return v >= 1000 ? `${(v / 1000).toFixed(1)} kHz` : `${Math.round(v)} Hz`;
}

export interface OverlayFeature {
  idx: number;
  name: string;
  format: (raw: number) => string;
}

export const OVERLAY_FEATURES: OverlayFeature[] = [
  { idx: 26, name: "Brightness", format: (v) => fmtHz(v) },
  { idx: 27, name: "BPM", format: (v) => `${Math.round(v * 250)} BPM` },
  { idx: 28, name: "Beat Strength", format: (v) => `${(v / 5 * 100).toFixed(0)}%` },
  { idx: 32, name: "Loudness", format: (v) => `${v.toFixed(1)} LUFS` },
  { idx: 34, name: "Dynamic Range", format: (v) => `${v.toFixed(1)}` },
  { idx: 35, name: "Danceability", format: (v) => `${(v / 3 * 100).toFixed(0)}%` },
  { idx: 36, name: "Energy", format: (v) => `${(v / 14 * 100).toFixed(0)}%` },
  { idx: 38, name: "Noisiness", format: (v) => `${(v / 0.3 * 100).toFixed(0)}%` },
  { idx: 39, name: "High-Freq Energy", format: (v) => fmtHz(v) },
];

interface FeatureOverlayProps {
  selected: number | null;
  onChange: (idx: number | null) => void;
}

export default function FeatureOverlay({
  selected,
  onChange,
}: FeatureOverlayProps) {
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-900/80 p-2 backdrop-blur-sm">
      <p className="mb-1.5 text-xs font-medium text-zinc-400">Color by</p>
      <div className="flex flex-wrap gap-1">
        <button
          onClick={() => onChange(null)}
          className={`rounded px-2 py-0.5 text-xs transition-colors ${
            selected === null
              ? "bg-green-600 text-white"
              : "text-zinc-400 hover:bg-zinc-800"
          }`}
        >
          Playlist
        </button>
        {OVERLAY_FEATURES.map((f) => (
          <button
            key={f.idx}
            onClick={() => onChange(f.idx)}
            className={`rounded px-2 py-0.5 text-xs transition-colors ${
              selected === f.idx
                ? "bg-green-600 text-white"
                : "text-zinc-400 hover:bg-zinc-800"
            }`}
          >
            {f.name}
          </button>
        ))}
      </div>
    </div>
  );
}
