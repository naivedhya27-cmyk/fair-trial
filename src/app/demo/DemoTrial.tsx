"use client";
// The demo trial (S18): a whole trial, run-in to certificate, in about a minute, so anyone can see every check-in
// without waiting 12 weeks. The person doesn't exist (a face made with YouCam's AI Image Generator); the trial starts
// from YouCam's skin analysis of that face, and every photo after it is simulated (R/s18_demo.R, public/demo/demo.json)
// for the outcome chosen here. The trial screen, the verdict engine and the certificate are the app's own, fed from
// memory: nothing is read from or saved to the phone's trial, no photo is analysed and no unit is spent. Every view
// carries the "Demo" label, on screen and on paper.
import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import Dashboard from "@/app/trial/Dashboard";
import Certificate from "@/app/trial/certificate/Certificate";
import { fmtDay } from "@/components/DayChart";
import { IconBack, IconNext, IconPause, IconPlay } from "@/components/icons";
import { btn, Card, Choice, Screen } from "@/components/ui";
import type { CaptureStats } from "@/lib/gate/capture";
import { guard, type ProductType } from "@/lib/guard/guard";
import type { Side } from "@/lib/metrics/halfface";
import { FAMILY_NAME } from "@/lib/planner/inci";
import { plan, type Concern } from "@/lib/planner/plan";
import { RUN_IN_DAYS } from "@/lib/trial/design";
import { runIn, settle, SIDE_WORDS, visitStates, type PhotoRecord, type StoredVerdict, type Trial } from "@/lib/trial/model";
import { GOAL_WORDS } from "@/lib/trial/words";
import type { FaceGeometry } from "@/lib/vision/geometry";

/** How long the player stays on each stop: 11 stops at most, so a whole trial plays in under a minute. */
const STEP_MS = 5000;
const PURPOSE = { safety: "safety look", first_look: "first look", verdict: "verdict" } as const;

interface DemoPhoto {
  day: string;
  time: string;
  raw: number;
  density: Record<Side, number>;
}
interface DemoOutcome {
  id: string;
  label: string;
  about: string;
  photos: DemoPhoto[];
}
interface DemoData {
  version: number;
  person: { name: string; age: number; photo: string; alt: string };
  product: { name: string; type: ProductType; ingredients: string };
  goal: Concern;
  side: Side;
  outcomes: DemoOutcome[];
}
interface Stop {
  day: string;
  label: string;
  trial: Trial;
  photos: PhotoRecord[];
  now: number;
  fresh: StoredVerdict[];
}

/** The trial the app would build from these answers (as "Start a trial" does), with the side already drawn. */
function trialOf(d: DemoData): Trial {
  const p = plan(d.product.ingredients, d.goal);
  const g = guard(
    { age: d.person.age, pregnancy: "no", redFlags: false, underCare: false, prescription: false, medicineProduct: false },
    { name: d.product.name, type: d.product.type, ingredients: d.product.ingredients },
  );
  return {
    id: "demo",
    createdAt: new Date(`${d.outcomes[0].photos[0].day}T08:00:00`).getTime(),
    productName: d.product.name,
    actives: [...new Set(p.actives.map((a) => FAMILY_NAME[a.family]))],
    plan: p,
    goal: p.goal ?? d.goal,
    concerns: [p.goal ?? d.goal, ...p.goals.filter((c) => c !== p.goal)].slice(0, 4),
    side: d.side,
    guard: { action: g.action === "warn" ? "warn" : "proceed", rules: g.findings.map((f) => f.rule) },
    baseline: null,
    stopped: null,
    verdicts: [],
  };
}

/** A simulated photo kept the way the app keeps an analysed one. There is no image behind it, so it has no capture
 * statistics or face geometry; nothing on the trial screen or the certificate reads them. */
const recordOf = (d: DemoData, p: DemoPhoto, i: number): PhotoRecord => ({
  id: `demo-${i}`,
  trialId: "demo",
  day: p.day,
  takenAt: new Date(`${p.day}T${p.time}:00`).getTime(),
  blob: new Blob(),
  stats: null as unknown as CaptureStats,
  face: null as unknown as FaceGeometry,
  status: "done",
  result: { raw: { [d.goal]: p.raw }, density: { [d.goal]: p.density } },
});

/** Every stop of the demo (each run-in day, the first day of the product, each check-in day) with the trial as it
 * stands that evening: verdicts settle stop by stop, exactly as they would on the phone. */
