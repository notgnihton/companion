import { useCallback, useEffect, useRef, useState } from "react";
import type { NutritionDayHistoryEntry } from "../types";

/* ── shared constants ──────────────────────────────────────────── */
const PAD = { top: 28, right: 52, bottom: 36, left: 48 };
const FONT = "10px system-ui, sans-serif";
const BOLD = "bold 11px system-ui, sans-serif";
const GRID = "rgba(255,255,255,0.06)";
const LABEL_CLR = "rgba(255,255,255,0.4)";
const GRID_LINES = 4;
const LONG_PRESS_MS = 300;

function fmtDate(d: string): string {
  const p = new Date(d + "T00:00:00Z");
  return `${p.getUTCMonth() + 1}/${p.getUTCDate()}`;
}

function toAlpha(rgb: string, a: number): string {
  return rgb.replace("rgb(", "rgba(").replace(")", `,${a})`);
}

interface Axis { min: number; max: number; range: number }

function computeAxis(vals: (number | null)[], pad = 0.08): Axis {
  const nums = vals.filter((v): v is number => v !== null);
  if (nums.length === 0) return { min: 0, max: 1, range: 1 };
  const lo = Math.min(...nums);
  const hi = Math.max(...nums);
  const span = hi - lo || 1;
  return { min: lo - span * pad, max: hi + span * pad, range: (hi + span * pad) - (lo - span * pad) };
}

function drawXLabels(
  ctx: CanvasRenderingContext2D,
  entries: NutritionDayHistoryEntry[],
  plotW: number,
  xStep: number,
  h: number,
) {
  ctx.fillStyle = LABEL_CLR;
  ctx.font = FONT;
  ctx.textAlign = "center";
  if (entries.length === 0) return;

  // Measure label width and add a gap — ensures no overlap on narrow screens
  const sampleLabel = fmtDate(entries[0]!.date);
  const labelW = ctx.measureText(sampleLabel).width + 12; // 12px min gap
  const maxLabels = Math.max(2, Math.floor(plotW / labelW));
  const step = Math.max(1, Math.ceil(entries.length / maxLabels));

  let lastDrawnX = -Infinity;
  for (let i = 0; i < entries.length; i += step) {
    const x = PAD.left + (entries.length > 1 ? i * xStep : plotW / 2);
    if (x - lastDrawnX < labelW) continue; // skip if too close
    ctx.fillText(fmtDate(entries[i]!.date), x, h - PAD.bottom + 14);
    lastDrawnX = x;
  }
  // Always draw last label if it doesn't overlap
  if (entries.length > 1) {
    const lastX = PAD.left + (entries.length - 1) * xStep;
    if (lastX - lastDrawnX >= labelW) {
      ctx.fillText(fmtDate(entries[entries.length - 1]!.date), lastX, h - PAD.bottom + 14);
    }
  }
}

function drawLine(
  ctx: CanvasRenderingContext2D,
  points: { x: number; y: number }[],
  color: string,
  width = 2,
  dashed = false,
) {
  if (points.length === 0) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  if (dashed) ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(points[0]!.x, points[0]!.y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i]!.x, points[i]!.y);
  ctx.stroke();
  if (dashed) ctx.setLineDash([]);
}

function drawDots(ctx: CanvasRenderingContext2D, points: { x: number; y: number }[], color: string, r = 2.5) {
  for (const p of points) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }
}

function drawGradientFill(
  ctx: CanvasRenderingContext2D,
  points: { x: number; y: number }[],
  color: string,
  top: number,
  bottom: number,
) {
  if (points.length < 2) return;
  const grad = ctx.createLinearGradient(0, top, 0, bottom);
  grad.addColorStop(0, toAlpha(color, 0.18));
  grad.addColorStop(1, toAlpha(color, 0.01));
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(points[0]!.x, bottom);
  for (const p of points) ctx.lineTo(p.x, p.y);
  ctx.lineTo(points[points.length - 1]!.x, bottom);
  ctx.closePath();
  ctx.fill();
}

/** Find closest entry index to an x pixel coordinate */
function findNearestIndex(x: number, entries: NutritionDayHistoryEntry[], plotW: number): number {
  if (entries.length <= 1) return 0;
  const xStep = plotW / (entries.length - 1);
  const relX = x - PAD.left;
  const idx = Math.round(relX / xStep);
  return Math.max(0, Math.min(entries.length - 1, idx));
}

