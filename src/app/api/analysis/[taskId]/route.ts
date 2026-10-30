// Poll a Skin Analysis. On success returns each concern's raw score (the only score used as a measurement) and the
// mask address, to be fetched through /api/mask; the vendor's display scores are not passed on.
import { connection, NextResponse } from "next/server";
import { parseAnalysis } from "@/lib/youcam/parse";
import { analysisState } from "@/lib/youcam/server";

export const maxDuration = 30;

export async function GET(_req: Request, ctx: { params: Promise<{ taskId: string }> }) {
  await connection();
  const { taskId } = await ctx.params;
  const headers = { "Cache-Control": "no-store" };
  if (!/^[A-Za-z0-9_\-=+/]{8,200}$/.test(taskId)) return NextResponse.json({ state: "error", error: "bad task id" }, { status: 400, headers });
  try {
    const s = await analysisState(taskId);
    if (s.state !== "success") return NextResponse.json(s, { headers });
    const parsed = parseAnalysis(s.output);
    const concerns = Object.fromEntries(Object.entries(parsed.concerns).map(([k, v]) => [k, { raw: v!.raw, mask: v!.maskUrl ?? null }]));
    return NextResponse.json({ state: "success", concerns, image: parsed.resizeImageUrl ?? null }, { headers });
  } catch {
    return NextResponse.json({ state: "error", error: "YouCam could not be reached" }, { status: 502, headers });
  }
}
