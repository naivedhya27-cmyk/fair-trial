"use client";
// The trial certificate (S16, set as a document in S17): one printable page saying what was tested, how, what the photos
// showed (with the numbers), the evidence behind the plan and the limits of the result. No photo appears on it. The demo
// (S18) shows the same certificate for its simulated trial, saying so in its title, its label and its words.
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { changeWords, DayChart, fmtDay, plural } from "@/components/DayChart";
import { IconCalendar, IconCamera, IconCheck, IconInfo, IconPrint, Mark } from "@/components/icons";
import { btn, Card, Screen } from "@/components/ui";
import { EffectBar, SideFace, ToneMark, VERDICT_LOOK } from "@/components/verdict";
import power from "@/data/power.json";
import { EVIDENCE } from "@/lib/planner/plan";
import { dayOf, runIn, SIDE_WORDS, visitStates, type PhotoRecord, type Trial } from "@/lib/trial/model";
import { currentTrial, photosOf } from "@/lib/trial/store";
import { GOAL_WORDS, STOP_WORDS, VERDICT_WORDS } from "@/lib/trial/words";

const ROW = new Map(EVIDENCE.map((r) => [r.id, r]));
const RECOVERED = new Map(power.map((p) => [p.concern, p.recovered]));
const PURPOSE = { safety: "safety look", first_look: "first look", verdict: "verdict" } as const;
const eyebrow = "text-sm font-semibold uppercase tracking-wide text-muted";

/** The certificate of the demo's simulated trial (S18), fed from memory. */
export interface DemoCertificate {
  trial: Trial;
  photos: PhotoRecord[];
  /** the made-up person's name */
  person: string;
  /** the demo's label, at the top and on paper */
  banner: ReactNode;
  back: { onClick: () => void; label: string };
}

