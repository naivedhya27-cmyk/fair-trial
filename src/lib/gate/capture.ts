// Capture gate (validation steps S07, S10). Two layers:
//  1. absolute: every photo (face found, pose, distance, framing, sharpness, clipping);
//  2. consistency: a check-in photo against the trial's baseline (light level, colour, side light, sharpness),
//     because a split-face comparison is only fair when the light is the same as at baseline.
// Light is judged on references a skin-care product cannot change, the whites of the eyes and the lips, never on the
// skin: S10 found that judging it on the cheeks rejected every photo whose treated half had truly improved.
// The pixel statistics run in the browser (or a headless browser in validation); the decision is a pure function.
import { CHEEK_L, CHEEK_R, FACE_OVAL, LEFT_EYE, LIPS, RIGHT_EYE, hull, midlineFit, pick, rasterize, type FaceGeometry } from "../vision/geometry";

export interface Pixels {
  data: Uint8ClampedArray | Uint8Array; // RGBA
  width: number;
  height: number;
}

export interface CaptureStats {
  faces: number;
  yaw: number;
  pitch: number;
  roll: number;
  /** face-oval width / image width */
  faceWidth: number;
  /** face oval fully inside the frame with a 2% margin */
  inFrame: boolean;
  /** mean luma (0-255) over both cheek patches */
  luma: number;
  /** log(luma image-left cheek / luma image-right cheek) */
  side: number;
  /** fraction of cheek pixels blown (all channels >= 250; S10c, was any channel) / crushed (all channels <= 10) */
  clipHi: number;
  clipLo: number;
  /** mean R/G and B/G over the cheeks */
  rg: number;
  bg: number;
  /** variance of the Laplacian on the face crop resampled to 256 px wide, brightness-normalised */
  sharpness: number;
  /** Light references skin care cannot change (S10): the whites of the eyes, as the 75th percentile of luma inside each
   *  eye opening, image-left and image-right */
  eyeL: number;
  eyeR: number;
  /** median luma of each half of the lips, split at the facial midline */
  lipL: number;
  lipR: number;
  /** R/G and B/G of the brighter half of the eye-opening pixels */
  eyeRg: number;
  eyeBg: number;
}

export type GateReason =
  "no_face" | "several_faces" | "turned" | "tilted" | "too_far" | "too_close" | "off_centre" | "too_dark" | "too_bright" | "side_light" | "blurry" | "light_changed" | "colour_changed" | "eyes_hidden";

export interface GateThresholds {
  maxYaw: number;
  maxPitch: number;
  maxRoll: number;
  minFaceWidth: number;
  maxFaceWidth: number;
  maxClip: number;
  maxSide: number;
  minSharpness: number;
  maxLumaShift: number;
  maxColourShift: number;
  /** side light: the eye-white balance and the lip balance must both move past their limits, the same way */
  maxEyeSideShift: number;
  maxLipSideShift: number;
  minSharpnessRatio: number;
}

/** Set on S07 development faces (reports/s07_REPORT.md); maxSide lifted after S07. The light shifts are measured on the
 *  eye and lip references since S10b, side light by two-reference agreement since S10c, limits set on development faces
 *  each time (reports/s10b_REPORT.md, reports/s10c_REPORT.md). */
export const THRESHOLDS: GateThresholds = {
  maxYaw: 8,
  maxPitch: 12,
  maxRoll: 7,
  minFaceWidth: 0.3,
  maxFaceWidth: 0.92,
  maxClip: 0.1,
  maxSide: Number.POSITIVE_INFINITY, // S07: a fixed limit without a baseline rejected a Fitzpatrick VI face; judged only as change
  minSharpness: 0.002,
  maxLumaShift: 0.16,
  maxColourShift: 0.11,
  maxEyeSideShift: 0.1,
  maxLipSideShift: 0.029,
  minSharpnessRatio: 0.4,
};

/** Light level of the references: mean log luma of both eye whites and both lip halves. */
export const refLevel = (s: CaptureStats) => (Math.log(s.eyeL) + Math.log(s.eyeR) + Math.log(s.lipL) + Math.log(s.lipR)) / 4;
/** Left-right light balance of the eye whites and of the lips (log ratios, image left over image right). */
export const eyeSide = (s: CaptureStats) => Math.log(s.eyeL / s.eyeR);
export const lipSide = (s: CaptureStats) => Math.log(s.lipL / s.lipR);
const hasRefs = (s: CaptureStats) => [s.eyeL, s.eyeR, s.lipL, s.lipR, s.eyeRg, s.eyeBg].every((v) => Number.isFinite(v) && v > 0);

