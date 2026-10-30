// Start a Skin Analysis: the photo passes straight through to YouCam's File API and is not stored here.
// POST multipart/form-data: photo (JPEG or PNG, up to 4 MB), concerns (comma-separated, 1-4 of the concerns a trial
// can measure per half-face, so units are spent only on measurements a verdict can use).
import { NextResponse } from "next/server";
import { MEASURABLE } from "@/lib/planner/plan";
import { isJudge } from "@/lib/youcam/judge";
import { dailyLimit, judgeDailyLimit, refund, take, visitor } from "@/lib/youcam/limit";
import { ensureUnits, publicFloor, startAnalysis, UnitsLow, unitFloor, uploadPhoto } from "@/lib/youcam/server";
import { sdUnits } from "@/lib/youcam/types";

export const maxDuration = 60;

const MAX_BYTES = 4 * 1024 * 1024;
const ALLOWED = MEASURABLE;
const fail = (status: number, error: string) => NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail(400, "send the photo as multipart form data");
  }
  const photo = form.get("photo");
  if (!(photo instanceof File)) return fail(400, "no photo");
  if (photo.type !== "image/jpeg" && photo.type !== "image/png") return fail(415, "the photo must be a JPEG or PNG");
  if (photo.size > MAX_BYTES) return fail(413, "the photo is larger than 4 MB");
  if (photo.size < 10_000) return fail(400, "the photo is too small");
  const concerns = String(form.get("concerns") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!concerns.length || concerns.length > 4 || new Set(concerns).size !== concerns.length || !concerns.every((c) => ALLOWED.has(c)))
    return fail(400, "ask for 1 to 4 different concerns that a trial can measure");

  // with the judges' code (S21), the judges' floor and limit; without it, the public ones
  const judge = isJudge(req);
  const who = visitor(req);
  if (!take(who, judge ? judgeDailyLimit() : dailyLimit())) return fail(429, "today's live analyses from this device are used up; the demo trial still works");
  const units = sdUnits(concerns.length);
  try {
    await ensureUnits(units, judge ? unitFloor() : publicFloor());
  } catch (e) {
    refund(who);
    if (e instanceof UnitsLow) return fail(503, "live analysis is paused to keep units for the judges; the demo trial still works");
    return fail(502, "YouCam could not be reached");
  }
  try {
    const bytes = new Uint8Array(await photo.arrayBuffer());
    const fileId = await uploadPhoto(bytes, photo.type as "image/jpeg" | "image/png", photo.type === "image/png" ? "capture.png" : "capture.jpg");
    const task = await startAnalysis(fileId, concerns);
    return NextResponse.json({ taskId: task.taskId, units: task.units, concerns }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    refund(who);
    return fail(502, "YouCam did not accept the photo; please try again");
  }
}
