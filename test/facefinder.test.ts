// The face finder's files and downloads (S21): the model is named by its content, and a download that stalls, hangs or
// fails is dropped and fetched again, up to its tries, with progress that never counts a dropped try.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { download } from "@/lib/vision/download";
import { FACE_MODEL } from "@/lib/vision/model";

const aborted = () => new DOMException("The operation was aborted.", "AbortError");

/** A fetch whose answers are scripted per call: "ok" sends `size` bytes in 3 chunks, "stall" sends 100 bytes then nothing,
 * "hang" never answers, "fail" is a network error, a number is that HTTP status. Like a real fetch, an abort ends it. */
function scripted(plan: (string | number)[], size = 350) {
  const calls: string[] = [];
  const impl = ((_url: string, init?: RequestInit) => {
    const step = plan[Math.min(calls.length, plan.length - 1)];
    calls.push(String(step));
    const signal = init?.signal;
    if (step === "fail") return Promise.reject(new TypeError("Failed to fetch"));
    if (step === "hang") return new Promise((_, reject) => signal?.addEventListener("abort", () => reject(aborted())));
    if (typeof step === "number") return Promise.resolve(new Response("not here", { status: step }));
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        signal?.addEventListener("abort", () => c.error(aborted()));
        if (step === "stall") return c.enqueue(new Uint8Array(100));
        const third = Math.floor(size / 3);
        for (const n of [third, third, size - 2 * third]) c.enqueue(new Uint8Array(n));
        c.close();
      },
    });
    return Promise.resolve(new Response(body, { status: 200 }));
  }) as typeof fetch;
  return { impl, calls };
}

const fast = { stallMs: 60, backoff: () => 0 };

describe("face finder model", () => {
  it("is named by the first 8 hex digits of its SHA-256, and is the only model served", () => {
    const file = path.join("public", FACE_MODEL);
    const hash = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex").slice(0, 8);
    expect(FACE_MODEL).toBe(`/models/face_landmarker.${hash}.task`);
    expect(fs.readdirSync(path.join("public", "models"))).toEqual([path.basename(FACE_MODEL)]);
  });
});

describe("download", () => {
  it("returns every byte and reports each chunk", async () => {
    const { impl, calls } = scripted(["ok"]);
    let seen = 0;
    const b = await download("/f", (n) => (seen += n), { ...fast, fetchImpl: impl });
    expect(b.byteLength).toBe(350);
    expect(seen).toBe(350);
    expect(calls).toEqual(["ok"]);
  });

  it("drops a try that stalls part-way and fetches again, taking back the dropped bytes", async () => {
    const { impl, calls } = scripted(["stall", "ok"]);
    const counts: number[] = [];
    const b = await download("/f", (n) => counts.push(n), { ...fast, fetchImpl: impl });
    expect(b.byteLength).toBe(350);
    expect(calls).toEqual(["stall", "ok"]);
    expect(counts[0]).toBe(100);
    expect(counts[1]).toBe(-100);
    expect(counts.reduce((a, n) => a + n, 0)).toBe(350);
  });

  it("drops a request that never answers and fetches again", async () => {
    const { impl, calls } = scripted(["hang", "ok"]);
    const b = await download("/f", () => {}, { ...fast, fetchImpl: impl });
    expect(b.byteLength).toBe(350);
    expect(calls).toEqual(["hang", "ok"]);
  });

  it("counts an HTTP error as a failed try", async () => {
    const { impl, calls } = scripted([503, "ok"]);
    await expect(download("/f", () => {}, { ...fast, fetchImpl: impl })).resolves.toHaveLength(350);
    expect(calls).toEqual(["503", "ok"]);
  });

  it("gives up after its tries, with nothing left counted", async () => {
    const { impl, calls } = scripted(["stall", "fail", "hang"]);
    let seen = 0;
    await expect(download("/f", (n) => (seen += n), { ...fast, tries: 3, fetchImpl: impl })).rejects.toBeTruthy();
    expect(calls).toEqual(["stall", "fail", "hang"]);
    expect(seen).toBe(0);
  });
});
