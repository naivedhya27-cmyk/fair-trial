"use client";
// Browser side of a live analysis (the S14 path): the photo goes to /api/analysis, the task is polled, and each mask is
// fetched through /api/mask and measured per half-face here, with the face geometry found when the photo was taken.
import { judgeHeaders } from "../judge";
import { halfMetric, halfRegions, type HalfRegions, type Side } from "../metrics/halfface";
import { scaleGeometry, type FaceGeometry } from "../vision/geometry";

export class AnalysisError extends Error {
  constructor(
    public readonly kind: "limit" | "paused" | "rejected" | "unreachable" | "timeout",
    message: string,
  ) {
    super(message);
  }
}

export interface Analysis {
  taskId: string;
  units: number;
  raw: Record<string, number>;
  density: Record<string, Record<Side, number>>;
}

const KIND: Record<number, AnalysisError["kind"]> = { 429: "limit", 503: "paused", 400: "rejected", 413: "rejected", 415: "rejected" };

export async function analyse(photo: Blob, concerns: string[], face: FaceGeometry, onProgress?: (s: "uploading" | "analysing" | "measuring") => void): Promise<Analysis> {
  onProgress?.("uploading");
  const fd = new FormData();
  fd.append("photo", photo, "capture.jpg");
  fd.append("concerns", concerns.join(","));
  let start: Response;
  try {
    start = await fetch("/api/analysis", { method: "POST", body: fd, headers: judgeHeaders() });
  } catch {
    throw new AnalysisError("unreachable", "No connection. Your photo is saved; try again when you're online.");
  }
  const body = await start.json().catch(() => ({}));
  if (!start.ok) throw new AnalysisError(KIND[start.status] ?? "unreachable", body.error ?? "YouCam could not be reached.");
  onProgress?.("analysing");
  const t0 = Date.now();
  let state: { state: string; error?: string; concerns?: Record<string, { raw: number; mask: string | null }> } = { state: "running" };
  while (state.state === "running") {
    if (Date.now() - t0 > 180_000) throw new AnalysisError("timeout", "The analysis is taking too long. Your photo is saved; try again later.");
    await new Promise((r) => setTimeout(r, 2500));
    try {
      state = await (await fetch(`/api/analysis/${encodeURIComponent(body.taskId)}`)).json();
    } catch {
      state = { state: "running" };
    }
  }
  if (state.state !== "success" || !state.concerns) throw new AnalysisError("unreachable", state.error ?? "The analysis did not finish.");
  onProgress?.("measuring");
  const raw: Record<string, number> = {};
  const density: Record<string, Record<Side, number>> = {};
  const regions = new Map<string, HalfRegions>();
  for (const [name, v] of Object.entries(state.concerns)) {
    raw[name] = v.raw;
    if (!v.mask) continue;
    const r = await fetch(`/api/mask?u=${encodeURIComponent(v.mask)}`);
    if (!r.ok) continue;
    const bmp = await createImageBitmap(await r.blob());
    const c = document.createElement("canvas");
    c.width = bmp.width;
    c.height = bmp.height;
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
    const alpha = new Uint8Array(bmp.width * bmp.height);
    for (let i = 0; i < alpha.length; i++) alpha[i] = d[4 * i + 3];
    const key = `${bmp.width}x${bmp.height}`;
    if (!regions.has(key)) regions.set(key, halfRegions(scaleGeometry(face, bmp.width, bmp.height)));
    const m = halfMetric(regions.get(key)!, alpha);
    density[name] = { subject_left: m.subject_left.density, subject_right: m.subject_right.density };
  }
  return { taskId: body.taskId, units: body.units, raw, density };
}