const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** Pixel statistics for one photo and its face geometry. */
export function captureStats(px: Pixels, face: FaceGeometry | null, faces: number): CaptureStats {
  const nan = Number.NaN;
  if (!face) {
    return {
      faces,
      yaw: nan,
      pitch: nan,
      roll: nan,
      faceWidth: 0,
      inFrame: false,
      luma: nan,
      side: nan,
      clipHi: nan,
      clipLo: nan,
      rg: nan,
      bg: nan,
      sharpness: nan,
      eyeL: nan,
      eyeR: nan,
      lipL: nan,
      lipR: nan,
      eyeRg: nan,
      eyeBg: nan,
    };
  }
  const { width: W, height: H } = px;
  const oval = pick(face.points, FACE_OVAL);
  let x0 = Infinity,
    x1 = -Infinity,
    y0 = Infinity,
    y1 = -Infinity;
  for (const q of oval) {
    x0 = Math.min(x0, q.x);
    x1 = Math.max(x1, q.x);
    y0 = Math.min(y0, q.y);
    y1 = Math.max(y1, q.y);
  }
  const m = 0.02;
  const inFrame = x0 >= W * m && x1 <= W * (1 - m) && y0 >= H * m && y1 <= H * (1 - m);

  const cheekStats = (idx: number[]) => {
    const mask = rasterize(hull(pick(face.points, idx)), W, H);
    let n = 0,
      sl = 0,
      sr = 0,
      sg = 0,
      sb = 0,
      hi = 0,
      lo = 0;
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i]) continue;
      const r = px.data[4 * i],
        g = px.data[4 * i + 1],
        b = px.data[4 * i + 2];
      n++;
      sl += luma(r, g, b);
      sr += r;
      sg += g;
      sb += b;
      if (r >= 250 && g >= 250 && b >= 250) hi++;
      if (r <= 10 && g <= 10 && b <= 10) lo++;
    }
    return { n, sl, sr, sg, sb, hi, lo };
  };
  const L = cheekStats(CHEEK_L),
    R = cheekStats(CHEEK_R);
  const n = L.n + R.n;
  const lumL = L.sl / Math.max(1, L.n),
    lumR = R.sl / Math.max(1, R.n);

  return {
    faces,
    yaw: face.pose.yaw,
    pitch: face.pose.pitch,
    roll: face.pose.roll,
    faceWidth: (x1 - x0) / W,
    inFrame,
    luma: (L.sl + R.sl) / Math.max(1, n),
    side: Math.log(Math.max(1, lumL) / Math.max(1, lumR)),
    clipHi: (L.hi + R.hi) / Math.max(1, n),
    clipLo: (L.lo + R.lo) / Math.max(1, n),
    rg: (L.sr + R.sr) / Math.max(1, L.sg + R.sg),
    bg: (L.sb + R.sb) / Math.max(1, L.sg + R.sg),
    sharpness: sharpness(px, x0, y0, x1, y1),
    ...references(px, face),
  };
}

const quantile = (v: number[], q: number) => {
  if (!v.length) return Number.NaN;
  const s = [...v].sort((a, b) => a - b);
  const k = (s.length - 1) * q,
    lo = Math.floor(k),
    hi = Math.ceil(k);
  return s[lo] + (s[hi] - s[lo]) * (k - lo);
};

