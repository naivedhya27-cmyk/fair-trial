// Pieces shared by the trial screen and the certificate (S17): each verdict's tone and icon, the round mark that shows
// them, the product-side face, and the bar that places a result between "worse" and "better". The words always sit
// beside these, so the drawings are hidden from screen readers.
import type { ComponentType } from "react";
import { IconAlert, IconCheck, IconClock, IconHelp, IconMinus, IconStop } from "@/components/icons";
import type { Tone } from "@/components/ui";
import type { Side } from "@/lib/metrics/halfface";
import type { Verdict } from "@/lib/stats/verdict";

export type IconType = ComponentType<{ size?: number; className?: string }>;

export const VERDICT_LOOK: Record<Verdict, { tone: Tone; Icon: IconType }> = {
  working: { tone: "good", Icon: IconCheck },
  not_yet: { tone: "plain", Icon: IconClock },
  no_effect: { tone: "plain", Icon: IconMinus },
  stop: { tone: "stop", Icon: IconStop },
  adjusting: { tone: "warn", Icon: IconAlert },
  cant_tell: { tone: "plain", Icon: IconHelp },
};

const MARK: Record<Tone, string> = {
  plain: "border border-line-strong bg-surface text-ink",
  accent: "bg-accent text-accent-ink",
  good: "bg-good text-surface",
  warn: "bg-warn text-surface",
  stop: "bg-stop text-surface",
};

/** An icon in a filled circle, in a state's colour. */
export function ToneMark({ tone, Icon, big = false }: { tone: Tone; Icon: IconType; big?: boolean }) {
  return (
    <span aria-hidden="true" className={`flex shrink-0 items-center justify-center rounded-full ${big ? "h-12 w-12" : "h-10 w-10"} ${MARK[tone]}`}>
      <Icon size={big ? 24 : 20} />
    </span>
  );
}

/** A small face with the product half filled, as seen in a mirror (your left on the left). */
export function SideFace({ side, className = "h-12 w-10" }: { side: Side; className?: string }) {
  const left = side === "subject_left";
  return (
    <svg viewBox="0 0 40 48" className={`shrink-0 ${className}`} aria-hidden="true" focusable="false">
      <path d={left ? "M20 3C10.6 3 4.5 11.5 4.5 24S10.6 45 20 45Z" : "M20 3c9.4 0 15.5 8.5 15.5 21S29.4 45 20 45Z"} fill="var(--accent)" />
      <ellipse cx="20" cy="24" rx="15.5" ry="21" fill="none" stroke="var(--ink)" strokeWidth="2" />
      <path d="M20 3v42" stroke="var(--ink)" strokeWidth="1.4" strokeDasharray="2.4 2.4" />
    </svg>
  );
}

/** Where a result sits between worse and better, with its give-or-take; "no change" is the middle line. */
export function EffectBar({ improvement, se }: { improvement: number; se: number }) {
  const reach = Math.max(Math.abs(improvement) + se, 2 * se, 1) * 1.2;
  const x = (v: number) => Math.min(270, Math.max(30, 150 + (v / reach) * 120));
  return (
    <svg viewBox="0 0 300 46" className="w-full" aria-hidden="true" focusable="false">
      <line x1="30" y1="18" x2="270" y2="18" stroke="var(--line)" strokeWidth="2" strokeLinecap="round" />
      <line x1="150" y1="6" x2="150" y2="30" stroke="var(--line-strong)" strokeWidth="1.5" strokeDasharray="3 3" />
      <line x1={x(improvement - se)} y1="18" x2={x(improvement + se)} y2="18" stroke="var(--ink)" strokeWidth="3" strokeLinecap="round" />
      <circle cx={x(improvement)} cy="18" r="6.5" fill="var(--ink)" stroke="var(--surface)" strokeWidth="2" />
      <text x="30" y="42" fontSize="11" fill="var(--muted)">
        worse
      </text>
      <text x="150" y="42" fontSize="11" fill="var(--muted)" textAnchor="middle">
        no change
      </text>
      <text x="270" y="42" fontSize="11" fill="var(--muted)" textAnchor="end">
        better
      </text>
    </svg>
  );
}
