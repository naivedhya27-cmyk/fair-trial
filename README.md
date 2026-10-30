# Fair Trial

Is your skincare product working? Fair Trial answers the way a split-face skin trial does, on your own face. Your phone draws one half of your face for the product; the other half stays bare. The camera takes two guided photos on set days, YouCam's Skin Analysis measures both halves, and the app compares the change on the product half with the bare half, against how much your own photos vary from day to day. At each check-in it gives a verdict with its numbers, and at the end a certificate you can print.

- Live: https://fair-trial.vercel.app
- A whole demo trial in under a minute: https://fair-trial.vercel.app/demo
- Built for the YouCam API Skin AI & eCommerce VTO Hackathon (Perfect Corp, 2026).

## What it does

1. **Check the product** (`/trial/new`). Five set questions about you (age, pregnancy, worrying skin changes, a doctor's care, prescription medicine), then the product's name, type and ingredient list, and whether a doctor or pharmacist gave it to you as a medicine. A safety check answers first: start, start with a warning to read, not for this app, or see a doctor or pharmacist first. Then the planner reads the actives in the ingredient list and plans the test from published trials (PubMed systematic reviews, meta-analyses and randomised trials): the goal it can measure (for example fine lines and wrinkles for retinol), the check-in weeks, the verdict week and any expected early adjustment. A product with no fair test here, such as a sunscreen, gets the reason instead of a plan.
2. **Draw a side.** The phone's cryptographic random generator picks the product half, shown on a mirror-view diagram.
3. **Take two photos a day.** A 4-day run-in before the product starts, then check-ins: one day at week 2, two days at the first look, two days 2 weeks after any expected early adjustment, two days at week 4 when there would be no look between week 2 and the verdict week, and three days at the verdict week, two photos a minute apart each day. The camera checks about 4 frames a second for framing, head pose, light, colour, sharpness and hidden eyes, says the one thing to fix, and takes the photo only when every check passes. From the second photo on, light and colour are judged against your own first photo.
4. **Get a fair verdict.** Each check-in is judged as soon as its photos are analysed: Working, Not yet, No measurable effect, Stop and check, Expected adjustment or Can't tell, with the change in points (product half minus bare half, from the run-in), the give-or-take, and the smallest change this trial can pick up. During an expected early adjustment, a worsening more than 5 times that smallest change still reads Stop and check. The certificate (`/trial/certificate`) holds the verdict, what was tested and how, the day chart, every check-in, the evidence and the limits. No photo appears on it.

The demo (`/demo`) plays a labelled trial of a person who doesn't exist through the same trial screen, verdict engine and certificate. The judge picks what the product really does, and the app isn't told. It analyses nothing and spends no units.

## How it uses the YouCam API

In the app, Skin Analysis (task API v2.0, SD), always through the app's own server so the key never reaches the browser (`src/app/api`, `src/lib/youcam`):

| Route                        | What it does                                                                                                                                                                                                                                         |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/analysis`         | Checks the photo (JPEG or PNG, 10 kB to 4 MB), 1 to 4 concerns from the 9 a trial can measure, the daily limit and the unit floor; uploads the photo with the File API (`/s2s/v2.0/file`) and starts `/s2s/v2.0/task/skin-analysis`. Stores nothing. |
| `GET /api/analysis/{taskId}` | Polls the task and passes on only the raw scores and the mask addresses. The display scores are dropped: they are not used as a measurement.                                                                                                         |
| `GET /api/mask`              | Relays one result mask for the browser to measure: one exact storage host, https only, no redirects, at most 10 MB, PNG signature checked.                                                                                                           |
| `GET /api/status`            | Whether live analysis is open to this visitor, from the free credit check (`/s2s/v1.0/client/credit`). The balance itself is never shown.                                                                                                            |

In the browser, MediaPipe Face Landmarker finds the facial midline; each mask is split there, and the app measures each half (`src/lib/metrics/halfface.ts`).

In validation only (not called by the app): the AI Image Generator made the synthetic people every test used, from Fitzpatrick type I to VI, and Skin Simulation made known skin changes at set intensities, so that every measurement could be checked against a change that was known before it was measured.

## Run it

Node 22 and npm.

```bash
npm ci        # installs, and copies MediaPipe's files into public/mediapipe
npm run dev   # http://localhost:3000
```

Without a key everything except live analysis works: the demo, the camera check and a whole trial, whose photos wait on the phone. For live analysis, put these in `.env.local` (git ignores it):

```bash
YOUCAM_API_KEY=...           # the YouCam API key; read only on the server
YOUCAM_UNIT_FLOOR=30         # live analysis stops before the balance would fall below this
YOUCAM_PUBLIC_FLOOR=200      # the floor for visitors without the judges' code (never below YOUCAM_UNIT_FLOOR)
YOUCAM_DAILY_LIMIT=3         # analyses per visitor a day
YOUCAM_JUDGE_CODE=...        # optional: 16 to 64 letters and digits; requests that carry it use the judges' floor and limit
YOUCAM_JUDGE_DAILY_LIMIT=8   # analyses per judge a day
```

A judge opens `/judges#<code>` once on their phone: the page keeps the code on that browser, removes it from the address bar and says whether it is valid. Delete everything removes it with the rest.

Checks, as CI runs them (`.github/workflows/ci.yml`):

```bash
npm run ci                                 # lint, format check, typecheck, unit tests, claim linter, production build
npx playwright install chromium
npm run e2e                                # end-to-end smoke on the production build, with axe in light and dark
```

## How it was validated

Every part was built as a step with its bar written down before its test. The code was frozen by md5, then scored once on a held-out set drawn by seed: synthetic people made by YouCam's image generator, real ingredient lists, FDA drug labels and simulated trials with known outcomes. Missed bars are reported as missed, and their fixes went into the next step. All of it ran on synthetic people; no real person's photo was used.

| Part                                                                                                 | Held-out result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Capture gate, 12 new synthetic people, 288 photos                                                    | Every fault type rejected (exposure, side light, colour cast, blur, roll, distance); 72 of 72 good re-captures and 48 of 48 true one-sided skin changes accepted, for every eye shape and skin type                                                                                                                                                                                                                                                                                                                                    |
| Photo noise, repeat photos with no true change, types I to VI                                        | 9 of 12 concerns can compare one half of the face with the other; acne and radiance cannot at this noise, pores are marginal                                                                                                                                                                                                                                                                                                                                                                                                           |
| Half-face measurement, composites with a known product half                                          | Product side found in 48 of 50 true changes; 0 of 54 calls in the wrong direction. Missed: the bare half stayed within its noise in 38 of 54, because YouCam reads the face as a whole and part of a change reaches the other half. That only shrinks a difference; it never flips its direction                                                                                                                                                                                                                                       |
| Verdict engine and check-in weeks, 2,040,000 simulated trials on the 5 plan shapes the planner makes | False "Working" for a product that does nothing: 1.0 to 4.2% in all 100 noise scenarios, against a bar of 5%. "Working" at an effect of one smallest detectable change: 90.3 to 99.7%. "Stop and check" on a worsening of that size: 97.4 to 100%, and on plans with an expected early adjustment, by the look after it: 85.7 to 98.3% (0% before that look). Early irritation of that size: stopped in at most 1.9%                                                                                                                   |
| Trial planner, 40 real ingredient lists (Open Beauty Facts)                                          | 55 of 55 actives found, 0 false finds; 400 of 400 plans as the evidence table says, on all 10 fields                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Safety guard, FDA labels and product lists it had never seen                                         | 0 of 40 everyday products called a medicine; 32 of 40 prescription labels sent to a doctor or pharmacist from the text alone, against a bar of 40. So the app also asks the person directly whether the product was given as a medicine. On a final reserve of 42 more prescription labels, 40 were sent to a doctor or pharmacist and the other 2 turned away as not ingredient lists, so none reached a trial; 34 of 40 OTC labels were handled as the allowlist says (bar 40), and 0 of 40 everyday products were called a medicine |
| Server and key                                                                                       | Live analysis of a synthetic face on 4 of 4 concerns for exactly the 9 units the docs state; the key in 0 of 90 responses the browser received; 29 of 29 bad requests refused                                                                                                                                                                                                                                                                                                                                                          |
| Trial flow, design and access                                                                        | Every judge's path audited in a phone browser with a fake clock: all 6 trial-flow bars and all 10 design and access bars, 0 serious or critical axe-core findings in light and dark                                                                                                                                                                                                                                                                                                                                                    |
| Demo                                                                                                 | Every check-in of the demo's three outcomes (12 of 12, the week 6 look included) matches an independent R version of the verdict engine; the longest plays in 52 s                                                                                                                                                                                                                                                                                                                                                                     |
| Tests and CI                                                                                         | 300 of 300 seeded claims caught by the claim linter and 100 of 100 near-misses left alone; the verdict engine matched its R version on 1,000 of 1,000 cases; CI green from clean copies on Linux and Windows                                                                                                                                                                                                                                                                                                                           |
| Live site                                                                                            | Deployed files matched the frozen files one for one; 4 of 5 bars. One of 14 audit paths stalled at the camera while the face finder loaded over a hung connection; the face finder now loads with its own timeouts and retries, and keeps a copy on the phone                                                                                                                                                                                                                                                                          |
| Judges' access and the repository                                                                    | The judges' code, the notice before the camera and this repository met their bars. Two bars missed at first (the face finder's runner crashed before saving; 3 of 26 audit paths timed out while the test computer's link stalled) were met on fresh draws once fixed: the face finder within every limit, and 12 of 12 trial-flow paths, 14 of 14 design and access paths and 6 of 6 demo datasets on the live site                                                                                                                   |

Step by step, with every bar: [docs/VALIDATION.md](docs/VALIDATION.md).

## Privacy and safety

- Photos and results stay on the phone (IndexedDB). For an analysis, the photo goes through the app's server to YouCam; the app's server keeps nothing. Only raw scores and masks come back.
- Delete everything removes the trial database and every Fair Trial setting from the phone.
- The YouCam key lives only on the server (a Sensitive variable on Vercel). Live analysis stops at a unit floor and a daily limit per visitor; `/api/status` never shows the balance.
- The safety check runs before any plan. Under 18: not for this app. Pregnant, trying or not saying, with a retinoid: not for this app. A worrying skin change, a doctor's care, a prescription medicine, a product given as a medicine or a strength over its limit: see a doctor or pharmacist first. Retinoids and AHAs carry a sun-sensitivity warning.
- Fair Trial measures and reports. A claim linter in CI reads every text a person can see, this README included, and fails the build on any claim its policy rules out; `tools/claim-lint/policy.ts` names the public rule behind each one.
- Security headers on every response: HSTS, nosniff, a referrer policy, a permissions policy (the camera for this site only), no framing and a Content-Security-Policy.

## Limits

- It measures what YouCam's Skin Analysis measures in photos. A verdict is about this product, on this face, in these photos. It is not a medical service and does not look at moles, rashes or any skin problem.
- Nine concerns can be compared half against half: moisture, texture, wrinkles, dark circles, eye bags, oiliness, redness, dark spots and tear troughs. Acne-only products and sunscreens get no trial. On dark spots, oiliness, texture and redness part of a change reaches the bare half, so those verdicts are conservative.
- The validation faces, faults and skin changes are synthetic, and the sets are small; each step's report gives its confidence intervals. Real phones, rooms and skin vary more, which is why every verdict uses the person's own run-in spread and never less than the measured camera noise.
- Reading text cannot catch every medicine. On the final unseen reserve no prescription label reached a trial, but 3 of 40 OTC drug labels would have (a capsicum and menthol balm, an aloe sun cream and a pyrithione zinc wash), which is why the app also asks directly.
- Each look can stop a trial at the 5% level, so a product that does nothing meets "Stop and check" somewhere in 2.5 to 12.7% of simulated trials, more often when a person's photos vary more. "Stop and check" shows what was measured and asks the person to stop and look.
- Live analysis spends YouCam units. When they run low it pauses, the photos wait on the phone, and the demo still works.

## Licence

MIT, see [LICENSE](LICENSE). Third-party files and their licences: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