/** Light references that a skin-care product cannot change: the whites of the eyes and the two halves of the lips. */
export function references(px: Pixels, face: FaceGeometry) {
  const { width: W, height: H } = px;
  const at = (i: number) => luma(px.data[4 * i], px.data[4 * i + 1], px.data[4 * i + 2]);
  // Eye white: 75th percentile of luma over the eye opening. On development faces this separated side light from benign
  // re-captures better than the opening without the iris (S10c); it is noisy on deep-set eyes, which is why side light
  // needs the lips to agree (gate()).
  const eye = (idx: number[]) => {
    const mask = rasterize(hull(pick(face.points, idx)), W, H);
    const lum: number[] = [],
      where: number[] = [];
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i]) continue;
      lum.push(at(i));
      where.push(i);
    }
    const med = quantile(lum, 0.5);
    let sr = 0,
      sg = 0,
      sb = 0;
    for (let k = 0; k < lum.length; k++) {
      if (lum[k] < med) continue;
      const i = where[k];
      sr += px.data[4 * i];
      sg += px.data[4 * i + 1];
      sb += px.data[4 * i + 2];
    }
    return { med: lum.length >= 8 ? quantile(lum, 0.75) : Number.NaN, sr, sg, sb };
  };
  const L = eye(LEFT_EYE),
    R = eye(RIGHT_EYE);
  const { a, b } = midlineFit(face.points);
  const lips = rasterize(hull(pick(face.points, LIPS)), W, H);
  const ll: number[] = [],
    lr: number[] = [];
  for (let i = 0; i < lips.length; i++) {
    if (!lips[i]) continue;
    const x = (i % W) + 0.5,
      y = Math.floor(i / W) + 0.5;
    (x < a + b * y ? ll : lr).push(at(i));
  }
  return {
    eyeL: L.med,
    eyeR: R.med,
    lipL: quantile(ll, 0.5),
    lipR: quantile(lr, 0.5),
    eyeRg: (L.sr + R.sr) / Math.max(1, L.sg + R.sg),
    eyeBg: (L.sb + R.sb) / Math.max(1, L.sg + R.sg),
  };
}

/** Brightness-normalised Laplacian variance on the face box resampled to 256 px wide (bilinear). */
export function sharpness(px: Pixels, x0: number, y0: number, x1: number, y1: number): number {
  const cw = Math.max(8, x1 - x0),
    ch = Math.max(8, y1 - y0);
  const w = 256,
    h = Math.max(8, Math.round((256 * ch) / cw));
  const g = new Float32Array(w * h);
  const W = px.width,
    H = px.height;
  let mean = 0;
  for (let j = 0; j < h; j++) {
    const sy = Math.min(H - 1.001, Math.max(0, y0 + ((j + 0.5) * ch) / h - 0.5));
    const yi = Math.floor(sy),
      fy = sy - yi;
    for (let i = 0; i < w; i++) {
      const sx = Math.min(W - 1.001, Math.max(0, x0 + ((i + 0.5) * cw) / w - 0.5));
      const xi = Math.floor(sx),
        fx = sx - xi;
      const at = (x: number, y: number) => {
        const k = 4 * (y * W + x);
        return luma(px.data[k], px.data[k + 1], px.data[k + 2]);
      };
      const v = (1 - fy) * ((1 - fx) * at(xi, yi) + fx * at(xi + 1, yi)) + fy * ((1 - fx) * at(xi, yi + 1) + fx * at(xi + 1, yi + 1));
      g[j * w + i] = v;
      mean += v;
    }
  }
  mean /= w * h;
  if (mean < 1) return 0;
  let s = 0,
    s2 = 0,
    n = 0;
  for (let j = 1; j < h - 1; j++) {
    for (let i = 1; i < w - 1; i++) {
      const k = j * w + i;
      const lap = (g[k - 1] + g[k + 1] + g[k - w] + g[k + w] - 4 * g[k]) / mean;
      s += lap;
      s2 += lap * lap;
      n++;
    }
  }
  const mu = s / n;
  return s2 / n - mu * mu;
}

export interface GateResult {
  ok: boolean;
  reasons: GateReason[];
}