export default function Certificate({ demo }: { demo?: DemoCertificate }) {
  const [stored, setState] = useState<{ trial: Trial | null; photos: PhotoRecord[]; made: number } | null>(null);
  const isDemo = demo !== undefined;
  useEffect(() => {
    if (isDemo) return;
    let live = true;
    (async () => {
      const trial = await currentTrial();
      const photos = trial ? await photosOf(trial.id) : [];
      if (live) setState({ trial, photos, made: Date.now() });
    })();
    return () => {
      live = false;
    };
  }, [isDemo]);

  const state = demo ? { trial: demo.trial, photos: demo.photos, made: 0 } : stored;
  if (!state)
    return (
      <Screen title="Trial certificate">
        <p className="text-base text-muted">Loading…</p>
      </Screen>
    );
  const { trial, photos, made } = state;
  const last = trial ? (trial.verdicts.find((v) => v.purpose === "verdict") ?? (trial.stopped ? trial.verdicts.at(-1) : undefined)) : undefined;
  if (!trial || !last)
    return (
      <Screen title="No certificate yet" back={{ href: "/trial", label: "Your trial" }}>
        <p className="text-base leading-relaxed text-muted">The certificate is ready once your trial has its verdict.</p>
        <Link href="/trial" className={btn.primary}>
          Back to your trial
        </Link>
      </Screen>
    );

  const goal = GOAL_WORDS[trial.goal] ?? trial.goal;
  const side = SIDE_WORDS[trial.side];
  const r = runIn(photos);
  const visits = r.startDay ? visitStates(trial, photos, r.startDay) : [];
  const res = last.result;
  const words = VERDICT_WORDS[res.verdict];
  const look = VERDICT_LOOK[res.verdict];
  const weeks = { verdict: trial.plan.verdictWeek ?? 0, adjust: trial.plan.adjustToWeek };
  const recovered = RECOVERED.get(trial.goal);
  const analysed = photos.filter((p) => p.status === "done").length;
  const ended = trial.stopped?.at ?? last.at;
  const numbers = Number.isFinite(res.improvement) && Number.isFinite(res.se);
  const stats: [string, string, string | undefined][] = [
    ["Product side against bare side", Number.isFinite(res.improvement) ? changeWords(res.improvement) : "not measurable", "certificate-improvement"],
    ["Give or take (standard error)", Number.isFinite(res.se) ? `${res.se.toFixed(1)} points` : "not measurable", undefined],
    ["Test statistic", Number.isFinite(res.t) ? `t = ${res.t.toFixed(2)}, ${plural(res.df, "degree", "degrees")} of freedom` : "not measurable", undefined],
    ["Smallest change this trial could pick up", Number.isFinite(res.mde) ? `${res.mde.toFixed(1)} points` : "not measurable", undefined],
  ];

  return (
    <Screen title={demo ? "Demo certificate" : "Trial certificate"} back={demo ? demo.back : { href: "/trial", label: "Your trial" }} banner={demo?.banner} autoFocus={isDemo}>
      <header className="flex items-start gap-4 border-b border-line pb-5">
        <SideFace side={trial.side} className="h-14 w-12" />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-2xl font-semibold leading-tight tracking-tight">{trial.productName}</p>
          <p className="text-base leading-relaxed text-muted">
            {demo
              ? `A demo trial: ${demo.person} doesn't exist and the photos are simulated. Simulated dates ${fmtDay(dayOf(trial.createdAt))} to ${fmtDay(dayOf(ended))}.`
              : `Tested by one person on their own face with Fair Trial, from ${fmtDay(dayOf(trial.createdAt))} to ${fmtDay(dayOf(ended))}.`}
          </p>
        </div>
      </header>

      <Card label="Verdict" tone={look.tone}>
        <div className="flex items-center gap-3">
          <ToneMark tone={look.tone} Icon={look.Icon} big />
          <div className="flex flex-col">
            <h2 className={eyebrow}>
              Week {last.week} {PURPOSE[last.purpose]}
            </h2>
            <p className="text-2xl font-semibold leading-tight" id="certificate-verdict" data-verdict={res.verdict}>
              {words.title}
            </p>
          </div>
        </div>
        <p className="text-base leading-relaxed">{words.body(weeks)}</p>
        {trial.stopped && <p className="text-base leading-relaxed">{STOP_WORDS[trial.stopped.reason]}</p>}
        {numbers && <EffectBar improvement={res.improvement} se={res.se} />}
        <dl className="flex flex-col">
          {stats.map(([k, v, id]) => (
            <div key={k} className="flex flex-col gap-0.5 border-t border-line py-2.5 last:pb-0">
              <dt className="text-sm text-muted">{k}</dt>
              <dd className="text-base font-semibold" id={id} data-value={id ? res.improvement : undefined}>
                {v}
              </dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card label="What was tested">
        <h2 className="text-lg font-semibold">What was tested</h2>
        <p className="text-base leading-relaxed">
          Question: does {trial.productName} change <strong>{goal}</strong> on this person&apos;s face?
        </p>
        <p className="text-base leading-relaxed">
          Actives found in the ingredient list: {trial.actives.length ? trial.actives.join(", ") : "none from the evidence table, so it was tested as a moisturiser"}.
        </p>
      </Card>

      <Card label="How">
        <h2 className="text-lg font-semibold">How it was tested</h2>
        <ul className="flex flex-col gap-3">
          <li className="flex gap-3 text-base leading-relaxed">
            <IconCheck size={18} className="mt-1 shrink-0 text-accent" />
            <span>
              {demo ? (
                <>
                  Split face: the <strong>{side}</strong> side was drawn at random when the demo was made. The product went on that side only; the other side stayed bare as the comparison.
                </>
              ) : (
                <>
                  Split face: the phone drew the <strong>{side}</strong> side at random before the first photo. The product went on that side only; the other side stayed bare as the comparison.
                </>
              )}
            </span>
          </li>
          <li className="flex gap-3 text-base leading-relaxed">
            <IconCalendar size={18} className="mt-1 shrink-0 text-accent" />
            <span>
              Run-in: {plural(r.days.length, "day", "days")} of photos with no product
              {r.days.length ? ` (${r.days.map(fmtDay).join(", ")})` : ""}, to measure this person&apos;s own day-to-day noise.
            </span>
          </li>
          {visits.map((v) => (
            <li key={v.week} className="flex gap-3 text-base leading-relaxed">
              <IconCalendar size={18} className="mt-1 shrink-0 text-accent" />
              <span>
                Week {v.week}, {PURPOSE[v.purpose]}: {v.photoDays.length ? v.photoDays.map(fmtDay).join(", ") : "no photos"}.
              </span>
            </li>
          ))}
          <li className="flex gap-3 text-base leading-relaxed">
            <IconCamera size={18} className="mt-1 shrink-0 text-accent" />
            <span>
              {demo ? (
                <>
                  {plural(photos.length, "simulated photo", "simulated photos")}, two a day. They start from YouCam&apos;s skin analysis of {demo.person}&apos;s photo, with {goal} measured on each
                  half of the face; after that come day-to-day changes of the size Fair Trial measured on real photos, plus the product effect picked for this demo.
                </>
              ) : (
                <>
                  {plural(photos.length, "photo", "photos")}, two a day a minute apart, each passed the same capture check (position, light, colour and sharpness matched to the first photo);{" "}
                  {analysed} analysed by YouCam&apos;s skin analysis, with {goal} measured on each half of the face separately.
                </>
              )}
            </span>
          </li>
          <li className="flex gap-3 text-base leading-relaxed">
            <IconInfo size={18} className="mt-1 shrink-0 text-accent" />
            <span>The verdict compares the change on the product side with the change on the bare side, against this person&apos;s own noise, at the week the evidence names.</span>
          </li>
        </ul>
      </Card>

      <DayChart trial={trial} photos={photos} numbers="open" />

      {trial.verdicts.length > 1 && (
        <Card label="Every check-in">
          <h2 className="text-lg font-semibold">Every check-in</h2>
          <ul className="flex flex-col gap-3">
            {trial.verdicts.map((v) => {
              const vl = VERDICT_LOOK[v.result.verdict];
              return (
                <li key={v.week} className="flex items-start gap-3 text-base leading-relaxed">
                  <ToneMark tone={vl.tone} Icon={vl.Icon} />
                  <span className="pt-1.5">
                    <strong>
                      Week {v.week}, {PURPOSE[v.purpose]}: {VERDICT_WORDS[v.result.verdict].title}
                    </strong>
                    {Number.isFinite(v.result.improvement) && Number.isFinite(v.result.se) ? `, ${changeWords(v.result.improvement)}, give or take ${v.result.se.toFixed(1)}` : ""}.
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <Card label="Evidence">
        <h2 className="text-lg font-semibold">The evidence behind the plan</h2>
        <ul className="flex flex-col gap-2 text-sm leading-relaxed">
          {trial.plan.rows.map((id) => {
            const row = ROW.get(id);
            if (!row) return null;
            return (
              <li key={id}>
                <strong>{row.active}</strong>: first look at week {row.firstLookWeek}, verdict at week {row.verdictWeek}. PubMed{" "}
                {row.sources.map((s, i) => (
                  <span key={s}>
                    <span className="whitespace-nowrap">
                      <a className="inline-block py-1 font-medium text-accent underline underline-offset-2" href={`https://pubmed.ncbi.nlm.nih.gov/${s}/`} target="_blank" rel="noreferrer">
                        {s}
                        <span className="sr-only"> (opens in a new tab)</span>
                      </a>
                      {i < row.sources.length - 1 ? "," : "."}
                    </span>
                    {i < row.sources.length - 1 && " "}
                  </span>
                ))}
              </li>
            );
          })}
        </ul>
      </Card>

      <Card label="Limits">
        <h2 className="text-lg font-semibold">Limits</h2>
        <ul className="flex list-disc flex-col gap-2 pl-5 text-base leading-relaxed marker:text-muted">
          {demo && (
            <li>
              This is a demo. The person, every photo after the first reading and the product&apos;s effect are simulated, so it shows how Fair Trial reaches a verdict, not what any product does.
            </li>
          )}
          <li>One person and one product: the result is about this face, not everyone&apos;s.</li>
          {recovered != null && !demo && (
            <li>
              YouCam reads the whole face, so part of a real change also shows on the bare side. For {goal}, about {Math.round(recovered * 100)}% of a real difference shows up between the halves, so
              this verdict leans cautious.
            </li>
          )}
          {Number.isFinite(res.mde) && <li>A real change smaller than {res.mde.toFixed(1)} points would read as no measurable effect.</li>}
          {!demo && <li>The person knew which side had the product; YouCam&apos;s analysis, which measured both halves, was not told.</li>}
          <li>Fair Trial is not a medical service, and this certificate is not medical advice.</li>
        </ul>
      </Card>

      <footer className="flex items-start gap-3 border-t border-line pt-5">
        <Mark size={24} className="mt-0.5 shrink-0 text-ink" />
        <p className="text-sm leading-relaxed text-muted">
          {demo
            ? "Demo certificate, made by Fair Trial's verdict engine from simulated photos. Not a real result."
            : `Trial ${trial.id}. Made ${fmtDay(dayOf(made))} with Fair Trial, using YouCam's skin analysis. No photo is on this certificate; the photos stay on the phone that took them.`}
        </p>
      </footer>
      <button type="button" id="print" className={`${btn.primary} print:hidden`} onClick={() => window.print()}>
        <IconPrint size={20} />
        Print or save as PDF
      </button>
    </Screen>
  );
}
