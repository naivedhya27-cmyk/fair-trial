import "server-only";
// Server-side YouCam client. The API key lives only in the server environment (YOUCAM_API_KEY); the browser never sees
// it. Photos pass through to YouCam's File API and are not stored here.
import { sdUnits, type RawOutputItem } from "./types";

const BASE = process.env.YOUCAM_BASE ?? "https://yce-api-01.makeupar.com";

function key(): string {
  const k = process.env.YOUCAM_API_KEY;
  if (!k) throw new Error("YOUCAM_API_KEY is not set");
  return k;
}

/** 429 is always retried (the request was not run). 5xx and network errors are retried only for calls that are safe to
 * repeat, so a task that may already have started (and been charged) is never started twice. */
async function call<T = unknown>(path: string, init: RequestInit = {}, { tries = 3, repeatable = true }: { tries?: number; repeatable?: boolean } = {}): Promise<{ status: number; body: T }> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(`${BASE}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
        cache: "no-store",
        signal: AbortSignal.timeout(25000),
      });
      if ((res.status === 429 || (repeatable && res.status >= 500)) && i < tries - 1) {
        await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
        continue;
      }
      const text = await res.text();
      let body: unknown = text;
      try {
        body = JSON.parse(text);
      } catch {
        /* keep text */
      }
      return { status: res.status, body: body as T };
    } catch (e) {
      last = e;
      if (!repeatable) break;
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
  throw new Error(`YouCam request failed: ${String(last)}`);
}

type Credit = { amount?: number; credit?: number; balance?: number };

/** Units left on the account (free endpoint). The balance comes as `results` (seen in S03), older docs say `data`. */
export async function creditBalance(): Promise<number> {
  const r = await call<{ results?: Credit[] | Credit; data?: Credit[] | Credit }>("/s2s/v1.0/client/credit");
  if (r.status !== 200) throw new Error(`credit check failed (${r.status})`);
  const d = r.body?.results ?? r.body?.data;
  const arr = Array.isArray(d) ? d : d ? [d] : [];
  return arr.reduce((s, x) => s + (Number(x?.amount ?? x?.credit ?? x?.balance) || 0), 0);
}

/** Units the account must keep after any call; the lane keeps 350 for the judges while testing (YOUCAM_UNIT_FLOOR). Since
 * S21 this is the judges' floor: calls carrying the judges' code (src/lib/youcam/judge.ts) may go down to it. */
export function unitFloor(): number {
  const f = Number(process.env.YOUCAM_UNIT_FLOOR);
  return Number.isFinite(f) && f >= 0 ? f : 30;
}

/** Where live analysis stops for everyone else (YOUCAM_PUBLIC_FLOOR), so what lies below it is kept for judging (S21).
 * Never below the judges' floor; unset or not a number, it is the judges' floor (no difference). */
export function publicFloor(): number {
  const f = Number(process.env.YOUCAM_PUBLIC_FLOOR);
  return Math.max(unitFloor(), process.env.YOUCAM_PUBLIC_FLOOR && Number.isFinite(f) ? f : unitFloor());
}

export class UnitsLow extends Error {
  constructor(public balance: number) {
    super("units low");
  }
}

/** Refuse a call that would take the balance below `floor` (the judges' floor unless given); returns the balance before
 * the call. */
export async function ensureUnits(cost: number, floor = unitFloor()): Promise<number> {
  const balance = await creditBalance();
  if (balance - cost < floor) throw new UnitsLow(balance);
  return balance;
}

/** Upload a photo through the File API; returns its file_id. */
export async function uploadPhoto(bytes: Uint8Array, contentType: "image/jpeg" | "image/png", name = "capture.jpg"): Promise<string> {
  const init = await call<{ data?: { files?: { file_id: string; requests: { url: string; method?: string; headers?: Record<string, string> }[] }[] } }>("/s2s/v2.0/file", {
    method: "POST",
    body: JSON.stringify({ files: [{ content_type: contentType, file_name: name, file_size: bytes.byteLength }] }),
  });
  const f = init.body?.data?.files?.[0];
  if (!f?.file_id || !f.requests?.[0]?.url) throw new Error(`file init failed (${init.status})`);
  const put = await fetch(f.requests[0].url, {
    method: f.requests[0].method ?? "PUT",
    headers: { "Content-Type": contentType, ...(f.requests[0].headers ?? {}) },
    body: new Blob([bytes as BlobPart], { type: contentType }),
    signal: AbortSignal.timeout(30000),
  });
  if (!put.ok) throw new Error(`photo upload failed (${put.status})`);
  return f.file_id;
}

/** Start an SD skin analysis; returns the task id and the units it will cost on success. */
export async function startAnalysis(fileId: string, concerns: string[]): Promise<{ taskId: string; units: number }> {
  const r = await call<{ data?: { task_id?: string }; error?: string; error_code?: string }>(
    "/s2s/v2.0/task/skin-analysis",
    {
      method: "POST",
      body: JSON.stringify({ src_file_id: fileId, dst_actions: concerns, format: "json", miniserver_args: { enable_mask_overlay: false } }),
    },
    { repeatable: false },
  );
  const id = r.body?.data?.task_id;
  if (!id) throw new Error(`analysis not started (${r.status} ${r.body?.error_code ?? ""})`);
  return { taskId: id, units: sdUnits(concerns.length) };
}

export type TaskState = { state: "running" } | { state: "error"; error: string } | { state: "success"; output: RawOutputItem[] };

export async function analysisState(taskId: string): Promise<TaskState> {
  if (!/^[A-Za-z0-9_\-=+/]{8,200}$/.test(taskId)) return { state: "error", error: "bad task id" };
  const r = await call<{ data?: { task_status?: string; error?: string; results?: { output?: RawOutputItem[] } } }>(`/s2s/v2.0/task/skin-analysis/${encodeURIComponent(taskId)}`);
  const d = r.body?.data;
  if (d?.task_status === "success" && Array.isArray(d.results?.output)) return { state: "success", output: d.results.output };
  if (d?.task_status === "error" || r.status >= 400) return { state: "error", error: d?.error ?? `status ${r.status}` };
  return { state: "running" };
}

/** Hosts masks may come from: the S3 bucket in every saved response (414 of 414 mask addresses, S03-S10), YouCam's own
 * domains, and any host listed in YOUCAM_MASK_HOSTS (comma-separated). No bucket pattern: anyone can name a bucket. */
const MASK_HOSTS = new Set([
  "yce-us.s3-accelerate.amazonaws.com",
  ...(process.env.YOUCAM_MASK_HOSTS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
]);
const OWN_DOMAIN = /(^|\.)(makeupar|perfectcorp)\.com$/;
const MASK_MAX_BYTES = 10 * 1024 * 1024;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function maskHostAllowed(u: URL): boolean {
  return u.protocol === "https:" && !u.username && !u.password && !u.port && (MASK_HOSTS.has(u.hostname) || OWN_DOMAIN.test(u.hostname));
}

/** Download a mask PNG from the address YouCam returned: allowed hosts only, no redirects, at most 10 MB, PNG only. */
export async function fetchMask(url: string): Promise<Uint8Array> {
  const u = new URL(url);
  if (!maskHostAllowed(u)) throw new Error("unexpected mask host");
  const res = await fetch(u, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(20000) });
  if (!res.ok || !res.body) throw new Error(`mask download failed (${res.status})`);
  if (Number(res.headers.get("content-length") ?? 0) > MASK_MAX_BYTES) throw new Error("mask too large");
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MASK_MAX_BYTES) {
      await reader.cancel();
      throw new Error("mask too large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.byteLength;
  }
  if (!PNG_SIGNATURE.every((b, i) => bytes[i] === b)) throw new Error("mask is not a PNG");
  return bytes;
}
