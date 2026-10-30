// S21b network probe (prereg in R/s21b_score.R): beside each audit, fetch a 1 kB file from the live address every 2 s
// (a fresh address each time, 20 s timeout) and log how long each fetch took, so a stalled link can be told apart from a
// stalled app. Stops when <stop file> appears, or after <max seconds>.
// Usage: node scripts/s21b-probe.mjs <out.csv> <stop file> <base> [max seconds=7200]
import fs from "node:fs";

const [, , out, stop, baseArg, maxArg] = process.argv;
if (!out || !stop || !baseArg) {
  console.error("usage: node scripts/s21b-probe.mjs <out.csv> <stop file> <base> [max seconds]");
  process.exit(2);
}
const base = baseArg.replace(/\/$/, "");
const end = Date.now() + Number(maxArg ?? 7200) * 1000;
fs.writeFileSync(out, "at,ms,status\n");
while (Date.now() < end && !fs.existsSync(stop)) {
  const t0 = Date.now();
  let status = "error";
  try {
    const r = await fetch(`${base}/icon.svg?probe=${t0}`, { signal: AbortSignal.timeout(20_000), cache: "no-store" });
    await r.arrayBuffer();
    status = String(r.status);
  } catch (e) {
    status = e?.name ?? "error";
  }
  fs.appendFileSync(out, `${new Date(t0).toISOString()},${Date.now() - t0},${status}\n`);
  await new Promise((r) => setTimeout(r, Math.max(0, 2000 - (Date.now() - t0))));
}
