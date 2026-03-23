"use client";

const OVERLAY_FEATURES = [
  { idx: 26, name: "Brightness" },
  { idx: 27, name: "BPM" },
  { idx: 28, name: "Beat Strength" },
  { idx: 32, name: "Loudness" },
  { idx: 34, name: "Dynamic Range" },
  { idx: 35, name: "Danceability" },
  { idx: 36, name: "Energy" },
  { idx: 38, name: "Noisiness" },
  { idx: 39, name: "High-Freq Energy" },
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
