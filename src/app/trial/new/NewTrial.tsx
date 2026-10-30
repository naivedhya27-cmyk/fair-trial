"use client";
// Start a trial (S16, restyled in S17): about you, the product, the safety check (src/lib/guard, S13), the plan
// (src/lib/planner, S12), then the side drawn at random. The answers about you are used for the check and not kept;
// only its outcome is. Next is never disabled: it marks what still needs an answer and moves focus to the first one.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { IconAlert, IconCalendar, IconCamera, IconCheck, IconInfo } from "@/components/icons";
import { btn, Card, Choice, field, Missing, Notice, Screen, YesNo } from "@/components/ui";
import { guard, type Action, type GuardResult, type Person, type Pregnancy, type ProductType, type Rule } from "@/lib/guard/guard";
import type { Side } from "@/lib/metrics/halfface";
import { FAMILY_NAME } from "@/lib/planner/inci";
import { EVIDENCE, plan as makePlan, type Concern } from "@/lib/planner/plan";
import { drawSide, newTrial, SIDE_WORDS } from "@/lib/trial/model";
import { saveTrial } from "@/lib/trial/store";
import { GOAL_WORDS, NO_TRIAL_WORDS } from "@/lib/trial/words";
import power from "@/data/power.json";

type Step = "you" | "product" | "check" | "plan" | "side";
type PregnancyAnswer = Pregnancy | "unsaid";

