"use client";

export type ViewMode = "default" | "umap" | "genre";

interface ViewToggleProps {
  current: ViewMode;
  umapAvailable: boolean;
  genreAvailable: boolean;
  genreLoading: boolean;
  onChange: (mode: ViewMode) => void;
}

export default function ViewToggle({
  current,
  umapAvailable,
  genreAvailable,
  genreLoading,
  onChange,
}: ViewToggleProps) {
  return (
    <div className="flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-900/80 p-0.5 backdrop-blur-sm">
      <ToggleButton
        active={current === "default"}
        onClick={() => onChange("default")}
      >
        Year / Pop
      </ToggleButton>
      <ToggleButton
        active={current === "umap"}
        disabled={!umapAvailable}
        onClick={() => onChange("umap")}
      >
        UMAP
      </ToggleButton>
      <ToggleButton
        active={current === "genre"}
        loading={genreLoading}
        onClick={() => onChange("genre")}
      >
        Genre
      </ToggleButton>
    </div>
  );
}

function ToggleButton({
  active,
  disabled,
  loading,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  loading?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
        active
          ? "bg-green-600 text-white"
          : disabled
            ? "cursor-not-allowed text-zinc-600"
            : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
      }`}
    >
      {loading ? (
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 animate-spin rounded-full border border-zinc-500 border-t-green-400" />
          Genre
        </span>
      ) : (
        children
      )}
    </button>
  );
}
