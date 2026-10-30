// Whether live analysis is open to the caller: true while the balance is above the caller's floor plus the dearest
// analysis (16 units). Since S21 that floor is the judges' floor for requests carrying the judges' code and the public
// floor for everyone else, and `judge` says whether the code was right. The balance itself is not shown, nor the code.
// The balance is checked at most once a minute per server instance. Both floors and both daily limits are reported
// (none is secret), so the deployment can be checked from outside (R/s21_monitor.R); `floor` and `dailyLimit` are the
// caller's.
import { connection, NextResponse } from "next/server";
import { isJudge } from "@/lib/youcam/judge";
import { dailyLimit, judgeDailyLimit } from "@/lib/youcam/limit";
import { creditBalance, publicFloor, unitFloor } from "@/lib/youcam/server";

let cached: { at: number; balance: number | null } | null = null;

export async function GET(req: Request) {
  await connection();
  if (!cached || Date.now() - cached.at > 60_000) {
    let balance: number | null = null;
    try {
      balance = await creditBalance();
    } catch {
      balance = null;
    }
    cached = { at: Date.now(), balance };
  }
  const judge = isJudge(req);
  const floor = judge ? unitFloor() : publicFloor();
  const live = cached.balance !== null && cached.balance - 16 >= floor;
  return NextResponse.json(
    {
      live,
      judge,
      floor,
      dailyLimit: judge ? judgeDailyLimit() : dailyLimit(),
      floors: { public: publicFloor(), judges: unitFloor() },
      dailyLimits: { public: dailyLimit(), judges: judgeDailyLimit() },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