function stopsOf(d: DemoData, o: DemoOutcome): Stop[] {
  const base = trialOf(d);
  const photos = o.photos.map((p, i) => recordOf(d, p, i));
  const r = runIn(photos);
  const days = r.days.map((day, i) => ({ day, label: `Run-in, day ${i + 1} of ${RUN_IN_DAYS}` }));
  if (r.complete) {
    days.push({ day: r.startDay!, label: "First day of the product" });
    for (const v of visitStates(base, photos, r.startDay!)) v.photoDays.forEach((day, j) => days.push({ day, label: `Week ${v.week} ${PURPOSE[v.purpose]}, day ${j + 1} of ${v.days}` }));
  }
  let t = base;
  return days.map(({ day, label }) => {
    const shown = photos.filter((p) => p.day <= day);
    const now = new Date(`${day}T20:00:00`).getTime();
    const s = settle(t, shown, now);
    t = s.trial;
    return { day, label, trial: t, photos: shown, now, fresh: s.fresh };
  });
}

/** The label on every view of the demo, on screen and on paper. */
function DemoLabel({ person }: { person: string }) {
  return (
    <div id="demo-label" className="flex items-center gap-3 rounded-2xl border-2 border-dashed border-warn bg-warn-soft px-4 py-3">
      <span className="shrink-0 rounded-full border-2 border-warn px-2.5 py-0.5 text-sm font-bold text-warn">Demo</span>
      <p className="text-sm leading-snug text-ink">{person} isn&apos;t a real person, and the photos are simulated.</p>
    </div>
  );
}

type View = "intro" | "trial" | "certificate";

