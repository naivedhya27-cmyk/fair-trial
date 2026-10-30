"use client";
// Shared pieces for the trial screens (S16), in the S17 design system: buttons, screens, cards, notices, step bars and
// answer choices. Every state shown in colour also has an icon and words.
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { IconAlert, IconBack, IconCheck, IconInfo, IconStop, IconTrash } from "@/components/icons";
import { deleteEverything } from "@/lib/trial/store";

const base = "ft-press inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl px-5 text-base font-semibold disabled:cursor-not-allowed disabled:opacity-45";
export const btn = {
  primary: `${base} bg-accent text-accent-ink shadow-sm hover:bg-accent-strong`,
  secondary: `${base} border border-line-strong bg-surface text-ink hover:border-ink`,
  danger: `${base} border border-stop bg-surface text-stop`,
  quiet: "inline-flex min-h-12 items-center justify-center rounded-xl px-3 text-base font-medium underline underline-offset-4",
};

export const field = "min-h-12 w-full rounded-2xl border border-line-strong bg-surface px-4 text-base text-ink placeholder:text-muted aria-[invalid=true]:border-stop";

const backLink = "-ml-2 inline-flex min-h-11 items-center gap-1 self-start rounded-lg px-2 text-base font-medium text-muted hover:text-ink print:hidden";

/**
 * One screen: an optional way back, an optional step bar, the title and the content. With `autoFocus` (a new step
 * inside the same page) the title takes focus, so a screen reader announces it and the keyboard starts from the top.
 */
export function Screen({
  title,
  children,
  back,
  step,
  banner,
  autoFocus = false,
}: {
  title: string;
  children: ReactNode;
  back?: { href: string; label: string } | { onClick: () => void; label: string };
  step?: { at: number; of: number; label: string };
  /** shown first, above everything else on the screen (the demo's label) */
  banner?: ReactNode;
  autoFocus?: boolean;
}) {
  const h1 = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!autoFocus) return;
    window.scrollTo(0, 0);
    h1.current?.focus({ preventScroll: true });
  }, [autoFocus, title]);
  return (
    <main className="ft-rise mx-auto flex w-full max-w-md flex-1 flex-col gap-5 px-4 pb-12 pt-4">
      {banner}
      {back &&
        ("href" in back ? (
          <Link href={back.href} className={backLink} data-back="">
            <IconBack size={18} />
            {back.label}
          </Link>
        ) : (
          <button type="button" onClick={back.onClick} className={backLink} data-back="">
            <IconBack size={18} />
            {back.label}
          </button>
        ))}
      {step && <StepBar {...step} />}
      <h1 ref={h1} tabIndex={-1} className="text-[1.75rem] font-semibold leading-tight tracking-tight">
        {title}
      </h1>
      {children}
    </main>
  );
}

/** Where a person is in a sequence; the words carry it, the bar only shows it. */
export function StepBar({ at, of, label }: { at: number; of: number; label: string }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium text-muted">
        Step {at} of {of}: {label}
      </p>
      <div className="flex gap-1.5" aria-hidden="true">
        {Array.from({ length: of }, (_, i) => (
          <span key={i} className={`h-1.5 flex-1 rounded-full ${i < at ? "bg-accent" : "bg-line"}`} />
        ))}
      </div>
    </div>
  );
}

export type Tone = "plain" | "accent" | "good" | "warn" | "stop";
const TONE: Record<Tone, string> = {
  plain: "border-line bg-surface",
  accent: "border-accent/40 bg-accent-soft",
  good: "border-good/45 bg-good-soft",
  warn: "border-warn/50 bg-warn-soft",
  stop: "border-stop/50 bg-stop-soft",
};

export function Card({ children, tone = "plain", label, className = "" }: { children: ReactNode; tone?: Tone; label?: string; className?: string }) {
  return (
    <section aria-label={label} className={`flex flex-col gap-3 rounded-3xl border p-5 shadow-[0_1px_2px_rgba(28,25,23,0.05)] ${TONE[tone]} ${className}`}>
      {children}
    </section>
  );
}

const NOTICE_ICON = {
  good: <IconCheck className="mt-0.5 shrink-0 text-good" />,
  warn: <IconAlert className="mt-0.5 shrink-0 text-warn" />,
  stop: <IconStop className="mt-0.5 shrink-0 text-stop" />,
  info: <IconInfo className="mt-0.5 shrink-0 text-accent" />,
};

