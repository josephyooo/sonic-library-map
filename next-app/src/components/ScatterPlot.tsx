"use client";

import { useRef, useEffect, useCallback, useMemo, useState } from "react";
import * as d3 from "d3";
import type { PlotPoint } from "@/lib/types";

const POINT_RADIUS = 3;
const HOVER_RADIUS = 6;
const UNSAVED_COLOR_FALLBACK = "#71717a";

export interface PlaylistColor {
  id: string;
  name: string;
  color: string;
  visible: boolean;
}

interface HoveredPoint {
  point: PlotPoint;
  screenX: number;
  screenY: number;
}

interface ScatterPlotProps {
  points: PlotPoint[];
  playlistColors: PlaylistColor[];
  highlightedTracks?: Set<string> | null;
  featureColorMap?: Map<string, string> | null;
  featureValueMap?: Map<string, number> | null;
  onHover: (info: HoveredPoint | null) => void;
  onClick: (point: PlotPoint) => void;
  xLabel: string;
  yLabel: string;
  xFormat?: (tick: number) => string;
  yFormat?: (tick: number) => string;
}

export type { HoveredPoint };

export default function ScatterPlot({
  points,
  playlistColors,
  onHover,
  onClick,
  xLabel,
  yLabel,
  xFormat,
  yFormat,
  highlightedTracks,
  featureColorMap,
  featureValueMap,
}: ScatterPlotProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const transformRef = useRef(d3.zoomIdentity);
  const hoveredRef = useRef<PlotPoint | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  // Precompute color lookup and visibility flag
  const { colorMap, anyPlaylistVisible } = useMemo(() => {
    const m = new Map<string, { color: string; visible: boolean }>();
    let anyVisible = false;
    for (const pc of playlistColors) {
      m.set(pc.id, { color: pc.color, visible: pc.visible });
      if (pc.visible) anyVisible = true;
    }
    return { colorMap: m, anyPlaylistVisible: anyVisible };
  }, [playlistColors]);

  // Memoized scales (avoids O(n) d3.extent on every call)
  const xs = useMemo(() => {
    const xExtent = d3.extent(points, (p) => p.x) as [number, number];
    return d3.scaleLinear().domain(xExtent).range([60, size.width - 20]);
  }, [points, size.width]);

  const ys = useMemo(() => {
    const yExtent = d3.extent(points, (p) => p.y) as [number, number];
    return d3.scaleLinear().domain(yExtent).range([size.height - 40, 20]);
  }, [points, size.height]);

  const getPointColor = useCallback(
    (point: PlotPoint): string => {
      for (const pid of point.playlistIds) {
        const entry = colorMap.get(pid);
        if (entry?.visible) return entry.color;
      }
      return UNSAVED_COLOR_FALLBACK;
    },
    [colorMap],
  );

  // Group points by playlist for hull drawing
  const playlistPointMap = useMemo(() => {
    const map = new Map<string, PlotPoint[]>();
    for (const point of points) {
      for (const pid of point.playlistIds) {
        const arr = map.get(pid);
        if (arr) arr.push(point);
        else map.set(pid, [point]);
      }
    }
    return map;
  }, [points]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.width === 0) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = size.width * dpr;
    canvas.height = size.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const transform = transformRef.current;

    // Read theme colors from CSS variables
    const style = getComputedStyle(document.documentElement);
    const themeColors = {
      base: style.getPropertyValue("--ctp-base").trim(),
      surface0: style.getPropertyValue("--ctp-surface0").trim(),
      overlay0: style.getPropertyValue("--ctp-overlay0").trim(),
      subtext0: style.getPropertyValue("--ctp-subtext0").trim(),
      text: style.getPropertyValue("--ctp-text").trim(),
    };

    ctx.fillStyle = themeColors.base;
    ctx.fillRect(0, 0, size.width, size.height);

    drawAxes(ctx, xs, ys, transform, size, xLabel, yLabel, xFormat, yFormat, themeColors);

    // Draw feature heatmap gradient when a feature overlay is active
    if (featureValueMap && featureValueMap.size > 0) {
      const CELL = 12; // grid cell size in pixels
      const RADIUS = 60; // influence radius in pixels
      const cols = Math.ceil(size.width / CELL);
      const rows = Math.ceil(size.height / CELL);

      // Collect screen-space positions with values
      const screenPoints: { sx: number; sy: number; val: number }[] = [];
      for (const point of points) {
        const val = featureValueMap.get(point.id);
        if (val === undefined) continue;
        screenPoints.push({
          sx: transform.applyX(xs(point.x)),
          sy: transform.applyY(ys(point.y)),
          val,
        });
      }

      if (screenPoints.length > 0) {
        for (let row = 0; row < rows; row++) {
          for (let col = 0; col < cols; col++) {
            const cx = col * CELL + CELL / 2;
            const cy = row * CELL + CELL / 2;

            let weightSum = 0;
            let valSum = 0;
            for (const sp of screenPoints) {
              const dx = cx - sp.sx;
              const dy = cy - sp.sy;
              const dist2 = dx * dx + dy * dy;
              if (dist2 > RADIUS * RADIUS) continue;
              const w = 1 - Math.sqrt(dist2) / RADIUS;
              weightSum += w;
              valSum += w * sp.val;
            }

            if (weightSum > 0) {
              const t = valSum / weightSum;
              ctx.fillStyle = d3.interpolateViridis(t);
              ctx.globalAlpha = Math.min(weightSum * 0.15, 0.35);
              ctx.fillRect(col * CELL, row * CELL, CELL, CELL);
            }
          }
        }
        ctx.globalAlpha = 1;
      }
    }

    // Draw playlist boundaries (convex hulls) behind points
    for (const pc of playlistColors) {
      if (!pc.visible) continue;
      const pPoints = playlistPointMap.get(pc.id);
      if (!pPoints || pPoints.length === 0) continue;

      const screenCoords: [number, number][] = pPoints.map((p) => [
        transform.applyX(xs(p.x)),
        transform.applyY(ys(p.y)),
      ]);

      ctx.globalAlpha = 0.08;
      ctx.fillStyle = pc.color;
      ctx.strokeStyle = pc.color;
      ctx.lineWidth = 1.5;

      if (screenCoords.length === 1) {
        // Single point — draw a circle
        ctx.beginPath();
        ctx.arc(screenCoords[0][0], screenCoords[0][1], 20, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 0.3;
        ctx.stroke();
      } else if (screenCoords.length === 2) {
        // Two points — draw an ellipse between them
        const [a, b] = screenCoords;
        const cx = (a[0] + b[0]) / 2;
        const cy = (a[1] + b[1]) / 2;
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const dist = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx);

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(angle);
        ctx.beginPath();
        ctx.ellipse(0, 0, dist / 2 + 15, 15, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 0.3;
        ctx.stroke();
        ctx.restore();
      } else {
        // 3+ points — convex hull
        const hull = d3.polygonHull(screenCoords);
        if (hull) {
          ctx.beginPath();
          ctx.moveTo(hull[0][0], hull[0][1]);
          for (let i = 1; i < hull.length; i++) {
            ctx.lineTo(hull[i][0], hull[i][1]);
          }
          ctx.closePath();
          ctx.fill();
          ctx.globalAlpha = 0.3;
          ctx.stroke();

          // Playlist label at centroid
          const centroid = d3.polygonCentroid(hull);
          ctx.globalAlpha = 0.5;
          ctx.fillStyle = pc.color;
          ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(pc.name, centroid[0], centroid[1]);
        }
      }
    }
    ctx.globalAlpha = 1;

    // Draw points
    const hovered = hoveredRef.current;
    for (const point of points) {
      const color = featureColorMap?.get(point.id) ?? getPointColor(point);

      const px = transform.applyX(xs(point.x));
      const py = transform.applyY(ys(point.y));

      if (px < -10 || px > size.width + 10 || py < -10 || py > size.height + 10)
        continue;

      const isHovered = hovered?.id === point.id;
      const isHighlighted = !highlightedTracks || highlightedTracks.has(point.id);
      const r = isHovered ? HOVER_RADIUS : isHighlighted && highlightedTracks ? POINT_RADIUS + 1.5 : POINT_RADIUS;

      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.globalAlpha = isHovered ? 1 : isHighlighted ? (highlightedTracks ? 1 : 0.7) : 0.15;
      ctx.fill();

      if (isHovered) {
        ctx.beginPath();
        ctx.arc(px, py, r + 3, 0, Math.PI * 2);
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 2;
        ctx.globalAlpha = 1;
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }, [points, size, xs, ys, getPointColor, playlistColors, playlistPointMap, highlightedTracks, featureColorMap, featureValueMap, xLabel, yLabel, xFormat, yFormat]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setSize({ width: Math.floor(width), height: Math.floor(height) });
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    draw();
  }, [draw]);

  // Redraw on window resize (used by theme toggle to refresh canvas colors)
  useEffect(() => {
    const handleResize = () => draw();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [draw]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.width === 0) return;

    const zoom = d3
      .zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.5, 20])
      .on("zoom", (event: d3.D3ZoomEvent<HTMLCanvasElement, unknown>) => {
        transformRef.current = event.transform;
        draw();
      });

    d3.select(canvas).call(zoom);

    return () => {
      d3.select(canvas).on(".zoom", null);
    };
  }, [size, draw]);

  const quadtreeRef = useRef<d3.Quadtree<PlotPoint> | null>(null);
  useEffect(() => {
    quadtreeRef.current = d3
      .quadtree<PlotPoint>()
      .x((p) => xs(p.x))
      .y((p) => ys(p.y))
      .addAll(points);
  }, [points, xs, ys]);

  // Hit-test helper: convert screen coords to scale-space and find nearest point
  const findPointAt = useCallback(
    (clientX: number, clientY: number, radius: number): PlotPoint | undefined => {
      const canvas = canvasRef.current;
      const qt = quadtreeRef.current;
      if (!canvas || !qt) return undefined;

      const rect = canvas.getBoundingClientRect();
      const transform = transformRef.current;
      const dataX = transform.invertX(clientX - rect.left);
      const dataY = transform.invertY(clientY - rect.top);

      return qt.find(dataX, dataY, radius / transform.k) ?? undefined;
    },
    [],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const nearest = findPointAt(e.clientX, e.clientY, 20);

      if (nearest && nearest !== hoveredRef.current) {
        hoveredRef.current = nearest;
        onHover({ point: nearest, screenX: e.clientX, screenY: e.clientY });
        draw();
      } else if (!nearest && hoveredRef.current) {
        hoveredRef.current = null;
        onHover(null);
        draw();
      }
    },
    [draw, onHover, findPointAt],
  );

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const nearest = findPointAt(e.clientX, e.clientY, 15);
      if (nearest) onClick(nearest);
    },
    [onClick, findPointAt],
  );

  const handleMouseLeave = useCallback(() => {
    if (hoveredRef.current) {
      hoveredRef.current = null;
      onHover(null);
      draw();
    }
  }, [draw, onHover]);

  return (
    <div ref={containerRef} className="relative h-full w-full">
      <canvas
        ref={canvasRef}
        className="h-full w-full cursor-crosshair"
        style={{ width: size.width, height: size.height }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
      />
    </div>
  );
}