/** Draw vertical crosshair + tooltip bubble at a given entry index */
function drawTooltip(
  ctx: CanvasRenderingContext2D,
  idx: number,
  entries: NutritionDayHistoryEntry[],
  lines: string[],
  w: number,
  h: number,
  plotW: number,
) {
  const xStep = entries.length > 1 ? plotW / (entries.length - 1) : plotW;
  const cx = PAD.left + (entries.length > 1 ? idx * xStep : plotW / 2);

  // Vertical crosshair
  ctx.save();
  ctx.setLineDash([3, 3]);
  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx, PAD.top);
  ctx.lineTo(cx, h - PAD.bottom);
  ctx.stroke();
  ctx.setLineDash([]);

  // Tooltip bubble
  ctx.font = FONT;
  const lineH = 14;
  const padX = 8;
  const padY = 6;
  const maxTextW = Math.max(...lines.map((l) => ctx.measureText(l).width));
  const boxW = maxTextW + padX * 2;
  const boxH = lines.length * lineH + padY * 2;

  // Position: prefer right of crosshair, flip if near edge
  let bx = cx + 8;
  if (bx + boxW > w - 4) bx = cx - boxW - 8;
  const by = PAD.top + 4;

  ctx.fillStyle = "rgba(30, 30, 40, 0.92)";
  ctx.beginPath();
  ctx.roundRect(bx, by, boxW, boxH, 6);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(bx, by, boxW, boxH, 6);
  ctx.stroke();

  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.textAlign = "left";
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i]!, bx + padX, by + padY + lineH * (i + 0.8));
  }

  // Dot on crosshair at x-axis
  ctx.beginPath();
  ctx.arc(cx, h - PAD.bottom, 3, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.fill();
  ctx.restore();
}

/** Hook: long-press state on a canvas */
function useLongPress(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  entries: NutritionDayHistoryEntry[],
  plotW: number,
): number | null {
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    function getX(e: TouchEvent) {
      const rect = canvas!.getBoundingClientRect();
      return e.touches[0]!.clientX - rect.left;
    }

    function onStart(e: TouchEvent) {
      const x = getX(e);
      timerRef.current = setTimeout(() => {
        activeRef.current = true;
        setActiveIdx(findNearestIndex(x, entries, plotW));
      }, LONG_PRESS_MS);
    }

    function onMove(e: TouchEvent) {
      if (activeRef.current) {
        e.preventDefault(); // prevent scroll while scrubbing
        const x = getX(e);
        setActiveIdx(findNearestIndex(x, entries, plotW));
      } else {
        // Moved before long press triggered — cancel
        if (timerRef.current) clearTimeout(timerRef.current);
      }
    }

    function onEnd() {
      if (timerRef.current) clearTimeout(timerRef.current);
      activeRef.current = false;
      setActiveIdx(null);
    }

    canvas.addEventListener("touchstart", onStart, { passive: true });
    canvas.addEventListener("touchmove", onMove, { passive: false });
    canvas.addEventListener("touchend", onEnd);
    canvas.addEventListener("touchcancel", onEnd);

    return () => {
      canvas.removeEventListener("touchstart", onStart);
      canvas.removeEventListener("touchmove", onMove);
      canvas.removeEventListener("touchend", onEnd);
      canvas.removeEventListener("touchcancel", onEnd);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [canvasRef, entries, plotW]);

  return activeIdx;
}

/* ── CalorieWeightChart: Calories (left axis) + Weight (right axis) ── */

interface DualAxisChartProps {
  entries: NutritionDayHistoryEntry[];
}

