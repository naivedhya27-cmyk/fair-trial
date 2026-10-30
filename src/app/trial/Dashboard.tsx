"use client";
// The trial screen (S16, restyled in S17): what to do today, each visit's verdict as soon as its photos are analysed,
// the chart, the schedule, and the controls to stop the trial or delete everything. A verdict that settles while the
// screen is open is also announced to screen readers. The demo (S18) shows this same screen, fed from memory.
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { changeWords, DayChart, fmtDay, plural } from "@/components/DayChart";
import { IconCalendar, IconCamera, IconCheck, IconClock, IconInfo, IconStop } from "@/components/icons";
import { btn, Card, DeleteEverything, Notice, Screen, type Tone } from "@/components/ui";
import { EffectBar, SideFace, ToneMark, VERDICT_LOOK, type IconType } from "@/components/verdict";
import { analysePending } from "@/lib/trial/analyse";
import { dayOf, headroom, HEADROOM, runIn, settle, settled, SIDE_WORDS, today, visitStates, type PhotoRecord, type StoredVerdict, type Today, type Trial } from "@/lib/trial/model";
import { currentTrial, photosOf, saveTrial } from "@/lib/trial/store";
import { GOAL_WORDS, HEADROOM_WORDS, RETRY_WORDS, STOP_WORDS, VERDICT_WORDS } from "@/lib/trial/words";
import { preloadLandmarker } from "@/lib/vision/landmarker";

const PURPOSE = { safety: "safety look", first_look: "first look", verdict: "verdict" } as const;

/** Record the verdict of every visit whose run-in and visit photos are all analysed; a "stop" verdict stops the trial. */
async function settleVerdicts(trial: Trial, photos: PhotoRecord[]): Promise<{ trial: Trial; fresh: StoredVerdict[] }> {
  const s = settle(trial, photos, Date.now());
  if (s.trial !== trial) await saveTrial(s.trial);
  return s;
}

/** What the status region reads out when verdicts settle. */
const newsOf = (fresh: StoredVerdict[]) => fresh.map((v) => `New result. Week ${v.week} ${PURPOSE[v.purpose]}: ${VERDICT_WORDS[v.result.verdict].title}.`).join(" ");

/** The trial screen fed from memory instead of the phone's own trial: the demo (S18). Nothing is read or saved, and the
 * controls that would change a real trial (photos, retry, goal switch, stop, delete) are left out. */
export interface DemoFeed {
  trial: Trial;
  photos: PhotoRecord[];
  now: number;
  /** verdicts that settled at this point of the demo, read out like live ones */
  fresh: StoredVerdict[];
  /** the demo's label, at the top of the screen */
  banner: ReactNode;
  /** the demo's player, under the title */
  player: ReactNode;
  back: { onClick: () => void; label: string };
  onCertificate: () => void;
  /** the title takes focus when the screen opens */
  autoFocus: boolean;
}

type Snapshot = { trial: Trial | null; photos: PhotoRecord[]; now: number; fresh: StoredVerdict[] };

async function read(): Promise<Snapshot> {
  const t = await currentTrial();
  const photos = t ? await photosOf(t.id) : [];
  const s = t ? await settleVerdicts(t, photos) : { trial: null, fresh: [] };
  return { ...s, photos, now: Date.now() };
}

/** How today's task looks: the card's tone and its icon. */
function todayLook(td: Today, isStartDay: boolean, hasVerdict: boolean): { tone: Tone; Icon: IconType } {
  switch (td.kind) {
    case "run_in":
      return td.taken >= td.need ? { tone: "good", Icon: IconCheck } : { tone: "accent", Icon: IconCamera };
    case "run_in_done_today":
      return { tone: "accent", Icon: IconCalendar };
    case "waiting":
      return isStartDay ? { tone: "accent", Icon: IconCalendar } : { tone: "plain", Icon: IconClock };
    case "visit":
      return { tone: "accent", Icon: IconCamera };
    case "visit_day_done":
      return { tone: "good", Icon: IconCheck };
    case "finished":
      return hasVerdict ? { tone: "good", Icon: IconCheck } : { tone: "plain", Icon: IconInfo };
    case "stopped":
      return { tone: "stop", Icon: IconStop };
  }
}

