"use client";
// MediaPipe Face Landmarker, loaded once in the browser from self-hosted files (no third-party request).
// S21: the app fetches the face finder's three files itself (MediaPipe's loader script, its WebAssembly file and the
// model), keeps a copy in Cache Storage under their version, and hands MediaPipe in-memory copies, so a camera start
// after the first needs no network. A download that receives nothing for 10 s is fetched again (3 tries), and a load
// that fails is not kept, so the next camera start begins afresh. Progress is published for the camera screen.
// S21b: a load started ahead of the camera waits for the page to load and the browser to go idle, and asks at low fetch
// priority, so on a slow link the page's own files come first; the camera itself asks at high priority.
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import { cachedDownload, pruneCaches } from "./download";
import { poseFromMatrix, type FaceGeometry } from "./geometry";
import { FACE_MODEL, FACE_MODEL_HASH } from "./model";

/** MediaPipe's files are copied at install into a folder named by the installed version (scripts/copy-mediapipe.mjs). */
export const MEDIAPIPE_VERSION = process.env.NEXT_PUBLIC_MEDIAPIPE_VERSION || "dev";
const CACHE_PREFIX = "fairtrial-face-finder-";
const CACHE = `${CACHE_PREFIX}${MEDIAPIPE_VERSION}-${FACE_MODEL_HASH}`;

export interface FinderState {
  phase: "idle" | "loading" | "ready" | "failed";
  /** bytes received so far, as the browser unpacks them, and the bytes expected in all (next.config.ts) */
  received: number;
  expected: number;
}
let state: FinderState = { phase: "idle", received: 0, expected: Number(process.env.NEXT_PUBLIC_FACE_FINDER_BYTES) || 18_600_000 };
const listeners = new Set<(s: FinderState) => void>();
function publish(next: Partial<FinderState>) {
  state = { ...state, ...next };
  for (const f of listeners) f(state);
}
export const finderState = (): FinderState => state;
export function onFinderState(f: (s: FinderState) => void): () => void {
  listeners.add(f);
  return () => void listeners.delete(f);
}

let imageMode: Promise<FaceLandmarker> | null = null;

/** MediaPipe's WebAssembly prints start-up notices such as "INFO: Created TensorFlow Lite XNNPACK delegate for CPU."
 * through console.error. While MediaPipe runs, those notices are dropped; every other message still shows (S17). */
const notice = (args: unknown[]) => typeof args[0] === "string" && args[0].startsWith("INFO: ");
function quiet<T>(run: () => T): T {
  const error = console.error;
  console.error = (...args: unknown[]) => void (notice(args) || error.apply(console, args));
  try {
    return run();
  } finally {
    console.error = error;
  }
}
async function quietly<T>(run: () => Promise<T>): Promise<T> {
  const error = console.error;
  console.error = (...args: unknown[]) => void (notice(args) || error.apply(console, args));
  try {
    return await run();
  } finally {
    console.error = error;
  }
}

async function create(priority: RequestPriority): Promise<FaceLandmarker> {
  publish({ phase: "loading", received: 0 });
  const add = (n: number) => publish({ received: Math.max(0, state.received + n) });
  void pruneCaches(CACHE_PREFIX, CACHE);
  // MediaPipe picks the build for this browser (with or without SIMD); only its file names are used here
  const files = await FilesetResolver.forVisionTasks(`/mediapipe/${MEDIAPIPE_VERSION}/wasm`);
  const [loader, wasm, model] = await Promise.all([
    cachedDownload(CACHE, files.wasmLoaderPath, "text/javascript", add, { priority }),
    cachedDownload(CACHE, files.wasmBinaryPath, "application/wasm", add, { priority }),
    cachedDownload(CACHE, FACE_MODEL, "application/octet-stream", add, { priority }),
  ]);
  const loaderUrl = URL.createObjectURL(new Blob([loader as Uint8Array<ArrayBuffer>], { type: "text/javascript" }));
  const wasmUrl = URL.createObjectURL(new Blob([wasm as Uint8Array<ArrayBuffer>], { type: "application/wasm" }));
  const options = {
    baseOptions: { modelAssetBuffer: model, delegate: "CPU" as const },
    runningMode: "IMAGE" as const,
    numFaces: 2,
    outputFacialTransformationMatrixes: true,
    outputFaceBlendshapes: false,
  };
  try {
    return await quietly(() => FaceLandmarker.createFromOptions({ wasmLoaderPath: loaderUrl, wasmBinaryPath: wasmUrl }, options));
  } finally {
    URL.revokeObjectURL(loaderUrl);
    URL.revokeObjectURL(wasmUrl);
  }
}

/** The face finder, loaded once per page. A load that fails is dropped, so the next call starts afresh. `priority` is
 * the fetch priority of a load this call starts; a load already under way keeps its own. */
export function getLandmarker(priority: RequestPriority = "high"): Promise<FaceLandmarker> {
  if (!imageMode) {
    const p = create(priority);
    imageMode = p;
    p.then(
      () => publish({ phase: "ready", received: Math.max(state.received, state.expected) }),
      () => {
        if (imageMode === p) imageMode = null;
        publish({ phase: "failed" });
      },
    );
  }
  return imageMode;
}

/** Start loading the face finder before the camera opens, without slowing the page: once the page has loaded and the
 * browser is idle (at most 3 s later), at low fetch priority. A failure here is left to the camera, which asks again. */
export function preloadLandmarker(): void {
  if (typeof window === "undefined") return;
  const start = () => void getLandmarker("low").catch(() => undefined);
  const whenIdle = () => (typeof window.requestIdleCallback === "function" ? window.requestIdleCallback(start, { timeout: 3000 }) : window.setTimeout(start, 1000));
  if (document.readyState === "complete") whenIdle();
  else window.addEventListener("load", whenIdle, { once: true });
}

export interface Detection {
  faces: number;
  face: FaceGeometry | null;
}

/** Detect faces on an image or canvas; returns the largest face in pixel coordinates. */
export async function detectFace(source: HTMLImageElement | HTMLCanvasElement | ImageBitmap): Promise<Detection> {
  const lm = await getLandmarker();
  const width = "naturalWidth" in source ? source.naturalWidth : source.width;
  const height = "naturalHeight" in source ? source.naturalHeight : source.height;
  const res = quiet(() => lm.detect(source));
  const faces = res.faceLandmarks?.length ?? 0;
  if (!faces) return { faces: 0, face: null };
  let best = 0,
    bestSpan = -1;
  res.faceLandmarks.forEach((f, i) => {
    let x0 = 1,
      x1 = 0;
    for (const p of f) {
      x0 = Math.min(x0, p.x);
      x1 = Math.max(x1, p.x);
    }
    if (x1 - x0 > bestSpan) {
      bestSpan = x1 - x0;
      best = i;
    }
  });
  const points = res.faceLandmarks[best].map((p) => ({ x: p.x * width, y: p.y * height }));
  const mat = res.facialTransformationMatrixes?.[best]?.data;
  const pose = mat ? poseFromMatrix(mat) : { yaw: Number.NaN, pitch: Number.NaN, roll: Number.NaN };
  return { faces, face: { width, height, points, pose } };
}
