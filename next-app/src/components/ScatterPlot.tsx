"use client";

import { useRef, useEffect, useCallback, useState } from "react";
import * as d3 from "d3";
import type { PlotPoint } from "@/lib/types";

const POINT_RADIUS = 3;
const HOVER_RADIUS = 6;
const UNSAVED_COLOR = "#71717a"; // zinc-500

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
  onHover: (info: HoveredPoint | null) => void;
  onClick: (point: PlotPoint) => void;
  xLabel: string;
  yLabel: string;
}

export type { HoveredPoint };

export default function ScatterPlot({
  points,
  playlistColors,
  onHover,
  onClick,
  xLabel,
  yLabel,
}: ScatterPlotProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const transformRef = useRef(d3.zoomIdentity);
  const hoveredRef = useRef<PlotPoint | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  // Build color lookup from playlist visibility
  const colorMapRef = useRef<Map<string, { color: string; visible: boolean }>>(
    new Map(),
  );
  useEffect(() => {
    const m = new Map<string, { color: string; visible: boolean }>();
    for (const pc of playlistColors) {
      m.set(pc.id, { color: pc.color, visible: pc.visible });
    }
    colorMapRef.current = m;
  }, [playlistColors]);

  // Scales — map data coords to pixel coords
  const xScale = useCallback(() => {
    const margin = 60;
    const xExtent = d3.extent(points, (p) => p.x) as [number, number];
    return d3
      .scaleLinear()
      .domain(xExtent)
      .range([margin, size.width - 20]);
  }, [points, size.width]);

  const yScale = useCallback(() => {
    const margin = 40;
    const yExtent = d3.extent(points, (p) => p.y) as [number, number];
    return d3
      .scaleLinear()
      .domain(yExtent)
      .range([size.height - margin, 20]);
  }, [points, size.height]);

  // Resolve a point's display color based on its playlist membership
  const getPointColor = useCallback(
    (point: PlotPoint): string | null => {
      const cm = colorMapRef.current;
      // Find first visible playlist this track belongs to
      for (const pid of point.playlistIds) {
        const entry = cm.get(pid);
        if (entry?.visible) return entry.color;
      }
      // If track is in playlists but none visible, hide it
      if (point.playlistIds.length > 0) {
        // Check if ANY playlist filter is active
        const anyVisible = [...cm.values()].some((e) => e.visible);
        if (anyVisible) return null; // hidden
      }
      return UNSAVED_COLOR;
    },
    [],
  );

  // Draw everything on canvas
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
    const xs = xScale();
    const ys = yScale();

    // Clear
    ctx.fillStyle = "#09090b"; // zinc-950
    ctx.fillRect(0, 0, size.width, size.height);

    // Draw axes
    drawAxes(ctx, xs, ys, transform, size, xLabel, yLabel);

    // Draw points
    const hovered = hoveredRef.current;
    for (const point of points) {
      const color = getPointColor(point);
      if (!color) continue;

      const px = transform.applyX(xs(point.x));
      const py = transform.applyY(ys(point.y));

      // Skip points outside viewport
      if (px < -10 || px > size.width + 10 || py < -10 || py > size.height + 10)
        continue;

      const isHovered = hovered?.id === point.id;
      const r = isHovered ? HOVER_RADIUS : POINT_RADIUS;

      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.globalAlpha = isHovered ? 1 : 0.7;
      ctx.fill();

      if (isHovered) {
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }, [points, size, xScale, yScale, getPointColor, xLabel, yLabel]);

  // Resize observer
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

  // Redraw when anything changes
  useEffect(() => {
    draw();
  }, [draw]);

  // D3 zoom
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

  // Quadtree for hit testing
  const quadtreeRef = useRef<d3.Quadtree<PlotPoint> | null>(null);
  useEffect(() => {
    const xs = xScale();
    const ys = yScale();
    quadtreeRef.current = d3
      .quadtree<PlotPoint>()
      .x((p) => xs(p.x))
      .y((p) => ys(p.y))
      .addAll(points);
  }, [points, xScale, yScale]);

  // Mouse move — hit test
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      const qt = quadtreeRef.current;
      if (!canvas || !qt) return;

      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      const transform = transformRef.current;
      // Invert the transform to get data-space coordinates
      const dataX = transform.invertX(mx);
      const dataY = transform.invertY(my);

      const nearest = qt.find(dataX, dataY, 20 / transform.k);

      if (nearest && nearest !== hoveredRef.current) {
        hoveredRef.current = nearest;
        const xs = xScale();
        const ys = yScale();
        onHover({
          point: nearest,
          screenX: e.clientX,
          screenY: e.clientY,
        });
        draw();
      } else if (!nearest && hoveredRef.current) {
        hoveredRef.current = null;
        onHover(null);
        draw();
      }
    },
    [draw, onHover, xScale, yScale],
  );

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      const qt = quadtreeRef.current;
      if (!canvas || !qt) return;

      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      const transform = transformRef.current;
      const dataX = transform.invertX(mx);
      const dataY = transform.invertY(my);

      const nearest = qt.find(dataX, dataY, 15 / transform.k);
      if (nearest) {
        onClick(nearest);
      }
    },
    [onClick],
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
) {
  const xTicks = xs.ticks(8);
  const yTicks = ys.ticks(6);

  ctx.strokeStyle = "#27272a"; // zinc-800
  ctx.lineWidth = 1;
  ctx.fillStyle = "#71717a"; // zinc-500
  ctx.font = "11px ui-monospace, monospace";
  ctx.textAlign = "center";

  // X-axis grid + labels
  for (const tick of xTicks) {
    const px = transform.applyX(xs(tick));
    if (px < 40 || px > size.width - 10) continue;

    ctx.beginPath();
    ctx.moveTo(px, 20);
    ctx.lineTo(px, size.height - 40);
    ctx.stroke();

    ctx.fillText(
      xLabel === "Release Year" ? String(Math.round(tick)) : tick.toFixed(1),
      px,
      size.height - 25,
    );
  }

  // Y-axis grid + labels
  ctx.textAlign = "right";
  for (const tick of yTicks) {
    const py = transform.applyY(ys(tick));
    if (py < 10 || py > size.height - 40) continue;

    ctx.beginPath();
    ctx.moveTo(50, py);
    ctx.lineTo(size.width - 10, py);
    ctx.stroke();

    ctx.fillText(String(Math.round(tick)), 45, py + 4);
  }

  // Axis labels
  ctx.fillStyle = "#a1a1aa"; // zinc-400
  ctx.font = "12px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(xLabel, size.width / 2, size.height - 6);

  ctx.save();
  ctx.translate(14, size.height / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(yLabel, 0, 0);
  ctx.restore();
}
