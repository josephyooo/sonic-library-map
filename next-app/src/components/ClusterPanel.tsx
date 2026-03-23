"use client";

import { useState, useCallback } from "react";
import type { SpotifyTrack } from "@/lib/spotify";

export interface ClusterInsight {
  type: "potential_playlist" | "discordant_playlist";
  title: string;
  description: string;
  track_ids: string[];
  score: number;
}

interface ClusterPanelProps {
  insights: ClusterInsight[];
  trackLookup: Map<string, SpotifyTrack>;
  playlistNames: Map<string, string>;
  onHighlight: (trackIds: string[] | null) => void;
}

export default function ClusterPanel({
  insights,
  trackLookup,
  playlistNames,
  onHighlight,
}: ClusterPanelProps) {
  const [expanded, setExpanded] = useState<number | null>(null);

  const potentials = insights.filter((i) => i.type === "potential_playlist");
  const discordants = insights.filter((i) => i.type === "discordant_playlist");

  if (insights.length === 0) {
    return (
      <div className="p-4 text-center text-xs text-zinc-500">
        No cluster insights found. Extract more tracks for better results.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-3">
      {potentials.length > 0 && (
        <InsightSection
          title="Potential Playlists"
          subtitle="Songs that cluster together but share no playlist"
          insights={potentials}
          trackLookup={trackLookup}
          playlistNames={playlistNames}
          expanded={expanded}
          onExpand={setExpanded}
          onHighlight={onHighlight}
        />
      )}
      {discordants.length > 0 && (
        <InsightSection
          title="Discordant Playlists"
          subtitle="Playlists with scattered, dissimilar songs"
          insights={discordants}
          trackLookup={trackLookup}
          playlistNames={playlistNames}
          expanded={expanded}
          onExpand={setExpanded}
          onHighlight={onHighlight}
        />
      )}
    </div>
  );
}

function InsightSection({
  title,
  subtitle,
  insights,
  trackLookup,
  playlistNames,
  expanded,
  onExpand,
  onHighlight,
}: {
  title: string;
  subtitle: string;
  insights: ClusterInsight[];
  trackLookup: Map<string, SpotifyTrack>;
  playlistNames: Map<string, string>;
  expanded: number | null;
  onExpand: (idx: number | null) => void;
  onHighlight: (trackIds: string[] | null) => void;
}) {
  return (
    <div>
      <h3 className="text-xs font-medium text-zinc-400">{title}</h3>
      <p className="mb-2 text-xs text-zinc-600">{subtitle}</p>
      <div className="space-y-1.5">
        {insights.map((insight, idx) => {
          const resolvedTitle =
            insight.type === "discordant_playlist"
              ? playlistNames.get(insight.title) ?? insight.title
              : insight.title;

          return (
            <InsightCard
              key={idx}
              idx={idx}
              title={resolvedTitle}
              description={insight.description}
              trackIds={insight.track_ids}
              trackLookup={trackLookup}
              isExpanded={expanded === idx}
              onExpand={onExpand}
              onHighlight={onHighlight}
            />
          );
        })}
      </div>
    </div>
  );
}

function InsightCard({
  idx,
  title,
  description,
  trackIds,
  trackLookup,
  isExpanded,
  onExpand,
  onHighlight,
}: {
  idx: number;
  title: string;
  description: string;
  trackIds: string[];
  trackLookup: Map<string, SpotifyTrack>;
  isExpanded: boolean;
  onExpand: (idx: number | null) => void;
  onHighlight: (trackIds: string[] | null) => void;
}) {
  const handleClick = useCallback(() => {
    if (isExpanded) {
      onExpand(null);
      onHighlight(null);
    } else {
      onExpand(idx);
      onHighlight(trackIds);
    }
  }, [isExpanded, idx, trackIds, onExpand, onHighlight]);

  return (
    <div
      className={`cursor-pointer rounded-md border px-2.5 py-2 text-xs transition-colors ${
        isExpanded
          ? "border-green-800 bg-green-950/30"
          : "border-zinc-800 bg-zinc-900/50 hover:border-zinc-700"
      }`}
      onClick={handleClick}
    >
      <p className="font-medium text-zinc-200">{title}</p>
      <p className="mt-0.5 text-zinc-500">{description}</p>

      {isExpanded && (
        <div className="mt-2 max-h-32 space-y-1 overflow-y-auto">
          {trackIds.slice(0, 20).map((tid) => {
            const track = trackLookup.get(tid);
            if (!track) return null;
            return (
              <div key={tid} className="truncate text-zinc-400">
                {track.name}{" "}
                <span className="text-zinc-600">
                  — {track.artists.map((a) => a.name).join(", ")}
                </span>
              </div>
            );
          })}
          {trackIds.length > 20 && (
            <p className="text-zinc-600">
              +{trackIds.length - 20} more
            </p>
          )}
        </div>
      )}
    </div>
  );
}