const TYPES: { value: string; label: string; type: ProductType }[] = [
  { value: "cream", label: "Face cream, lotion or gel", type: "face_leave_on" },
  { value: "serum", label: "Serum or face oil", type: "face_leave_on" },
  { value: "toner", label: "Toner, essence or mist", type: "face_leave_on" },
  { value: "cleanser", label: "Face wash or cleanser", type: "face_rinse_off" },
  { value: "remover", label: "Make-up remover", type: "makeup_remover" },
  { value: "makeup", label: "Make-up", type: "makeup" },
  { value: "lip", label: "Lip product", type: "lip" },
  { value: "body", label: "Body product", type: "body" },
  { value: "hair", label: "Hair product", type: "hair" },
  { value: "other", label: "Something else", type: "other" },
];
const ROW = new Map(EVIDENCE.map((r) => [r.id, r]));
/** Rules about the person alone: checked as soon as the first screen is answered, before any product is typed in. */
const PERSON_RULES: ReadonlySet<Rule> = new Set<Rule>(["age_missing", "under_18", "see_doctor", "under_care", "on_prescription"]);
const SEVERITY: Action[] = ["proceed", "warn", "refuse", "refer"];
const RECOVERED = new Map(power.map((p) => [p.concern, p.recovered]));
const STAGES = ["About you", "Your product", "Your plan", "Your side"];
const bar = (at: number, label = STAGES[at - 1]) => ({ at, of: STAGES.length, label });
/** Where focus goes for each question that can be left unanswered. */
const TARGET: Record<string, string> = { age: "#age", "product-name": "#product-name", ingredients: "#ingredients" };
const target = (k: string) => TARGET[k] ?? `input[name="${k}"]`;
const PURPOSE = { safety: "a safety look", first_look: "a first look", verdict: "the verdict" } as const;
/** A goal's words as a choice of its own: "Redness", "Fine lines and wrinkles". */
const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export default function NewTrial() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("you");
  const [age, setAge] = useState("");
  const [pregnancy, setPregnancy] = useState<PregnancyAnswer | null>(null);
  const [redFlags, setRedFlags] = useState<boolean | null>(null);
  const [underCare, setUnderCare] = useState<boolean | null>(null);
  const [prescription, setPrescription] = useState<boolean | null>(null);
  const [name, setName] = useState("");
  const [typeChoice, setTypeChoice] = useState<string | null>(null);
  const [ingredients, setIngredients] = useState("");
  const [medicineProduct, setMedicineProduct] = useState<boolean | null>(null);
  const [goal, setGoal] = useState<Concern | null>(null);
  const [side, setSide] = useState<Side | null>(null);
  const [saving, setSaving] = useState(false);
  const [scope, setScope] = useState<"person" | "all">("all");
  // `moved`: the person has gone past the first screen, so each new step takes focus. `tried`: Next was pressed on
  // this step with questions unanswered. `focusTo`: a fresh object each time, so the same question can be refocused.
  const [moved, setMoved] = useState(false);
  const [tried, setTried] = useState<Step | null>(null);
  const [focusTo, setFocusTo] = useState<{ sel: string } | null>(null);
  const sideRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (focusTo) document.querySelector<HTMLElement>(focusTo.sel)?.focus();
  }, [focusTo]);
  useEffect(() => {
    if (side) sideRef.current?.focus();
  }, [side]);

  const go = (s: Step) => {
    setMoved(true);
    setTried(null);
    setStep(s);
  };
  /** True when every question on this step has an answer; otherwise marks them and focuses the first. */
  const answered = (s: Step, unanswered: Record<string, boolean>) => {
    const first = Object.keys(unanswered).find((k) => unanswered[k]);
    if (!first) return true;
    setTried(s);
    setFocusTo({ sel: target(first) });
    return false;
  };

  const type = TYPES.find((t) => t.value === typeChoice)?.type ?? null;
  const youMissing = { age: age.trim() === "", pregnancy: !pregnancy, redflags: redFlags == null, undercare: underCare == null, prescription: prescription == null };
  const productMissing = { "product-name": name.trim() === "", type: !type, ingredients: ingredients.trim() === "", medicine: medicineProduct == null };
  const person = (): Person => ({
    age: Number.parseInt(age, 10),
    pregnancy: pregnancy === "unsaid" ? null : pregnancy,
    redFlags: !!redFlags,
    underCare: !!underCare,
    prescription: !!prescription,
    medicineProduct: !!medicineProduct,
  });
  const runCheck = () => guard(person(), { name, type, ingredients });
  const personCheck = (): GuardResult => {
    const g = runCheck();
    const findings = g.findings.filter((f) => PERSON_RULES.has(f.rule));
    return { ...g, findings, action: findings.reduce<Action>((a, f) => (SEVERITY.indexOf(f.action) > SEVERITY.indexOf(a) ? f.action : a), "proceed") };
  };
  const check = step === "check" ? (scope === "person" ? personCheck() : runCheck()) : null;
  const p = useMemo(() => (step === "plan" || step === "side" ? makePlan(ingredients, goal) : null), [step, ingredients, goal]);

  if (step === "you") {
    const miss = (k: keyof typeof youMissing) => tried === "you" && youMissing[k];
    return (
      <Screen key="you" title="About you" back={{ href: "/", label: "Back" }} step={bar(1)} autoFocus={moved}>
        <p className="text-base leading-relaxed text-muted">
          A few questions first, so Fair Trial doesn&apos;t start a trial you should ask a doctor or pharmacist about. Your answers aren&apos;t kept.
        </p>
        <div className="flex flex-col gap-2">
          <label htmlFor="age" className="text-base font-semibold">
            Your age
          </label>
          {miss("age") && <Missing id="age-missing" />}
          <input
            id="age"
            inputMode="numeric"
            autoComplete="off"
            value={age}
            aria-invalid={miss("age") || undefined}
            aria-describedby={miss("age") ? "age-missing" : undefined}
            onChange={(e) => setAge(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))}
            className={`${field} max-w-32`}
          />
        </div>
        <Choice
          name="pregnancy"
          legend="Are you pregnant, trying to get pregnant, or breastfeeding?"
          value={pregnancy}
          onChange={setPregnancy}
          missing={miss("pregnancy")}
          options={[
            { value: "no", label: "No" },
            { value: "pregnant", label: "Pregnant" },
            { value: "trying", label: "Trying to get pregnant" },
            { value: "breastfeeding", label: "Breastfeeding" },
            { value: "unsaid", label: "I'd rather not say" },
          ]}
        />
        <YesNo
          name="redflags"
          legend="Is anything on your face worrying you?"
          hint="A spot or mole that is new, changing, bleeding, itchy or not getting better; a deep painful lump; or a spreading rash, swelling, pus or a fever."
          value={redFlags}
          onChange={setRedFlags}
          missing={miss("redflags")}
        />
        <YesNo name="undercare" legend="Is a doctor looking after a skin condition on your face?" value={underCare} onChange={setUnderCare} missing={miss("undercare")} />
        <YesNo name="prescription" legend="Do you use a prescription medicine on your face now?" value={prescription} onChange={setPrescription} missing={miss("prescription")} />
        <button
          type="button"
          id="next"
          className={btn.primary}
          onClick={() => {
            if (!answered("you", youMissing)) return;
            const a = personCheck().action;
            const stop = a === "refuse" || a === "refer";
            setScope(stop ? "person" : "all");
            go(stop ? "check" : "product");
          }}
        >
          Next
        </button>
      </Screen>
    );
  }

  if (step === "product") {
    const miss = (k: keyof typeof productMissing) => tried === "product" && productMissing[k];
    return (
      <Screen key="product" title="Your product" back={{ label: "Back", onClick: () => go("you") }} step={bar(2)} autoFocus={moved}>
        <div className="flex flex-col gap-2">
          <label htmlFor="product-name" className="text-base font-semibold">
            Product name
          </label>
          {miss("product-name") && <Missing id="product-name-missing" />}
          <input
            id="product-name"
            autoComplete="off"
            value={name}
            aria-invalid={miss("product-name") || undefined}
            aria-describedby={miss("product-name") ? "product-name-missing" : undefined}
            onChange={(e) => setName(e.target.value.slice(0, 120))}
            className={field}
          />
        </div>
        <Choice name="type" legend="What kind of product is it?" value={typeChoice} onChange={setTypeChoice} missing={miss("type")} options={TYPES.map(({ value, label }) => ({ value, label }))} />
        <div className="flex flex-col gap-2">
          <label htmlFor="ingredients" className="text-base font-semibold">
            Ingredients
          </label>
          <p id="ingredients-hint" className="text-sm text-muted">
            Type or paste the full list from the back of the pack.
          </p>
          {miss("ingredients") && <Missing id="ingredients-missing" />}
          <textarea
            id="ingredients"
            rows={6}
            value={ingredients}
            aria-invalid={miss("ingredients") || undefined}
            aria-describedby={miss("ingredients") ? "ingredients-hint ingredients-missing" : "ingredients-hint"}
            onChange={(e) => setIngredients(e.target.value.slice(0, 5000))}
            className={`${field} py-3 leading-relaxed`}
          />
        </div>
        <YesNo name="medicine" legend="Did a doctor or pharmacist give you this as a medicine?" value={medicineProduct} onChange={setMedicineProduct} missing={miss("medicine")} />
        <button
          type="button"
          id="next"
          className={btn.primary}
          onClick={() => {
            if (!answered("product", productMissing)) return;
            setScope("all");
            go(runCheck().action === "proceed" ? "plan" : "check");
          }}
        >
          Check it
        </button>
      </Screen>
    );
  }

  if (step === "check" && check) {
    const stop = check.action === "refuse" || check.action === "refer";
    return (
      <Screen
        key="check"
        title={check.action === "refer" ? "Please check with a professional first" : check.action === "refuse" ? "Fair Trial can't test this" : "Before you go on"}
        step={bar(scope === "person" ? 1 : 2, "Safety check")}
        autoFocus={moved}
      >
        <p className="text-base leading-relaxed text-muted">{stop ? "Fair Trial won't start a trial, because:" : "You can go on, but first read this:"}</p>
        {check.findings
          .filter((f) => f.action !== "proceed")
          .map((f) => (
            <Notice key={f.rule} tone={f.action === "warn" ? "warn" : "stop"}>
              <p className="text-base leading-relaxed" data-rule={f.rule}>
                {f.message}
              </p>
            </Notice>
          ))}
        {stop ? (
          <div className="flex flex-col gap-3">
            {scope === "person" ? (
              <button type="button" className={btn.secondary} onClick={() => go("you")}>
                Change my answers
              </button>
            ) : (
              <button type="button" className={btn.secondary} onClick={() => go("product")}>
                Change the product
              </button>
            )}
            <Link href="/" className={btn.secondary}>
              Back to the start
            </Link>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <button type="button" id="next" className={btn.primary} onClick={() => go("plan")}>
              I understand, go on
            </button>
            <button type="button" className={btn.secondary} onClick={() => go("product")}>
              Change the product
            </button>
          </div>
        )}
      </Screen>
    );
  }

  if (step === "plan" && p) {
    if (p.design === "no_trial")
      return (
        <Screen key="no-trial" title="No fair test for this one" back={{ label: "Back", onClick: () => go("product") }} step={bar(3)} autoFocus={moved}>
          <Notice tone="warn">
            <p className="text-base leading-relaxed" data-reason={p.reason}>
              {NO_TRIAL_WORDS[p.reason!]}
            </p>
          </Notice>
          <div className="flex flex-col gap-3">
            <button type="button" className={btn.secondary} onClick={() => go("product")}>
              Try another product
            </button>
            <Link href="/" className={btn.secondary}>
              Back to the start
            </Link>
          </div>
        </Screen>
      );
    const g = p.goal!;
    const recovered = RECOVERED.get(g);
    const clear = runCheck().action === "proceed";
    const early = p.earlyEffects.filter((e) => !/^none/i.test(e));
    const notes = [
      p.power && `If the product makes the smallest change this trial can detect, the trial spots it ${Math.round(p.power.worst)} to ${Math.round(p.power.best)}% of the time.`,
      recovered != null &&
        `YouCam reads the whole face, so part of a real change also shows on the bare side. For ${GOAL_WORDS[g]}, about ${Math.round(recovered * 100)}% of a real difference shows up between the halves, so a verdict here leans cautious.`,
      p.belowOnePercent && "Every active in this product is listed after the 1% point, so it may hold less than the trials used.",
      p.earlyEffects.length > 0 &&
        (early.length > 0
          ? `In trials, some people noticed early on: ${early.join("; ")}. The week-2 look checks for this.`
          : "In trials, no major early side effects were reported. The week-2 look still checks."),
    ].filter((n): n is string => !!n);
    return (
      <Screen key="plan" title="Your trial plan" back={{ label: "Back", onClick: () => go("product") }} step={bar(3)} autoFocus={moved}>
        {clear && (
          <Notice tone="good" label="Safety check">
            <p className="text-base leading-relaxed">Checked: nothing in your answers or this ingredient list rules a trial out.</p>
          </Notice>
        )}
        <p className="text-base leading-relaxed">
          {p.fallback ? (
            "We didn't find any of the actives the evidence covers, so this is tested as a moisturiser."
          ) : (
            <>
              We found <strong>{[...new Set(p.actives.map((a) => FAMILY_NAME[a.family]))].join(", ")}</strong> in the ingredient list.
            </>
          )}
        </p>
        {p.goals.length > 1 && (
          <Choice
            name="goal"
            legend="What do you want to know about?"
            value={g}
            onChange={(v) => setGoal(v as Concern)}
            options={p.goals.map((c) => ({ value: c, label: sentence(GOAL_WORDS[c] ?? c) }))}
          />
        )}
        <Card label="Plan">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">The question</h2>
          <p className="text-lg font-semibold leading-snug">
            Does this product change <span id="goal">{GOAL_WORDS[g]}</span> on your face?
          </p>
          <h2 className="mt-2 text-sm font-semibold uppercase tracking-wide text-muted">The schedule</h2>
          <ol className="flex flex-col">
            <Stage icon={IconCamera} title="Before you start" text="4 days of photos, 2 a day, to measure your own day-to-day noise." last={p.visits.length === 0} />
            {p.visits.map((v, i) => (
              <Stage
                key={v.week}
                icon={v.purpose === "verdict" ? IconCheck : IconCalendar}
                title={`Week ${v.week}`}
                text={`${v.days} ${v.days === 1 ? "day" : "days"} of photos: ${PURPOSE[v.purpose]}.`}
                last={i === p.visits.length - 1}
              />
            ))}
          </ol>
          <p className="text-base font-medium">{p.photos} photos in all.</p>
        </Card>
        {notes.length > 0 && (
          <Card tone="plain" label="Good to know">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Good to know</h2>
            <ul className="flex flex-col gap-3">
              {notes.map((n) => (
                <li key={n} className="flex gap-3 text-base leading-relaxed">
                  <IconInfo size={18} className="mt-1 shrink-0 text-accent" />
                  <span>{n}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
        <details className="rounded-3xl border border-line bg-surface px-5 py-2">
          <summary className="min-h-12 cursor-pointer text-base font-semibold leading-[3rem]">The evidence behind this plan</summary>
          <ul className="mb-3 mt-1 flex flex-col gap-3">
            {p.rows.map((id) => {
              const r = ROW.get(id)!;
              return (
                <li key={id} className="text-sm leading-relaxed">
                  <strong>{r.active}</strong>: first look at week {r.firstLookWeek}, verdict at week {r.verdictWeek}.{" "}
                  {r.sources.map((s, i) => (
                    <span key={s}>
                      <span className="whitespace-nowrap">
                        <a className="inline-block py-1 font-medium text-accent underline underline-offset-2" href={`https://pubmed.ncbi.nlm.nih.gov/${s}/`} target="_blank" rel="noreferrer">
                          PubMed {s}
                          <span className="sr-only"> (opens in a new tab)</span>
                        </a>
                        {i < r.sources.length - 1 && ","}
                      </span>
                      {i < r.sources.length - 1 && " "}
                    </span>
                  ))}
                </li>
              );
            })}
          </ul>
        </details>
        <button type="button" id="next" className={btn.primary} onClick={() => go("side")}>
          This plan works for me
        </button>
      </Screen>
    );
  }

  if (step === "side" && p && p.goal) {
    const start = async () => {
      if (!side) return;
      setSaving(true);
      await saveTrial(newTrial({ id: crypto.randomUUID(), createdAt: Date.now(), person: person(), product: { name, type, ingredients }, plan: p, side }));
      router.push("/trial");
    };
    return (
      <Screen key="side" title="Which half gets the product" back={side ? undefined : { label: "Back", onClick: () => go("plan") }} step={bar(4)} autoFocus={moved}>
        <Card label="How the trial stays fair">
          <ul className="flex flex-col gap-3">
            {[
              "One half of your face gets the product; the other half stays bare and is the comparison.",
              "The half is drawn at random, so neither you nor the app can lean the result.",
              "Keep everything else the same on both halves: cleanser, moisturiser, sunscreen.",
              "Take the photos in the same spot and light each time. The camera checks this for you.",
            ].map((r) => (
              <li key={r} className="flex gap-3 text-base leading-relaxed">
                <IconCheck size={18} className="mt-1 shrink-0 text-accent" />
                <span>{r}</span>
              </li>
            ))}
            <li className="flex gap-3 text-base font-medium leading-relaxed">
              <IconAlert size={18} className="mt-1 shrink-0 text-warn" />
              <span>Stop if the product stings, burns or swells.</span>
            </li>
          </ul>
        </Card>
        {!side ? (
          <button type="button" id="draw-side" className={btn.primary} onClick={() => setSide(drawSide())}>
            Draw my side
          </button>
        ) : (
          <Card tone="accent" label="Your side" className="ft-reveal">
            <p ref={sideRef} tabIndex={-1} className="text-xl font-semibold leading-snug" id="side" data-side={side}>
              Put the product on your <span className="uppercase tracking-wide">{SIDE_WORDS[side]}</span> side only.
            </p>
            <p className="text-base">
              That&apos;s your own {SIDE_WORDS[side]}: the side of your {SIDE_WORDS[side]} hand.
            </p>
            <figure className="flex flex-col items-center gap-2 rounded-2xl bg-surface py-4">
              <FaceHalf side={side} />
              <figcaption className="text-sm text-muted">As in a mirror: the way the camera shows you.</figcaption>
            </figure>
            <p className="text-base">Don&apos;t start yet. First come 4 days of photos without it.</p>
            <button type="button" id="start-run-in" className={btn.primary} disabled={saving} onClick={start}>
              Start the 4-day run-in
            </button>
          </Card>
        )}
      </Screen>
    );
  }
  return null;
}

/** One stage of the plan, on a line joining it to the next. */
function Stage({ icon: Icon, title, text, last }: { icon: ComponentType<{ size?: number }>; title: string; text: string; last: boolean }) {
  return (
    <li className="relative flex gap-3 pb-4 last:pb-0">
      {!last && <span aria-hidden="true" className="absolute bottom-0 left-[19px] top-10 w-0.5 rounded-full bg-line" />}
      <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
        <Icon size={18} />
      </span>
      <div className="flex flex-col pt-1.5">
        <p className="text-base font-semibold">{title}</p>
        <p className="text-base leading-relaxed text-muted">{text}</p>
      </div>
    </li>
  );
}

/** The product half, drawn as you see yourself in a mirror (your left on the left). */
function FaceHalf({ side }: { side: Side }) {
  const left = side === "subject_left";
  return (
    <svg viewBox="0 0 120 150" className="h-40 w-auto" role="img" aria-label={`Face seen in a mirror, ${left ? "left" : "right"} half shaded for the product`}>
      <defs>
        <clipPath id="side-half">
          <rect x={left ? 0 : 60} y="0" width="60" height="150" />
        </clipPath>
        <pattern id="side-bare" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="6" stroke="var(--bare)" strokeWidth="1" opacity="0.5" />
        </pattern>
      </defs>
      <ellipse cx="60" cy="68" rx="44" ry="58" fill="url(#side-bare)" />
      <ellipse cx="60" cy="68" rx="44" ry="58" fill="var(--accent)" opacity="0.85" clipPath="url(#side-half)" />
      <ellipse cx="60" cy="68" rx="44" ry="58" fill="none" stroke="var(--ink)" strokeWidth="2" />
      <line x1="60" y1="10" x2="60" y2="126" stroke="var(--ink)" strokeWidth="1.5" strokeDasharray="3 3" />
      <text x={left ? 30 : 90} y="144" textAnchor="middle" fontSize="11" fontWeight="600" fill="var(--ink)">
        product
      </text>
    </svg>
  );
}