function drawAxes(
  ctx: CanvasRenderingContext2D,
  xs: d3.ScaleLinear<number, number>,
  ys: d3.ScaleLinear<number, number>,
  transform: d3.ZoomTransform,
  size: { width: number; height: number },
  xLabel: string,
  yLabel: string,
  xFormat?: (tick: number) => string,
  yFormat?: (tick: number) => string,
  theme?: { base: string; surface0: string; overlay0: string; subtext0: string; text: string },
) {
  const gridColor = theme?.surface0 ?? "#27272a";
  const tickColor = theme?.overlay0 ?? "#71717a";
  const labelColor = theme?.subtext0 ?? "#a1a1aa";

  const xTicks = xs.ticks(8);
  const yTicks = ys.ticks(6);
  const formatX = xFormat ?? ((t: number) => t.toFixed(1));
  const formatY = yFormat ?? ((t: number) => String(Math.round(t)));

  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 1;
  ctx.fillStyle = tickColor;
  ctx.font = "11px ui-monospace, monospace";
  ctx.textAlign = "center";

  for (const tick of xTicks) {
    const px = transform.applyX(xs(tick));
    if (px < 40 || px > size.width - 10) continue;

    ctx.beginPath();
    ctx.moveTo(px, 20);
    ctx.lineTo(px, size.height - 40);
    ctx.stroke();
    ctx.fillText(formatX(tick), px, size.height - 25);
  }

  ctx.textAlign = "right";
  for (const tick of yTicks) {
    const py = transform.applyY(ys(tick));
    if (py < 10 || py > size.height - 40) continue;

    ctx.beginPath();
    ctx.moveTo(50, py);
    ctx.lineTo(size.width - 10, py);
    ctx.stroke();
    ctx.fillText(formatY(tick), 45, py + 4);
  }

  ctx.fillStyle = labelColor;
  ctx.font = "12px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(xLabel, size.width / 2, size.height - 6);

  ctx.save();
  ctx.translate(14, size.height / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(yLabel, 0, 0);
  ctx.restore();
}