type Status = "done" | "now" | "missed" | "next" | "off";
const STATUS_WORDS: Record<Status, string> = { done: "Done", now: "Now", missed: "Missed", next: "Coming up", off: "Not run" };
const STATUS_DOT: Record<Status, string> = {
  done: "bg-good text-surface",
  now: "bg-accent text-accent-ink",
  missed: "border-2 border-warn bg-warn-soft text-warn",
  next: "border-2 border-line-strong bg-surface",
  off: "border-2 border-line bg-surface-2",
};
const STATUS_TEXT: Record<Status, string> = { done: "text-good", now: "text-accent", missed: "text-warn", next: "text-muted", off: "text-muted" };

/** The trial's stages on one line, each with its state in words as well as colour. */
function Schedule({ items }: { items: { key: string; title: string; text: string; status: Status }[] }) {
  return (
    <ol className="flex flex-col">
      {items.map((it, i) => (
        <li key={it.key} className="relative flex gap-3 pb-4 last:pb-0" aria-current={it.status === "now" ? "step" : undefined}>
          {i < items.length - 1 && <span aria-hidden="true" className={`absolute bottom-0 left-[13px] top-8 w-0.5 rounded-full ${it.status === "done" ? "bg-good" : "bg-line"}`} />}
          <span aria-hidden="true" className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${STATUS_DOT[it.status]}`}>
            {it.status === "done" && <IconCheck size={15} />}
            {it.status === "now" && <span className="h-2 w-2 rounded-full bg-accent-ink" />}
          </span>
          <div className="flex min-w-0 flex-1 flex-col">
            <p className="flex flex-wrap items-baseline gap-x-2 text-base font-semibold">
              <span>{it.title}</span>
              <span className={`text-sm font-medium ${STATUS_TEXT[it.status]}`}>{STATUS_WORDS[it.status]}</span>
            </p>
            <p className="text-sm leading-relaxed text-muted">{it.text}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

export default function Dashboard({ demo }: { demo?: DemoFeed }) {
  const [storedTrial, setTrial] = useState<Trial | null | undefined>(undefined);
  const [storedPhotos, setPhotos] = useState<PhotoRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [readAt, setNow] = useState(0);
  const [readNews, setNews] = useState("");
  // Keyboard focus never drops to the top of the page: it goes to what changed (the stop question, today's task after a
  // stop, the photo count after a retry, the goal after a switch, the empty screen after a delete) and back on "Keep going".
  const [stopMoved, setStopMoved] = useState(false);
  const [gone, setGone] = useState(false);
  const todayRef = useRef<HTMLHeadingElement>(null);
  const photosRef = useRef<HTMLHeadingElement>(null);
  const summaryRef = useRef<HTMLParagraphElement>(null);
  const stopQ = useRef<HTMLParagraphElement>(null);
  const stopBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (stopMoved) (confirmStop ? stopQ.current : stopBtn.current)?.focus();
  }, [confirmStop, stopMoved]);

  const apply = useCallback((s: Snapshot) => {
    setPhotos(s.photos);
    setTrial(s.trial);
    setNow(s.now);
    if (s.fresh.length) setNews(newsOf(s.fresh));
  }, []);
  const load = useCallback(async () => apply(await read()), [apply]);
  const isDemo = demo !== undefined;
  useEffect(() => {
    if (isDemo) return;
    let live = true;
    const refresh = () => read().then((s) => live && apply(s));
    void refresh();
    // a trial page left open (or reopened) on a later day shows that day's task
    const onShow = () => document.visibilityState === "visible" && void refresh();
    const tick = setInterval(refresh, 60_000);
    document.addEventListener("visibilitychange", onShow);
    return () => {
      live = false;
      clearInterval(tick);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [apply, isDemo]);

  const trial = demo ? demo.trial : storedTrial;
  const photos = demo ? demo.photos : storedPhotos;
  const now = demo ? demo.now : readAt;
  const news = demo ? newsOf(demo.fresh) : readNews;
  // on a day that asks for photos, the face finder starts loading here, before the camera opens (S21)
  const photosDue = !demo && !!trial && ["run_in", "visit"].includes(today(trial, photos, now).kind);
  useEffect(() => {
    if (photosDue) preloadLandmarker();
  }, [photosDue]);

  // Present from the first paint, so a verdict that arrives later is read out when its words appear.
  const announcer = (
    <p role="status" className="sr-only">
      {news}
    </p>
  );

  if (trial === undefined)
    return (
      <Screen title="Your trial">
        {announcer}
        <p className="text-base text-muted">Loading your trial…</p>
      </Screen>
    );
  if (trial === null)
    return (
      <Screen title="No trial yet" back={{ href: "/", label: "Home" }} autoFocus={gone}>
        {announcer}
        <p className="text-base leading-relaxed text-muted">Start a trial to test a product on your own face.</p>
        <Link href="/trial/new" id="start-trial" className={btn.primary}>
          Start a trial
        </Link>
      </Screen>
    );

  const td = today(trial, photos, now);
  const r = runIn(photos);
  const hr = headroom(trial, photos);
  const d = dayOf(now);
  const beforeProduct = !r.complete || d < r.startDay!;
  const switchTo = beforeProduct ? trial.concerns.filter((c) => c !== trial.goal && (trial.plan.goals as string[]).includes(c) && headroom({ ...trial, goal: c as Trial["goal"] }, photos).ok) : [];
  const visits = r.complete ? visitStates(trial, photos, r.startDay!) : [];
  const waiting = photos.filter((p) => !settled(p));
  const lastError = [...photos].reverse().find((p) => p.status === "error");
  const final = trial.verdicts.find((v) => v.purpose === "verdict");
  const goal = GOAL_WORDS[trial.goal] ?? trial.goal;
  const side = SIDE_WORDS[trial.side];
  const weeks = { verdict: trial.plan.verdictWeek ?? 0, adjust: trial.plan.adjustToWeek };
  const look = todayLook(td, r.complete && d === r.startDay, !!final);
  const ended = !!trial.stopped || !!final;
  const open = (s: Exclude<Status, "off">): Status => (ended && (s === "now" || s === "next") ? "off" : s);

  const schedule: { key: string; title: string; text: string; status: Status }[] = [
    {
      key: "run-in",
      title: "Run-in, no product",
      text: r.days.length > 0 ? `${r.days.length} of 4 days done: ${r.days.map(fmtDay).join(", ")}.` : "4 days of photos before you start.",
      status: r.complete ? "done" : open("now"),
    },
  ];
  if (r.complete) schedule.push({ key: "start", title: "First day of the product", text: fmtDay(r.startDay!), status: d > r.startDay! ? "done" : d === r.startDay ? open("now") : open("next") });
  for (const v of visits)
    schedule.push({
      key: `week-${v.week}`,
      title: `Week ${v.week} ${PURPOSE[v.purpose]}`,
      text: `${fmtDay(v.due)} to ${fmtDay(v.closes)}: ${v.photoDays.length} of ${plural(v.days, "day", "days")} done.`,
      status: v.complete ? "done" : d > v.closes ? "missed" : d >= v.due ? open("now") : open("next"),
    });
  if (!r.complete)
    for (const v of trial.plan.visits)
      schedule.push({ key: `week-${v.week}`, title: `Week ${v.week} ${PURPOSE[v.purpose]}`, text: `${plural(v.days, "day", "days")} of photos.`, status: open("next") });

  const retry = async () => {
    setBusy(true);
    await analysePending(trial, photos, () => void load());
    await load();
    setBusy(false);
    photosRef.current?.focus();
  };
  const stopTrial = async (reason: "user" | "headroom") => {
    await saveTrial({ ...trial, stopped: { at: Date.now(), reason } });
    setStopMoved(false);
    setConfirmStop(false);
    await load();
    todayRef.current?.focus();
  };
  const askStop = (v: boolean) => {
    setStopMoved(true);
    setConfirmStop(v);
  };
  const switchGoal = async (c: string) => {
    await saveTrial({ ...trial, goal: c as Trial["goal"], concerns: [c, ...trial.concerns.filter((x) => x !== c)] });
    await load();
    summaryRef.current?.focus();
  };

  return (
    <Screen title={trial.productName} back={demo ? demo.back : { href: "/", label: "Home" }} banner={demo?.banner} autoFocus={demo?.autoFocus}>
      {announcer}
      {demo?.player}
      <div className="flex items-center gap-4 rounded-3xl border border-line bg-surface p-4">
        <SideFace side={trial.side} />
        <p ref={summaryRef} id="trial-summary" tabIndex={-1} className="text-base leading-relaxed">
          Testing <strong id="trial-goal">{goal}</strong>. Product on your <strong>{side}</strong> side only.
        </p>
      </div>

      <Card label="Today" tone={look.tone}>
        <div className="flex items-center gap-3">
          <ToneMark tone={look.tone} Icon={look.Icon} />
          <h2 ref={todayRef} id="today-title" tabIndex={-1} className="text-lg font-semibold">
            Today
          </h2>
        </div>
        <div id="today" data-kind={td.kind} className="flex flex-col gap-3">
          {td.kind === "run_in" &&
            (td.taken >= td.need ? (
              <p className="text-base leading-relaxed">Run-in day {td.day} of 4 is done. Come back tomorrow for the next photos. Don&apos;t use the product yet.</p>
            ) : (
              <>
                <p className="text-base leading-relaxed">
                  Run-in day {td.day} of 4: take {plural(td.need - td.taken, "photo", "photos")}. Don&apos;t use the product yet.
                </p>
                {!demo && (
                  <Link href="/trial/photos" id="take-photos" className={btn.primary}>
                    <IconCamera size={20} />
                    Take today&apos;s photos
                  </Link>
                )}
              </>
            ))}
          {td.kind === "run_in_done_today" && (
            <p className="text-base leading-relaxed">
              The run-in is done. Start the product on your {side} side on <strong>{fmtDay(td.startDay)}</strong>, and use it as the pack says from then on.
            </p>
          )}
          {td.kind === "waiting" &&
            (d === r.startDay ? (
              <p className="text-base leading-relaxed">
                Start today: put the product on your <strong>{side}</strong> side only, as the pack says, and keep the {side === "left" ? "right" : "left"} side bare. Next photos: week {td.next.week},
                from <strong>{fmtDay(td.next.due)}</strong>.
              </p>
            ) : (
              <p className="text-base leading-relaxed">
                Keep using the product on your {side} side only. Next photos: week {td.next.week}, from <strong>{fmtDay(td.next.due)}</strong> ({plural(td.daysToGo, "day", "days")} to go).
              </p>
            ))}
          {td.kind === "visit" && (
            <>
              <p className="text-base leading-relaxed">
                Week {td.visit.week} check-in, day {td.dayIndex} of {td.visit.days}: take {plural(td.need - td.taken, "photo", "photos")}. Keep using the product as usual.
              </p>
              {!demo && (
                <Link href="/trial/photos" id="take-photos" className={btn.primary}>
                  <IconCamera size={20} />
                  Take today&apos;s photos
                </Link>
              )}
            </>
          )}
          {td.kind === "visit_day_done" && (
            <p className="text-base leading-relaxed">
              Today&apos;s photos are in. {td.visit.complete ? `The week ${td.visit.week} check-in is complete.` : "Come back tomorrow for the next day of this check-in."}
            </p>
          )}
          {td.kind === "finished" && (
            <p className="text-base leading-relaxed">{final ? "The trial is finished." : "The verdict check-in closed before all its photos were in, so this trial has no verdict."}</p>
          )}
          {td.kind === "stopped" && <p className="text-base leading-relaxed">{STOP_WORDS[td.reason]}</p>}
        </div>
      </Card>

      {hr.known && !hr.ok && !trial.stopped && (
        <Notice tone="warn" label={HEADROOM_WORDS.title(goal)}>
          <h2 className="text-lg font-semibold">{HEADROOM_WORDS.title(goal)}</h2>
          <p className="text-base leading-relaxed" id="headroom" data-raw={Math.round(hr.raw)}>
            {HEADROOM_WORDS.body(goal, hr.raw, hr.raw >= HEADROOM.maxRaw)}
          </p>
          {!demo && (
            <>
              {switchTo.map((c) => (
                <button key={c} type="button" className={btn.primary} data-goal={c} onClick={() => switchGoal(c)}>
                  Test {GOAL_WORDS[c] ?? c} instead
                </button>
              ))}
              {switchTo.length > 0 && <p className="text-sm leading-relaxed">You haven&apos;t started the product, so changing the question now is fair: the photos so far measure every goal.</p>}
              <button type="button" id="stop-headroom" className={btn.secondary} onClick={() => stopTrial("headroom")}>
                Stop this trial
              </button>
            </>
          )}
        </Notice>
      )}

      {[...trial.verdicts].reverse().map((v) => {
        const vl = VERDICT_LOOK[v.result.verdict];
        const numbers = Number.isFinite(v.result.improvement) && Number.isFinite(v.result.se);
        return (
          <Card key={v.week} label={`Week ${v.week} ${PURPOSE[v.purpose]}`} tone={vl.tone} className="ft-reveal">
            <div className="flex items-center gap-3">
              <ToneMark tone={vl.tone} Icon={vl.Icon} big />
              <div className="flex flex-col">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
                  Week {v.week} {PURPOSE[v.purpose]}
                </h2>
                <p className="text-2xl font-semibold leading-tight" data-verdict={v.result.verdict} data-week={v.week}>
                  {VERDICT_WORDS[v.result.verdict].title}
                </p>
              </div>
            </div>
            <p className="text-base leading-relaxed">{VERDICT_WORDS[v.result.verdict].body(weeks)}</p>
            {numbers && (
              <>
                <EffectBar improvement={v.result.improvement} se={v.result.se} />
                <p className="text-sm leading-relaxed text-muted">
                  Product side against bare side: {changeWords(v.result.improvement)}, give or take {v.result.se.toFixed(1)}.
                  {Number.isFinite(v.result.mde) && ` Smallest change this trial can pick up: ${v.result.mde.toFixed(1)} points.`}
                </p>
              </>
            )}
          </Card>
        );
      })}

      {(final || trial.stopped) &&
        trial.verdicts.length > 0 &&
        (demo ? (
          <button type="button" id="certificate" className={btn.primary} onClick={demo.onCertificate}>
            See the demo certificate
          </button>
        ) : (
          <Link href="/trial/certificate" id="certificate" className={btn.primary}>
            See your trial certificate
          </Link>
        ))}

      <DayChart trial={trial} photos={photos} />

      <Card label="Schedule">
        <h2 className="text-lg font-semibold">Schedule</h2>
        <Schedule items={schedule} />
      </Card>

      <Card label="Photos">
        <h2 ref={photosRef} id="photos-title" tabIndex={-1} className="text-lg font-semibold">
          Photos
        </h2>
        <p className="text-base" id="photo-count" data-total={photos.length} data-waiting={waiting.length}>
          {plural(photos.length, "photo", "photos")} taken, {photos.filter((p) => p.status === "done").length} analysed.
        </p>
        {lastError && waiting.length > 0 && (
          <Notice tone="warn">
            <p className="text-base leading-relaxed" id="analysis-error" data-kind={lastError.errorKind}>
              {lastError.errorKind ? RETRY_WORDS[lastError.errorKind] : lastError.error}
            </p>
          </Notice>
        )}
        {waiting.length > 0 && !demo && (
          <button type="button" id="retry" className={btn.secondary} disabled={busy} onClick={retry}>
            {busy ? "Analysing…" : `Analyse ${plural(waiting.length, "waiting photo", "waiting photos")}`}
          </button>
        )}
      </Card>

      {!demo && (
        <div className="mt-2 flex flex-col gap-3 border-t border-line pt-5">
          {!ended &&
            (confirmStop ? (
              <Notice tone="warn" label="Stop the trial">
                <p ref={stopQ} id="stop-question" tabIndex={-1} className="text-base leading-relaxed">
                  Stop this trial? Your photos and results stay on this phone until you delete them.
                </p>
                <div className="flex flex-col gap-3">
                  <button type="button" id="confirm-stop" className={btn.primary} onClick={() => stopTrial("user")}>
                    Stop it
                  </button>
                  <button type="button" className={btn.secondary} onClick={() => askStop(false)}>
                    Keep going
                  </button>
                </div>
              </Notice>
            ) : (
              <button ref={stopBtn} type="button" id="stop-trial" className={btn.secondary} onClick={() => askStop(true)}>
                Stop the trial
              </button>
            ))}
          <DeleteEverything
            onDone={() => {
              setGone(true);
              void load();
            }}
          />
        </div>
      )}
    </Screen>
  );
}
