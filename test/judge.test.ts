// The judges' code and the two floors (S21): with the code, live analysis may spend down to the judges' floor with the
// judges' daily limit; without it (or with a wrong one), it stops at the public floor with the public limit. YouCam is
// stubbed here: the credit check answers a set balance and an analysis always starts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), connection: async () => {} }));

const CODE = "Abcdefghijkl0123456789XY";
const WRONG = "Abcdefghijkl0123456789XZ";
const ENV = {
  YOUCAM_API_KEY: "test-key",
  YOUCAM_JUDGE_CODE: CODE,
  YOUCAM_UNIT_FLOOR: "30",
  YOUCAM_PUBLIC_FLOOR: "200",
  YOUCAM_DAILY_LIMIT: "3",
  YOUCAM_JUDGE_DAILY_LIMIT: "8",
};
let balance = 356;
let started = 0;

beforeEach(() => {
  vi.resetModules(); // fresh limits and status cache for each test
  Object.assign(process.env, ENV);
  balance = 356;
  started = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.endsWith("/s2s/v1.0/client/credit")) return new Response(JSON.stringify({ results: [{ amount: balance }] }), { status: 200 });
      if (url.endsWith("/s2s/v2.0/file"))
        return new Response(JSON.stringify({ data: { files: [{ file_id: "file1", requests: [{ url: "https://upload.test/put", method: "PUT" }] }] } }), { status: 200 });
      if (url === "https://upload.test/put") return new Response(null, { status: 200 });
      if (url.endsWith("/s2s/v2.0/task/skin-analysis")) {
        started++;
        return new Response(JSON.stringify({ data: { task_id: `task${String(started).padStart(6, "0")}` } }), { status: 200 });
      }
      return new Response("unexpected", { status: 418 });
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of Object.keys(ENV)) delete process.env[k];
});

const req = (path: string, code?: string, init: RequestInit = {}) => new Request(`https://fair-trial.test${path}`, { ...init, headers: code === undefined ? {} : { "x-fairtrial-judge": code } });

async function analyse(code?: string): Promise<number> {
  const { POST } = await import("@/app/api/analysis/route");
  const fd = new FormData();
  fd.append("photo", new File([new Uint8Array(20_000)], "x.jpg", { type: "image/jpeg" }));
  fd.append("concerns", "wrinkle");
  return (await POST(req("/api/analysis", code, { method: "POST", body: fd }))).status;
}

describe("the judges' code", () => {
  it("is recognised only when exactly right", async () => {
    const { isJudge } = await import("@/lib/youcam/judge");
    expect(isJudge(req("/", CODE))).toBe(true);
    expect(isJudge(req("/", WRONG))).toBe(false);
    expect(isJudge(req("/", CODE.slice(0, 20)))).toBe(false);
    expect(isJudge(req("/", ""))).toBe(false);
    expect(isJudge(req("/"))).toBe(false);
  });

  it("makes nobody a judge when no code (or a short one) is set", async () => {
    const { isJudge } = await import("@/lib/youcam/judge");
    delete process.env.YOUCAM_JUDGE_CODE;
    expect(isJudge(req("/", CODE))).toBe(false);
    process.env.YOUCAM_JUDGE_CODE = "short";
    expect(isJudge(req("/", "short"))).toBe(false);
  });
});

describe("floors and limits", () => {
  it("reads the public floor, never below the judges' floor", async () => {
    const { publicFloor, unitFloor } = await import("@/lib/youcam/server");
    expect([publicFloor(), unitFloor()]).toEqual([200, 30]);
    process.env.YOUCAM_PUBLIC_FLOOR = "10";
    expect(publicFloor()).toBe(30);
    process.env.YOUCAM_PUBLIC_FLOOR = "lots";
    expect(publicFloor()).toBe(30);
    delete process.env.YOUCAM_PUBLIC_FLOOR;
    expect(publicFloor()).toBe(30);
  });

  it("reads the judges' daily limit, 8 when unset", async () => {
    const { judgeDailyLimit } = await import("@/lib/youcam/limit");
    expect(judgeDailyLimit()).toBe(8);
    delete process.env.YOUCAM_JUDGE_DAILY_LIMIT;
    expect(judgeDailyLimit()).toBe(8);
    process.env.YOUCAM_JUDGE_DAILY_LIMIT = "5";
    expect(judgeDailyLimit()).toBe(5);
  });

  it("stops the public at the public floor and lets judges go below it", async () => {
    balance = 205; // 205 - 9 is under 200 but over 30
    expect(await analyse()).toBe(503);
    expect(await analyse(WRONG)).toBe(503);
    expect(started).toBe(0);
    expect(await analyse(CODE)).toBe(200);
    expect(started).toBe(1);
  });

  it("stops judges at the judges' floor", async () => {
    balance = 38; // 38 - 9 is under 30
    expect(await analyse(CODE)).toBe(503);
    expect(started).toBe(0);
  });

  it("gives the public 3 analyses a day and judges 8", async () => {
    const pub = [];
    for (let i = 0; i < 4; i++) pub.push(await analyse());
    expect(pub).toEqual([200, 200, 200, 429]);
    vi.resetModules();
    const judge = [];
    for (let i = 0; i < 9; i++) judge.push(await analyse(CODE));
    expect(judge).toEqual([200, 200, 200, 200, 200, 200, 200, 200, 429]);
  });
});

describe("/api/status", () => {
  async function status(code?: string) {
    const { GET } = await import("@/app/api/status/route");
    return (await GET(req("/api/status", code))).json();
  }

  it("answers for the caller and reports both floors and limits, never the balance or the code", async () => {
    balance = 205; // open to judges (205 - 16 >= 30), closed to the public (205 - 16 < 200)
    const pub = await status();
    expect(pub).toEqual({ live: false, judge: false, floor: 200, dailyLimit: 3, floors: { public: 200, judges: 30 }, dailyLimits: { public: 3, judges: 8 } });
    expect(await status(WRONG)).toMatchObject({ live: false, judge: false });
    const judge = await status(CODE);
    expect(judge).toMatchObject({ live: true, judge: true, floor: 30, dailyLimit: 8 });
    expect(JSON.stringify([pub, judge])).not.toContain(CODE);
    expect(JSON.stringify([pub, judge])).not.toContain("205");
  });

  it("says closed to everyone when the balance cannot be read", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("bad key", { status: 401 })),
    );
    expect(await status(CODE)).toMatchObject({ live: false, judge: true });
  });
});