/** Absolute checks for any photo; with `baseline`, also the consistency checks for a check-in. */
export function gate(s: CaptureStats, baseline?: CaptureStats | null, t: GateThresholds = THRESHOLDS): GateResult {
  const r = new Set<GateReason>();
  if (s.faces === 0 || !Number.isFinite(s.luma)) return { ok: false, reasons: ["no_face"] };
  if (s.faces > 1) r.add("several_faces");
  if (Math.abs(s.yaw) > t.maxYaw) r.add("turned");
  if (Math.abs(s.pitch) > t.maxPitch || Math.abs(s.roll) > t.maxRoll) r.add("tilted");
  if (s.faceWidth < t.minFaceWidth) r.add("too_far");
  // S15: a face cut by the frame edge is "off_centre" unless it is also too wide; the same photos are refused as before.
  if (s.faceWidth > t.maxFaceWidth) r.add("too_close");
  else if (!s.inFrame) r.add("off_centre");
  if (s.clipLo > t.maxClip) r.add("too_dark");
  if (s.clipHi > t.maxClip) r.add("too_bright");
  if (Math.abs(s.side) > t.maxSide) r.add("side_light");
  if (s.sharpness < t.minSharpness) r.add("blurry");
  if (!hasRefs(s)) r.add("eyes_hidden");
  if (baseline && hasRefs(baseline) && hasRefs(s)) {
    const dl = refLevel(s) - refLevel(baseline);
    if (dl < -t.maxLumaShift) r.add("too_dark");
    else if (dl > t.maxLumaShift) r.add("too_bright");
    if (Math.abs(Math.log(s.eyeRg / baseline.eyeRg)) > t.maxColourShift || Math.abs(Math.log(s.eyeBg / baseline.eyeBg)) > t.maxColourShift) {
      r.add("colour_changed");
    }
    // Side light moves both references the same way; one reference moving alone is that reference's own noise (S10c).
    const de = eyeSide(s) - eyeSide(baseline),
      dp = lipSide(s) - lipSide(baseline);
    if (Math.abs(de) > t.maxEyeSideShift && Math.abs(dp) > t.maxLipSideShift && Math.sign(de) === Math.sign(dp)) r.add("side_light");
    if (s.sharpness < t.minSharpnessRatio * baseline.sharpness) r.add("blurry");
  }
  return { ok: r.size === 0, reasons: [...r] };
}

/** The S07 consistency rule, retired in S10 (light judged on the cheeks); kept only so validation can compare the two. */
export function gateS07(s: CaptureStats, baseline?: CaptureStats | null, t: GateThresholds & { maxSideShift: number } = { ...THRESHOLDS, maxSideShift: 0.09 }): GateResult {
  const r = new Set<GateReason>(gate(s, null, t).reasons.filter((x) => x !== "eyes_hidden"));
  if (baseline && Number.isFinite(baseline.luma) && Number.isFinite(s.luma)) {
    const dl = Math.log(s.luma / baseline.luma);
    if (dl < -t.maxLumaShift) r.add("too_dark");
    else if (dl > t.maxLumaShift) r.add("too_bright");
    if (Math.abs(Math.log(s.rg / baseline.rg)) > t.maxColourShift || Math.abs(Math.log(s.bg / baseline.bg)) > t.maxColourShift) r.add("colour_changed");
    if (Math.abs(s.side - baseline.side) > t.maxSideShift) r.add("side_light");
    if (s.sharpness < t.minSharpnessRatio * baseline.sharpness) r.add("blurry");
  }
  return { ok: r.size === 0, reasons: [...r] };
}

/** Plain-language guidance for each reason, used by the capture screen and its voice prompts. */
export const GUIDANCE: Record<GateReason, string> = {
  no_face: "I can't find a face. Hold the phone at arm's length, face the camera.",
  several_faces: "More than one face is in the picture. Make sure only you are in frame.",
  turned: "Turn your head to look straight at the camera.",
  tilted: "Keep your head level, chin neither up nor down.",
  too_far: "Come a little closer so your face fills the oval.",
  too_close: "Move back a little so your whole face fits in the oval.",
  off_centre: "Move so your face sits in the middle of the oval.",
  too_dark: "It's darker than your first photo. Face a window or turn on a light in front of you.",
  too_bright: "It's brighter than your first photo. Step out of direct light.",
  side_light: "One side of your face is lit more than the other. Face the light squarely.",
  blurry: "The photo is blurry. Hold still, or rest your elbows on a table.",
  light_changed: "The light has changed since your first photo. Use the same spot and time of day.",
  colour_changed: "The light's colour has changed since your first photo. Use the same lamp or window.",
  eyes_hidden: "I can't see your eyes and lips clearly. Look at the camera with eyes open, glasses off, mouth relaxed.",
};

/** When several checks fail, the one to fix first: framing, then pose, then light, then sharpness. Hidden eyes come
 * last because dark or blurred photos also hide them, and fixing the light usually brings them back (S15). */
export const REASON_ORDER: readonly GateReason[] = [
  "no_face",
  "several_faces",
  "too_far",
  "too_close",
  "off_centre",
  "turned",
  "tilted",
  "too_dark",
  "too_bright",
  "side_light",
  "colour_changed",
  "light_changed",
  "blurry",
  "eyes_hidden",
];

export function primaryReason(reasons: readonly GateReason[]): GateReason {
  return REASON_ORDER.find((r) => reasons.includes(r)) ?? reasons[0] ?? "no_face";
}
