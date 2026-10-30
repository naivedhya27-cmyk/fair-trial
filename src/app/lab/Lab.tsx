"use client";
// Validation lab: runs the app's own browser code (MediaPipe landmarks + capture statistics) on a photo passed in by
// the headless-browser runners (scripts/lab-run.mjs; scripts/s14-e2e.mjs for the live end-to-end test). Nothing here
// is used by the product screens.
import { useEffect, useState } from "react";
import { detectFace, getLandmarker } from "@/lib/vision/landmarker";
import { captureStats, gate, primaryReason, type CaptureStats } from "@/lib/gate/capture";
import { halfMetric, halfRegions, type HalfRegions } from "@/lib/metrics/halfface";
import { scaleGeometry } from "@/lib/vision/geometry";

declare global {
  interface Window {
    __lab?: {
      run: (dataUrl: string) => Promise<unknown>;
      e2e: (dataUrl: string, concerns: string[]) => Promise<unknown>;
      gate: (stats: CaptureStats, baseline?: CaptureStats | null) => unknown;
    };
    __labReady?: boolean;
  }
}

type Poll = { state: "running" } | { state: "error"; error: string } | { state: "success"; concerns: Record<string, { raw: number; mask: string | null }> };

/** The product's live path in one call: detect, upload through /api/analysis, poll, fetch each mask through /api/mask
 * and measure it per half-face. */
async function endToEnd(dataUrl: string, concerns: string[]) {
  const t0 = performance.now();
  const img = await load(dataUrl);
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  c.getContext("2d")!.drawImage(img, 0, 0);
  const det = await detectFace(c);
  if (!det.face) return { error: "no face" };
  const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), "image/jpeg", 0.92));
  const fd = new FormData();
  fd.append("photo", blob, "capture.jpg");
  fd.append("concerns", concerns.join(","));
  const r0 = await fetch("/api/analysis", { method: "POST", body: fd });
  const start = await r0.json();
  if (!r0.ok) return { error: start.error, status: r0.status };
  const tStart = performance.now();
  let s: Poll = { state: "running" };
  while (s.state === "running") {
    if (performance.now() - tStart > 180_000) return { error: "timeout", taskId: start.taskId };
    await new Promise((r) => setTimeout(r, 2500));
    s = await (await fetch(`/api/analysis/${encodeURIComponent(start.taskId)}`)).json();
  }
  if (s.state === "error") return { error: s.error, taskId: start.taskId };
  const analysedMs = Math.round(performance.now() - t0);
  const regions = new Map<string, HalfRegions>();
  const out: Record<string, unknown> = {};
  for (const [name, v] of Object.entries(s.concerns)) {
    if (!v.mask) {
      out[name] = { raw: v.raw, mask: null };
      continue;
    }
    const r2 = await fetch(`/api/mask?u=${encodeURIComponent(v.mask)}`);
    if (!r2.ok) {
      out[name] = { raw: v.raw, maskStatus: r2.status };
      continue;
    }
    const bmp = await createImageBitmap(await r2.blob());
    const mc = document.createElement("canvas");
    mc.width = bmp.width;
    mc.height = bmp.height;
    const mctx = mc.getContext("2d", { willReadFrequently: true })!;
    mctx.drawImage(bmp, 0, 0);
    const d = mctx.getImageData(0, 0, bmp.width, bmp.height).data;
    const alpha = new Uint8Array(bmp.width * bmp.height);
    for (let i = 0; i < alpha.length; i++) alpha[i] = d[4 * i + 3];
    const key = `${bmp.width}x${bmp.height}`;
    if (!regions.has(key)) regions.set(key, halfRegions(scaleGeometry(det.face, bmp.width, bmp.height)));
    out[name] = { raw: v.raw, maskSize: key, half: halfMetric(regions.get(key)!, alpha) };
  }
  return { taskId: start.taskId, units: start.units, analysedMs, totalMs: Math.round(performance.now() - t0), concerns: out };
}

async function load(dataUrl: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.decoding = "sync";
  img.src = dataUrl;
  await img.decode();
  return img;
}

export default function Lab() {
  const [state, setState] = useState("loading the face model");
  useEffect(() => {
    let alive = true;
    getLandmarker().then(() => {
      if (!alive) return;
      window.__lab = {
        run: async (dataUrl: string) => {
          const img = await load(dataUrl);
          const c = document.createElement("canvas");
          c.width = img.naturalWidth;
          c.height = img.naturalHeight;
          const ctx = c.getContext("2d", { willReadFrequently: true })!;
          ctx.drawImage(img, 0, 0);
          const px = ctx.getImageData(0, 0, c.width, c.height);
          const det = await detectFace(c);
          const stats = captureStats(px, det.face, det.faces);
          return {
            stats,
            width: c.width,
            height: c.height,
            points: det.face ? det.face.points.map((p) => [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10]) : null,
          };
        },
        e2e: endToEnd,
        gate: (stats: CaptureStats, baseline?: CaptureStats | null) => {
          const g = gate(stats, baseline);
          return { ...g, primary: g.ok ? null : primaryReason(g.reasons) };
        },
      };
      window.__labReady = true;
      setState("ready");
    });
    return () => {
      alive = false;
    };
  }, []);
  return (
    <main style={{ padding: 24, fontFamily: "system-ui" }}>
      <h1>Validation lab</h1>
      <p id="lab-state">{state}</p>
    </main>
  );
}
