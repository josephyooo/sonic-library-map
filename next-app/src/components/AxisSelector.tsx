"use client";

import { OVERLAY_FEATURES } from "./FeatureOverlay";

/** Features available as custom axes — same list as Color By, plus Year and Popularity. */
const AXIS_OPTIONS = [
  { idx: -1, name: "Release Year" },
  { idx: -2, name: "Popularity" },
  ...OVERLAY_FEATURES.map((f) => ({ idx: f.idx, name: f.name })),
];

interface AxisSelectorProps {
  xIdx: number;
  yIdx: number;
  onChangeX: (idx: number) => void;
  onChangeY: (idx: number) => void;
}

export default function AxisSelector({
  xIdx,
  yIdx,
  onChangeX,
  onChangeY,
}: AxisSelectorProps) {
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-900/80 p-2 backdrop-blur-sm">
      <p className="mb-1.5 text-xs font-medium text-zinc-400">Axes</p>
      <div className="flex flex-col gap-1.5">
        <label className="flex items-center gap-2 text-xs text-zinc-400">
          <span className="w-3">X</span>
          <select
            value={xIdx}
            onChange={(e) => onChangeX(Number(e.target.value))}
            className="flex-1 rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none focus:ring-1 focus:ring-green-600"
          >
            {AXIS_OPTIONS.map((f) => (
              <option key={f.idx} value={f.idx}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs text-zinc-400">
          <span className="w-3">Y</span>
          <select
            value={yIdx}
            onChange={(e) => onChangeY(Number(e.target.value))}
            className="flex-1 rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none focus:ring-1 focus:ring-green-600"
          >
            {AXIS_OPTIONS.map((f) => (
              <option key={f.idx} value={f.idx}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}

/** Sentinel indices for non-feature axes. */
export const AXIS_YEAR = -1;
export const AXIS_POPULARITY = -2;