/** A message with its icon: good news, a warning, a stop or plain information. */
export function Notice({ tone, children, label }: { tone: keyof typeof NOTICE_ICON; children: ReactNode; label?: string }) {
  return (
    <Card tone={tone === "info" ? "accent" : tone} label={label}>
      <div className="flex gap-3">
        {NOTICE_ICON[tone]}
        <div className="flex min-w-0 flex-1 flex-col gap-2">{children}</div>
      </div>
    </Card>
  );
}

/** Delete every trial, photo and setting on this device, after a confirmation. */
export function DeleteEverything({ onDone }: { onDone?: () => void }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  // Focus follows the question: to it when asked, back to the button on "Keep it", so the keyboard never drops to the top.
  const [moved, setMoved] = useState(false);
  const question = useRef<HTMLParagraphElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (moved) (asking ? question.current : opener.current)?.focus();
  }, [asking, moved]);
  const ask = (v: boolean) => {
    setMoved(true);
    setAsking(v);
  };
  if (!asking)
    return (
      <button ref={opener} type="button" id="delete-everything" className={btn.danger} onClick={() => ask(true)}>
        <IconTrash size={18} />
        Delete everything
      </button>
    );
  return (
    <Notice tone="stop" label="Delete everything">
      <p ref={question} id="delete-question" tabIndex={-1} className="text-base font-semibold">
        Delete everything?
      </p>
      <p className="text-base">This deletes every trial, every photo and every setting Fair Trial keeps on this phone. It can&apos;t be undone.</p>
      <div className="flex flex-col gap-3">
        <button
          type="button"
          id="confirm-delete"
          disabled={busy}
          className={btn.danger}
          onClick={async () => {
            setBusy(true);
            await deleteEverything();
            setBusy(false);
            setAsking(false);
            onDone?.();
          }}
        >
          Yes, delete it all
        </button>
        <button type="button" className={btn.secondary} onClick={() => ask(false)}>
          Keep it
        </button>
      </div>
    </Notice>
  );
}

const choiceBox =
  "flex min-h-12 cursor-pointer items-center gap-3 rounded-2xl border border-line-strong bg-surface px-4 py-2.5 text-base has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:checked]:font-medium";

/** The mark beside a question that still needs an answer. */
export function Missing({ id }: { id: string }) {
  return (
    <p id={id} className="flex items-center gap-1.5 text-sm font-medium text-stop">
      <IconAlert size={16} />
      Please answer this.
    </p>
  );
}

export function YesNo({
  name,
  legend,
  value,
  onChange,
  hint,
  missing = false,
}: {
  name: string;
  legend: string;
  value: boolean | null;
  onChange: (v: boolean) => void;
  hint?: string;
  missing?: boolean;
}) {
  const described = [hint && `${name}-hint`, missing && `${name}-missing`].filter(Boolean).join(" ") || undefined;
  return (
    <fieldset className="flex flex-col gap-2" aria-describedby={described}>
      <legend className="mb-2 text-base font-semibold">{legend}</legend>
      {hint && (
        <p id={`${name}-hint`} className="text-sm text-muted">
          {hint}
        </p>
      )}
      {missing && <Missing id={`${name}-missing`} />}
      <div className="grid grid-cols-2 gap-3">
        {[true, false].map((v) => (
          <label key={String(v)} className={choiceBox}>
            <input type="radio" name={name} value={v ? "yes" : "no"} checked={value === v} onChange={() => onChange(v)} className="h-5 w-5" />
            {v ? "Yes" : "No"}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function Choice<T extends string>({
  name,
  legend,
  options,
  value,
  onChange,
  missing = false,
}: {
  name: string;
  legend: string;
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (v: T) => void;
  missing?: boolean;
}) {
  return (
    <fieldset className="flex flex-col gap-2" aria-describedby={missing ? `${name}-missing` : undefined}>
      <legend className="mb-2 text-base font-semibold">{legend}</legend>
      {missing && <Missing id={`${name}-missing`} />}
      {options.map((o) => (
        <label key={o.value} className={choiceBox}>
          <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} className="h-5 w-5" />
          {o.label}
        </label>
      ))}
    </fieldset>
  );
}
