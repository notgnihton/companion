import { useCallback, useEffect, useRef } from "react";
import type { NutritionDayHistoryEntry } from "../types";

interface NutritionTrackingChartProps {
  entries: NutritionDayHistoryEntry[];
  metric: "calories" | "proteinGrams" | "carbsGrams" | "fatGrams" | "weight";
  label: string;
  color: string;
  targetColor?: string;
  unit?: string;
}

const CHART_PADDING = { top: 24, right: 12, bottom: 40, left: 48 };

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

export function NutritionTrackingChart({
  entries,
  metric,
  label,
  color,
  targetColor = "rgba(255,255,255,0.25)",
  unit = "",
}: NutritionTrackingChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || entries.length === 0) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;
    const plotW = w - CHART_PADDING.left - CHART_PADDING.right;
    const plotH = h - CHART_PADDING.top - CHART_PADDING.bottom;

    // Extract values
    const isWeight = metric === "weight";
    const actuals = entries.map((e) =>
      isWeight ? e.weightKg : e.totals[metric as keyof typeof e.totals]
    );
    const targets = isWeight
      ? []
      : entries.map((e) =>
          e.targets ? (e.targets as Record<string, number>)[metric] ?? null : null
        );

    const allValues = [
      ...actuals.filter((v): v is number => v !== null && v !== undefined),
      ...targets.filter((v): v is number => v !== null),
    ];
    if (allValues.length === 0) return;

    const minVal = Math.min(...allValues) * 0.9;
    const maxVal = Math.max(...allValues) * 1.1;
    const range = maxVal - minVal || 1;

    const xStep = entries.length > 1 ? plotW / (entries.length - 1) : plotW;

    // Clear
    ctx.clearRect(0, 0, w, h);

    // Draw grid lines
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 1;
    const gridLines = 4;
    for (let i = 0; i <= gridLines; i++) {
      const y = CHART_PADDING.top + (plotH / gridLines) * i;
      ctx.beginPath();
      ctx.moveTo(CHART_PADDING.left, y);
      ctx.lineTo(w - CHART_PADDING.right, y);
      ctx.stroke();

      // Y-axis labels
      const val = maxVal - (range / gridLines) * i;
      ctx.fillStyle = "rgba(255,255,255,0.4)";
      ctx.font = "10px system-ui, sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(
        isWeight ? val.toFixed(1) : Math.round(val).toString(),
        CHART_PADDING.left - 6,
        y + 3
      );
    }

    // Target line/area (dashed)
    if (!isWeight && targets.some((t) => t !== null)) {
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = targetColor;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < entries.length; i++) {
        const t = targets[i];
        if (t === null) continue;
        const x = CHART_PADDING.left + (entries.length > 1 ? i * xStep : plotW / 2);
        const y = CHART_PADDING.top + plotH - ((t - minVal) / range) * plotH;
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Actual line
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    let lineStarted = false;
    const pointPositions: { x: number; y: number; val: number }[] = [];

    for (let i = 0; i < entries.length; i++) {
      const v = actuals[i];
      if (v === null || v === undefined) continue;
      const x = CHART_PADDING.left + (entries.length > 1 ? i * xStep : plotW / 2);
      const y = CHART_PADDING.top + plotH - ((v - minVal) / range) * plotH;
      pointPositions.push({ x, y, val: v });
      if (!lineStarted) {
        ctx.moveTo(x, y);
        lineStarted = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();

    // Gradient fill under line
    if (pointPositions.length > 1) {
      const gradient = ctx.createLinearGradient(0, CHART_PADDING.top, 0, h - CHART_PADDING.bottom);
      gradient.addColorStop(0, color.replace(")", ",0.25)").replace("rgb(", "rgba("));
      gradient.addColorStop(1, color.replace(")", ",0.02)").replace("rgb(", "rgba("));

      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.moveTo(pointPositions[0]!.x, CHART_PADDING.top + plotH);
      for (const p of pointPositions) {
        ctx.lineTo(p.x, p.y);
      }
      ctx.lineTo(pointPositions[pointPositions.length - 1]!.x, CHART_PADDING.top + plotH);
      ctx.closePath();
      ctx.fill();
    }

    // Draw dots
    for (const p of pointPositions) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    }

    // X-axis labels
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.font = "10px system-ui, sans-serif";
    ctx.textAlign = "center";
    const maxLabels = Math.min(entries.length, 10);
    const step = Math.max(1, Math.floor(entries.length / maxLabels));
    for (let i = 0; i < entries.length; i += step) {
      const x = CHART_PADDING.left + (entries.length > 1 ? i * xStep : plotW / 2);
      ctx.fillText(formatDateLabel(entries[i]!.date), x, h - CHART_PADDING.bottom + 16);
    }
    // Always include last label if not already
    if ((entries.length - 1) % step !== 0) {
      const x = CHART_PADDING.left + (entries.length - 1) * xStep;
      ctx.fillText(formatDateLabel(entries[entries.length - 1]!.date), x, h - CHART_PADDING.bottom + 16);
    }

    // Title
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.font = "bold 11px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(`${label}${unit ? ` (${unit})` : ""}`, CHART_PADDING.left, 14);

    // Latest value
    if (pointPositions.length > 0) {
      const latest = pointPositions[pointPositions.length - 1]!;
      ctx.fillStyle = color;
      ctx.font = "bold 12px system-ui, sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(
        isWeight ? latest.val.toFixed(1) : Math.round(latest.val).toString(),
        w - CHART_PADDING.right,
        14
      );
    }
  }, [entries, metric, label, color, targetColor, unit]);

  useEffect(() => {
    draw();
    const handleResize = () => draw();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [draw]);

  return (
    <canvas
      ref={canvasRef}
      className="nutrition-tracking-canvas"
      style={{ width: "100%", height: 180 }}
    />
  );
}