export default function DemoTrial() {
  const [data, setData] = useState<DemoData | "error" | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [view, setView] = useState<View>("intro");
  const [at, setAt] = useState(0);
  const [playing, setPlaying] = useState(false);
  // after the first view, each new view's title takes focus, so the keyboard and a screen reader start from its top
  const [moved, setMoved] = useState(false);

  useEffect(() => {
    let live = true;
    fetch("/demo/demo.json")
      .then((r) => {
        if (!r.ok) throw new Error(`demo data: ${r.status}`);
        return r.json() as Promise<DemoData>;
      })
      .then((d) => live && setData(d))
      .catch(() => live && setData("error"));
    return () => {
      live = false;
    };
  }, []);

  const d = data && data !== "error" ? data : null;
  const chosen = d ? (d.outcomes.find((o) => o.id === outcome) ?? d.outcomes[0]) : null;
  const stops = useMemo(() => (d && chosen ? stopsOf(d, chosen) : []), [d, chosen]);
  const last = stops.length - 1;

  // Play moves on one stop at a time and stops at the last; moving by hand pauses it. It never moves focus.
  useEffect(() => {
    if (!playing || view !== "trial") return;
    const id = setTimeout(() => {
      const next = Math.min(at + 1, last);
      setAt(next);
      if (next >= last) setPlaying(false);
    }, STEP_MS);
    return () => clearTimeout(id);
  }, [playing, view, at, last]);

  useEffect(() => {
    document.title = `${view === "certificate" ? "Demo certificate" : "Demo trial"} · Fair Trial`;
  }, [view]);

  if (!d || !chosen || stops.length === 0)
    return (
      <Screen title="Demo trial" back={{ href: "/", label: "Home" }}>
        <p className="text-base leading-relaxed text-muted">{data === "error" ? "The demo couldn't load. Check the connection and reload the page." : "Loading the demo…"}</p>
      </Screen>
    );

  const go = (v: View) => {
    setMoved(true);
    setView(v);
  };
  const start = (play: boolean) => {
    setAt(0);
    setPlaying(play);
    go("trial");
  };
  const back = () => {
    setPlaying(false);
    if (at === 0) go("intro");
    else setAt(at - 1);
  };
  const next = () => {
    setPlaying(false);
    if (at >= last) go("certificate");
    else setAt(at + 1);
  };
  const toggle = () => {
    if (playing) return setPlaying(false);
    if (at >= last) setAt(0);
    setPlaying(true);
  };

  const label = <DemoLabel person={d.person.name} />;
  const stop = stops[Math.min(at, last)];
  const base = stops[0].trial;
  const goal = GOAL_WORDS[base.goal] ?? base.goal;

  if (view === "certificate")
    return <Certificate demo={{ trial: stops[last].trial, photos: stops[last].photos, person: d.person.name, banner: label, back: { onClick: () => go("trial"), label: "Demo trial" } }} />;

  if (view === "trial") {
    const player = (
      <section aria-label="Demo player" className="flex flex-col gap-3 rounded-3xl border border-line bg-surface-2 p-4">
        <div className="flex items-baseline justify-between gap-3">
          <p id="demo-stop" aria-live="polite" data-at={at} data-of={stops.length} data-day={stop.day} className="text-base font-semibold leading-snug">
            {stop.label} <span className="mt-0.5 block text-sm font-normal text-muted">{fmtDay(stop.day)}</span>
          </p>
          <p className="shrink-0 text-sm text-muted">
            {at + 1} of {stops.length}
          </p>
        </div>
        <div aria-hidden="true" className="flex gap-1">
          {stops.map((s, i) => (
            <span key={s.day} className={`h-1.5 flex-1 rounded-full ${i <= at ? "bg-accent" : "bg-line"}`} />
          ))}
        </div>
        <button type="button" id="demo-play" className={btn.primary} onClick={toggle}>
          {playing ? <IconPause size={20} /> : <IconPlay size={20} />}
          {playing ? "Pause" : at >= last ? "Play again" : "Play"}
        </button>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" id="demo-back" className={btn.secondary} onClick={back}>
            <IconBack size={18} />
            Back
          </button>
          <button type="button" id="demo-next" className={btn.secondary} onClick={next}>
            Next
            <IconNext size={18} />
          </button>
        </div>
      </section>
    );
    return (
      <Dashboard
        demo={{
          trial: stop.trial,
          photos: stop.photos,
          now: stop.now,
          fresh: stop.fresh,
          banner: label,
          player,
          back: {
            onClick: () => {
              setPlaying(false);
              go("intro");
            },
            label: "Demo start",
          },
          onCertificate: () => {
            setPlaying(false);
            go("certificate");
          },
          autoFocus: true,
        }}
      />
    );
  }

  const weeks = base.plan.visits.map((v) => v.week);
  const weekList = weeks.length === 1 ? `week ${weeks[0]}` : `weeks ${weeks.slice(0, -1).join(", ")} and ${weeks.at(-1)}`;
  return (
    <Screen title="Demo trial" back={{ href: "/", label: "Home" }} banner={label} autoFocus={moved}>
      <p className="text-base leading-relaxed text-muted">
        A whole trial, from the run-in to the certificate, in about a minute. You pick what the product really does; Fair Trial isn&apos;t told, and has to find it out from the photos.
      </p>
      <Card label="The person">
        <figure className="flex items-start gap-4">
          <Image src={d.person.photo} alt={d.person.alt} width={480} height={640} unoptimized className="h-auto w-28 shrink-0 rounded-2xl border border-line" />
          <figcaption className="text-base leading-relaxed">
            <strong>
              {d.person.name}, {d.person.age}
            </strong>
            , isn&apos;t a real person: the face was made with YouCam&apos;s AI Image Generator. The trial starts from YouCam&apos;s skin analysis of this face; the photos after that are simulated.
          </figcaption>
        </figure>
      </Card>
      <Card label="The product">
        <h2 className="text-lg font-semibold">{base.productName}</h2>
        <p className="text-base leading-relaxed">Actives Fair Trial found in its ingredient list: {base.actives.join(", ") || "none from the evidence table"}.</p>
        <p className="text-base leading-relaxed">
          The plan tests <strong>{goal}</strong>: a <span className="whitespace-nowrap">{RUN_IN_DAYS}-day</span> run-in, then check-ins at {weekList}, when the evidence says a change can show. The
          product goes on the <strong>{SIDE_WORDS[base.side]}</strong> side only.
        </p>
      </Card>
      <Choice name="outcome" legend={`What does ${base.productName} really do?`} options={d.outcomes.map((o) => ({ value: o.id, label: o.label }))} value={chosen.id} onChange={(v) => setOutcome(v)} />
      <p id="outcome-about" className="-mt-2 text-sm leading-relaxed text-muted">
        {chosen.about}
      </p>
      <button type="button" id="demo-start" className={btn.primary} onClick={() => start(true)}>
        <IconPlay size={20} />
        Play the trial
      </button>
      <button type="button" id="demo-steps" className={btn.secondary} onClick={() => start(false)}>
        Step through it myself
      </button>
      <Link href="/trial/new" id="demo-real" className={btn.quiet}>
        Start a real trial on your own face
      </Link>
    </Screen>
  );
}
