import { IconCamera, IconCheck, IconList, IconLock, IconShuffle } from "@/components/icons";
import HomeActions from "./HomeActions";

const STEPS = [
  {
    title: "Check the product",
    text: "Type in its ingredient list. Fair Trial first checks for reasons not to test it, then finds what the research says it can change, and by which week.",
  },
  {
    title: "Draw a side",
    text: "Your phone picks one side of your face at random for the product. The other side stays bare: it's the comparison.",
  },
  {
    title: "Take two photos a day",
    text: "Four days before you start, then a few days at each check-in. YouCam's skin analysis measures each half of your face.",
  },
  {
    title: "Get a fair verdict",
    text: "At the week the research names: working, no measurable effect, or stop and check, allowing for your own day-to-day noise.",
  },
];
const STEP_ICONS = [IconList, IconShuffle, IconCamera, IconCheck];

/** The idea in one picture: one half of the face with the product, the other bare, both measured. */
function SplitFace() {
  return (
    <svg viewBox="0 0 240 150" className="h-36 w-auto self-start" role="img" aria-label="A face split down the middle: one half with the product, one half bare, both measured">
      <defs>
        <clipPath id="home-left">
          <rect x="0" y="0" width="130" height="150" />
        </clipPath>
        <pattern id="home-bare" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="6" stroke="var(--bare)" strokeWidth="1" opacity="0.5" />
        </pattern>
      </defs>
      <ellipse cx="130" cy="75" rx="52" ry="66" fill="url(#home-bare)" />
      <ellipse cx="130" cy="75" rx="52" ry="66" fill="var(--accent)" opacity="0.85" clipPath="url(#home-left)" />
      <ellipse cx="130" cy="75" rx="52" ry="66" fill="none" stroke="var(--ink)" strokeWidth="2.5" />
      <line x1="130" y1="6" x2="130" y2="144" stroke="var(--ink)" strokeWidth="1.5" strokeDasharray="4 4" />
      <text x="60" y="79.5" fontSize="13" fontWeight="600" fill="var(--ink)" textAnchor="end">
        product
      </text>
      <text x="200" y="79.5" fontSize="13" fontWeight="600" fill="var(--ink)">
        bare
      </text>
      <path d="M64 75h12M184 75h12" stroke="var(--ink)" strokeWidth="1.5" />
    </svg>
  );
}

export default function Home() {
  return (
    <main className="ft-rise mx-auto flex w-full max-w-md flex-1 flex-col gap-10 px-4 pb-12 pt-6">
      <section className="flex flex-col gap-5" aria-labelledby="hero">
        <SplitFace />
        <h1 id="hero" className="text-[2.25rem] font-semibold leading-[1.08] tracking-tight">
          Is your skincare actually working?
        </h1>
        <p className="text-lg leading-relaxed text-muted">
          Test it on half your face, fairly. Your phone picks the side, YouCam measures both halves, and the verdict allows for your own day-to-day noise.
        </p>
        <HomeActions />
      </section>

      <section aria-labelledby="how" className="flex flex-col gap-4">
        <h2 id="how" className="text-xl font-semibold tracking-tight">
          How a trial works
        </h2>
        <ol className="flex flex-col gap-3">
          {STEPS.map((s, i) => {
            const Icon = STEP_ICONS[i];
            return (
              <li key={s.title} className="flex gap-4 rounded-3xl border border-line bg-surface p-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent" aria-hidden="true">
                  <Icon size={20} />
                </span>
                <div className="flex flex-col gap-1">
                  <h3 className="text-base font-semibold">{s.title}</h3>
                  <p className="text-base leading-relaxed text-muted">{s.text}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      <section aria-labelledby="privacy" className="flex gap-4 rounded-3xl border border-line bg-surface-2 p-5">
        <IconLock className="mt-0.5 shrink-0 text-accent" />
        <div className="flex flex-col gap-1">
          <h2 id="privacy" className="text-base font-semibold">
            Your photos stay on your phone
          </h2>
          <p className="text-base leading-relaxed text-muted">
            Each photo goes through our server to YouCam for analysis; Fair Trial doesn&apos;t keep it. Your results stay on this phone, and you can delete everything at any time.
          </p>
        </div>
      </section>

      <section aria-labelledby="not-medical" className="flex flex-col gap-1 rounded-3xl border border-line bg-surface-2 p-5">
        <h2 id="not-medical" className="text-base font-semibold">
          What it isn&apos;t
        </h2>
        <p className="text-base leading-relaxed text-muted">
          Fair Trial is for adults trying everyday skincare. It is not a medical service and doesn&apos;t look at moles, rashes or any skin problem; for those, see a doctor or pharmacist.
        </p>
      </section>

      <footer className="text-sm text-muted">Uses YouCam&apos;s skin analysis by Perfect Corp.</footer>
    </main>
  );
}