export function CalorieWeightChart({ entries }: DualAxisChartProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const plotWRef = useRef(0);
  const tooltipIdx = useLongPress(ref, entries, plotWRef.current);

  const draw = useCallback((highlightIdx: number | null = null) => {
    const canvas = ref.current;
    if (!canvas || entries.length === 0) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;
    const plotW = w - PAD.left - PAD.right;
    plotWRef.current = plotW;
    const plotH = h - PAD.top - PAD.bottom;
    const xStep = entries.length > 1 ? plotW / (entries.length - 1) : plotW;

    const cals = entries.map((e) => e.mealsLogged > 0 ? e.totals.calories : null);
    const calTargets = entries.map((e) => e.targets?.calories ?? null);
    const weights = entries.map((e) => e.weightKg);

    const calAxis = computeAxis([...cals, ...calTargets]);
    const wAxis = computeAxis(weights);

    const CAL_CLR = "rgb(255, 179, 71)";
    const CAL_TGT_CLR = "rgba(255, 179, 71, 0.35)";
    const W_CLR = "rgb(186, 147, 232)";

    ctx.clearRect(0, 0, w, h);

    // Grid
    ctx.strokeStyle = GRID;
    ctx.lineWidth = 1;
    for (let i = 0; i <= GRID_LINES; i++) {
      const y = PAD.top + (plotH / GRID_LINES) * i;
      ctx.beginPath();
      ctx.moveTo(PAD.left, y);
      ctx.lineTo(w - PAD.right, y);
      ctx.stroke();

      const cv = calAxis.max - (calAxis.range / GRID_LINES) * i;
      ctx.fillStyle = toAlpha(CAL_CLR, 0.5);
      ctx.font = FONT;
      ctx.textAlign = "right";
      ctx.fillText(Math.round(cv).toString(), PAD.left - 6, y + 3);

      if (weights.some((v) => v !== null)) {
        const wv = wAxis.max - (wAxis.range / GRID_LINES) * i;
        ctx.fillStyle = toAlpha(W_CLR, 0.5);
        ctx.textAlign = "left";
        ctx.fillText(wv.toFixed(1), w - PAD.right + 6, y + 3);
      }
    }

    // Target calories (dashed)
    const tgtPts: { x: number; y: number }[] = [];
    for (let i = 0; i < entries.length; i++) {
      const t = calTargets[i];
      if (t === null) continue;
      const x = PAD.left + (entries.length > 1 ? i * xStep : plotW / 2);
      const y = PAD.top + plotH - ((t - calAxis.min) / calAxis.range) * plotH;
      tgtPts.push({ x, y });
    }
    drawLine(ctx, tgtPts, CAL_TGT_CLR, 1.5, true);

    // Calories line
    const calPts: { x: number; y: number }[] = [];
    for (let i = 0; i < entries.length; i++) {
      const v = cals[i];
      if (v === null) continue;
      const x = PAD.left + (entries.length > 1 ? i * xStep : plotW / 2);
      const y = PAD.top + plotH - ((v - calAxis.min) / calAxis.range) * plotH;
      calPts.push({ x, y });
    }
    drawGradientFill(ctx, calPts, CAL_CLR, PAD.top, PAD.top + plotH);
    drawLine(ctx, calPts, CAL_CLR);
    drawDots(ctx, calPts, CAL_CLR);

    // Weight line
    const wPts: { x: number; y: number }[] = [];
    for (let i = 0; i < entries.length; i++) {
      const v = weights[i];
      if (v === null) continue;
      const x = PAD.left + (entries.length > 1 ? i * xStep : plotW / 2);
      const y = PAD.top + plotH - ((v - wAxis.min) / wAxis.range) * plotH;
      wPts.push({ x, y });
    }
    drawLine(ctx, wPts, W_CLR, 2);
    drawDots(ctx, wPts, W_CLR, 3);

    drawXLabels(ctx, entries, plotW, xStep, h);

    // Legend
    ctx.font = BOLD;
    ctx.textAlign = "left";
    ctx.fillStyle = CAL_CLR;
    ctx.fillText("Calories", PAD.left, 16);
    if (weights.some((v) => v !== null)) {
      const cw = ctx.measureText("Calories").width;
      ctx.fillStyle = LABEL_CLR;
      ctx.fillText(" · ", PAD.left + cw, 16);
      ctx.fillStyle = W_CLR;
      ctx.fillText("Weight", PAD.left + cw + ctx.measureText(" · ").width, 16);
    }

    // Latest calorie value
    if (calPts.length > 0) {
      const lastCal = cals.filter((v): v is number => v !== null);
      ctx.font = BOLD;
      ctx.textAlign = "right";
      ctx.fillStyle = CAL_CLR;
      ctx.fillText(`${Math.round(lastCal[lastCal.length - 1]!)} kcal`, w - PAD.right - 2, 16);
    }

    // Tooltip on long-press
    if (highlightIdx !== null && highlightIdx >= 0 && highlightIdx < entries.length) {
      const e = entries[highlightIdx]!;
      const tipLines = [fmtDate(e.date)];
      if (e.mealsLogged > 0) tipLines.push(`Cal: ${Math.round(e.totals.calories)} kcal`);
      if (e.targets) tipLines.push(`Target: ${Math.round(e.targets.calories)} kcal`);
      if (e.weightKg !== null) tipLines.push(`Weight: ${e.weightKg.toFixed(1)} kg`);
      if (e.gymCheckedIn) tipLines.push("🏋️ Gym day");
      drawTooltip(ctx, highlightIdx, entries, tipLines, w, h, plotW);
    }
  }, [entries]);

  useEffect(() => {
    draw(tooltipIdx);
    const h = () => draw(tooltipIdx);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, [draw, tooltipIdx]);

  return <canvas ref={ref} className="nutrition-tracking-canvas" style={{ width: "100%", height: 200 }} />;
}

/* ── BodyCompChart: Body Fat % (left axis) + Muscle Mass kg (right axis) ── */

interface BodyCompProps {
  entries: NutritionDayHistoryEntry[];
}

export function BodyCompChart({ entries }: BodyCompProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const plotWRef = useRef(0);
  const tooltipIdx = useLongPress(ref, entries, plotWRef.current);

  const draw = useCallback((highlightIdx: number | null = null) => {
    const canvas = ref.current;
    if (!canvas || entries.length === 0) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;
    const plotW = w - PAD.left - PAD.right;
    plotWRef.current = plotW;
    const plotH = h - PAD.top - PAD.bottom;
    const xStep = entries.length > 1 ? plotW / (entries.length - 1) : plotW;

    const bfVals = entries.map((e) => e.fatRatioPercent);
    const mmVals = entries.map((e) => e.muscleMassKg);

    const hasBf = bfVals.some((v) => v !== null);
    const hasMm = mmVals.some((v) => v !== null);

    if (!hasBf && !hasMm) {
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = LABEL_CLR;
      ctx.font = BOLD;
      ctx.textAlign = "center";
      ctx.fillText("No body composition data for this period", w / 2, h / 2);
      return;
    }

    const BF_CLR = "rgb(239, 154, 154)";
    const MM_CLR = "rgb(129, 199, 132)";
    const GYM_CLR = "rgb(76, 175, 80)";

    const bfAxis = computeAxis(bfVals, 0.12);
    const mmAxis = computeAxis(mmVals, 0.12);

    ctx.clearRect(0, 0, w, h);

    // Grid + axis labels
    ctx.strokeStyle = GRID;
    ctx.lineWidth = 1;
    for (let i = 0; i <= GRID_LINES; i++) {
      const y = PAD.top + (plotH / GRID_LINES) * i;
      ctx.beginPath();
      ctx.moveTo(PAD.left, y);
      ctx.lineTo(w - PAD.right, y);
      ctx.stroke();

      if (hasBf) {
        const bv = bfAxis.max - (bfAxis.range / GRID_LINES) * i;
        ctx.fillStyle = toAlpha(BF_CLR, 0.5);
        ctx.font = FONT;
        ctx.textAlign = "right";
        ctx.fillText(`${bv.toFixed(1)}%`, PAD.left - 6, y + 3);
      }

      if (hasMm) {
        const mv = mmAxis.max - (mmAxis.range / GRID_LINES) * i;
        ctx.fillStyle = toAlpha(MM_CLR, 0.5);
        ctx.font = FONT;
        ctx.textAlign = "left";
        ctx.fillText(`${mv.toFixed(1)}`, w - PAD.right + 6, y + 3);
      }
    }

    // Body fat % line
    if (hasBf) {
      const bfPts: { x: number; y: number }[] = [];
      for (let i = 0; i < entries.length; i++) {
        const v = bfVals[i];
        if (v === null) continue;
        const x = PAD.left + (entries.length > 1 ? i * xStep : plotW / 2);
        const y = PAD.top + plotH - ((v - bfAxis.min) / bfAxis.range) * plotH;
        bfPts.push({ x, y });
      }
      drawGradientFill(ctx, bfPts, BF_CLR, PAD.top, PAD.top + plotH);
      drawLine(ctx, bfPts, BF_CLR, 2);
      drawDots(ctx, bfPts, BF_CLR, 3);
    }

    // Muscle mass line
    if (hasMm) {
      const mmPts: { x: number; y: number }[] = [];
      for (let i = 0; i < entries.length; i++) {
        const v = mmVals[i];
        if (v === null) continue;
        const x = PAD.left + (entries.length > 1 ? i * xStep : plotW / 2);
        const y = PAD.top + plotH - ((v - mmAxis.min) / mmAxis.range) * plotH;
        mmPts.push({ x, y });
      }
      drawLine(ctx, mmPts, MM_CLR, 2);
      drawDots(ctx, mmPts, MM_CLR, 3);
    }

    drawXLabels(ctx, entries, plotW, xStep, h);

    // Gym day markers
    const hasGym = entries.some((e) => e.gymCheckedIn);
    if (hasGym) {
      for (let i = 0; i < entries.length; i++) {
        if (!entries[i]!.gymCheckedIn) continue;
        const x = PAD.left + (entries.length > 1 ? i * xStep : plotW / 2);
        const y = PAD.top + 4;
        ctx.beginPath();
        ctx.moveTo(x, y - 4);
        ctx.lineTo(x - 3.5, y + 3);
        ctx.lineTo(x + 3.5, y + 3);
        ctx.closePath();
        ctx.fillStyle = GYM_CLR;
        ctx.fill();
      }
    }

    // Legend
    ctx.font = BOLD;
    ctx.textAlign = "left";
    let lx = PAD.left;
    if (hasBf) {
      ctx.fillStyle = BF_CLR;
      ctx.fillText("Body Fat %", lx, 16);
      lx += ctx.measureText("Body Fat %").width;
    }
    if (hasBf && hasMm) {
      ctx.fillStyle = LABEL_CLR;
      ctx.fillText(" · ", lx, 16);
      lx += ctx.measureText(" · ").width;
    }
    if (hasMm) {
      ctx.fillStyle = MM_CLR;
      ctx.fillText("Muscle kg", lx, 16);
      lx += ctx.measureText("Muscle kg").width;
    }
    if (hasGym) {
      ctx.fillStyle = LABEL_CLR;
      ctx.fillText(" · ", lx, 16);
      lx += ctx.measureText(" · ").width;
      ctx.fillStyle = GYM_CLR;
      ctx.fillText("▲ Gym", lx, 16);
    }

    // Latest values on right
    ctx.font = BOLD;
    ctx.textAlign = "right";
    let rx = w - PAD.right;
    if (hasMm) {
      const lastMm = mmVals.filter((v): v is number => v !== null);
      if (lastMm.length > 0) {
        ctx.fillStyle = MM_CLR;
        const txt = `${lastMm[lastMm.length - 1]!.toFixed(1)} kg`;
        ctx.fillText(txt, rx, 16);
        rx -= ctx.measureText(txt).width + 8;
      }
    }
    if (hasBf) {
      const lastBf = bfVals.filter((v): v is number => v !== null);
      if (lastBf.length > 0) {
        ctx.fillStyle = BF_CLR;
        ctx.fillText(`${lastBf[lastBf.length - 1]!.toFixed(1)}%`, rx, 16);
      }
    }

    // Tooltip on long-press
    if (highlightIdx !== null && highlightIdx >= 0 && highlightIdx < entries.length) {
      const e = entries[highlightIdx]!;
      const tipLines = [fmtDate(e.date)];
      if (e.fatRatioPercent !== null) tipLines.push(`BF: ${e.fatRatioPercent.toFixed(1)}%`);
      if (e.muscleMassKg !== null) tipLines.push(`Muscle: ${e.muscleMassKg.toFixed(1)} kg`);
      if (e.gymCheckedIn) tipLines.push("🏋️ Gym day");
      drawTooltip(ctx, highlightIdx, entries, tipLines, w, h, plotW);
    }
  }, [entries]);

  useEffect(() => {
    draw(tooltipIdx);
    const h = () => draw(tooltipIdx);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, [draw, tooltipIdx]);

  return <canvas ref={ref} className="nutrition-tracking-canvas" style={{ width: "100%", height: 200 }} />;
}
