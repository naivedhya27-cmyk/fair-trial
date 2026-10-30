"use client";
// Judge access (S21). Judges open /judges#<code> from the entry's testing instructions. The code travels in the address's
// fragment, which browsers never send to a server; this page takes it out of the address at once, asks /api/status
// whether it is right, and keeps it on this browser only when it is (src/lib/judge.ts). Live analysis then uses the
// units kept for judging; nothing else changes.
import Link from "next/link";
import { useEffect, useState } from "react";
import { btn, Notice, Screen } from "@/components/ui";
import { CODE_SHAPE, forgetJudgeCode, judgeCode, judgeHeaders, keepJudgeCode } from "@/lib/judge";

type State = "checking" | "on" | "invalid" | "none" | "off" | "unreachable";

const WORDS: Record<State, string> = {
  checking: "Checking the judge link…",
  on: "Judge access is on for this browser. Live analysis here can use the YouCam units kept for judging; everything else works as it does for anyone.",
  invalid: "This judge link isn't valid, so nothing was kept. Fair Trial and its demo still work; live analysis just stops sooner without judge access.",
  none: "Open the judge link from the entry's testing instructions on this browser to turn judge access on.",
  off: "Judge access is off for this browser.",
  unreachable: "The judge link couldn't be checked. Check your connection, then open the link again.",
};

export default function JudgeAccess() {
  const [state, setState] = useState<State>("checking");

  useEffect(() => {
    let live = true;
    const hash = window.location.hash.slice(1);
    // the code leaves the address at once, so it is not in the history, a bookmark or a shared screen
    if (window.location.hash) history.replaceState(null, "", window.location.pathname);
    const fromLink = hash ? (CODE_SHAPE.test(hash) ? hash : "") : null; // null: no code in the link; "": not a code
    const code = fromLink === null ? judgeCode() : fromLink || null;
    const check: Promise<{ judge?: boolean }> = code ? fetch("/api/status", { headers: judgeHeaders(code), cache: "no-store" }).then((r) => r.json()) : Promise.resolve({ judge: false });
    check.then(
      (s) => {
        if (!live) return;
        if (code && s.judge === true) {
          keepJudgeCode(code);
          setState("on");
        } else if (fromLink !== null) {
          setState("invalid");
        } else {
          if (code) forgetJudgeCode();
          setState("none");
        }
      },
      () => live && setState("unreachable"),
    );
    return () => {
      live = false;
    };
  }, []);

  return (
    <Screen title="Judge access" back={{ href: "/", label: "Home" }}>
      <Notice tone={state === "on" ? "good" : state === "invalid" || state === "unreachable" ? "warn" : "info"}>
        <p className="text-base leading-relaxed" id="judge-state" data-state={state} role="status">
          {WORDS[state]}
        </p>
      </Notice>
      {state === "on" && (
        <>
          <Link href="/trial/new" id="judge-start" className={btn.primary}>
            Start a trial
          </Link>
          <Link href="/demo" className={btn.secondary}>
            See a whole trial in the demo
          </Link>
          <button
            type="button"
            id="judge-off"
            className={btn.quiet}
            onClick={() => {
              forgetJudgeCode();
              setState("off");
            }}
          >
            Turn judge access off
          </button>
        </>
      )}
      {state !== "on" && state !== "checking" && (
        <Link href="/demo" className={btn.secondary}>
          See a whole trial in the demo
        </Link>
      )}
    </Screen>
  );
}
