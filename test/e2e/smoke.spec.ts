// End-to-end smoke (S19), on a production build: the home page, a whole demo trial to its certificate, and a retinol
// trial started through the screens whose stored record is read back from IndexedDB (S17 finding 2). Each screen
// checked has one visible h1, no claim word from the claim policy in anything a person can see or hear, and no
// serious or critical axe-core finding (WCAG 2.0 to 2.2, A and AA) in light or dark colours.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { findClaims } from "../../tools/claim-lint/policy";

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const RETINOL = "Aqua, Squalane, Glycerin, Retinol, Cetearyl Alcohol, Tocopherol, Xanthan Gum, Phenoxyethanol";

/** Wait until every finite animation and transition has finished, as the S17 audit does: a screen measured while it
 *  fades in has less contrast than the screen a person reads. */
const settle = (page: Page) =>
  page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => Number.isFinite(Number(a.effect?.getComputedTiming().endTime)))
        .map((a) => a.finished.catch(() => null)),
    ),
  );

async function screenCheck(page: Page) {
  await settle(page);
  const seen = await page.evaluate(() => {
    const vis = (e: Element) => e.getClientRects().length > 0;
    const texts: string[] = [document.title];
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const el = n.parentElement;
      if (el && vis(el) && !el.closest("script,style,noscript,template")) texts.push(n.nodeValue ?? "");
    }
    for (const el of document.querySelectorAll("[aria-label],[alt],[title],[placeholder]"))
      for (const a of ["aria-label", "alt", "title", "placeholder"]) {
        const v = el.getAttribute(a);
        if (v && vis(el)) texts.push(v);
      }
    return { h1: [...document.querySelectorAll("h1")].filter(vis).length, text: texts.join(" \n ") };
  });
  expect(seen.h1, "one visible h1").toBe(1);
  expect(
    findClaims(seen.text).map((c) => c.match),
    "claim words",
  ).toEqual([]);
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await settle(page);
    const r = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
    expect(r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${colorScheme}: ${v.id}`)).toEqual([]);
  }
  await page.emulateMedia({ colorScheme: "light" });
}

const watchErrors = (page: Page) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  return errors;
};

test("home, then a demo trial from its start to its certificate", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/");
  await expect(page.locator("#demo-link")).toBeVisible();
  await screenCheck(page);

  await page.click("#demo-link");
  await page.waitForURL(/\/demo$/);
  await expect(page.locator("#demo-label")).toBeVisible();
  await page.check('input[name="outcome"][value="works"]');
  await screenCheck(page);

  await page.click("#demo-steps");
  const stop = page.locator("#demo-stop");
  await expect(stop).toBeVisible();
  const stops = Number(await stop.getAttribute("data-of"));
  expect(stops).toBeGreaterThan(5);
  for (let i = 1; i < stops; i++) {
    await page.click("#demo-next");
    await expect(stop).toHaveAttribute("data-at", String(i));
  }
  await expect(page.locator("#demo-label")).toBeVisible();
  await expect(page.locator("main").first()).toContainText("Working");
  await screenCheck(page);

  await page.click("#demo-next");
  await expect(page.getByRole("heading", { level: 1, name: "Demo certificate" })).toBeVisible();
  await expect(page.locator("#demo-label")).toBeVisible();
  await expect(page.locator("main").first()).toContainText("Not a real result");
  await screenCheck(page);
  expect(errors).toEqual([]);
});

test("a retinol trial started through the screens stores its sun warning", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/");
  await page.click("#start-trial");
  await page.fill("#age", "34");
  await page.check('input[name="pregnancy"][value="no"]');
  for (const q of ["redflags", "undercare", "prescription"]) await page.check(`input[name="${q}"][value="no"]`);
  await screenCheck(page);
  await page.click("#next");

  await page.fill("#product-name", "Night serum");
  await page.check('input[name="type"][value="serum"]');
  await page.fill("#ingredients", RETINOL);
  await page.check('input[name="medicine"][value="no"]');
  await page.click("#next");

  await expect(page.locator('[data-rule="sun_sensitivity"]')).toBeVisible();
  await screenCheck(page);
  await page.click("#next");
  await expect(page.locator("#goal")).toBeVisible();
  await page.click("#next");
  await page.click("#draw-side");
  await page.click("#start-run-in");
  await page.waitForURL(/\/trial$/);
  await expect(page.locator("#today")).toBeVisible();

  const trials = await page.evaluate(
    () =>
      new Promise<{ guard: unknown; productName: string }[]>((resolve, reject) => {
        const open = indexedDB.open("fairtrial");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const all = db.transaction("trials").objectStore("trials").getAll();
          all.onsuccess = () => {
            resolve(all.result);
            db.close();
          };
          all.onerror = () => reject(all.error);
        };
      }),
  );
  expect(trials).toHaveLength(1);
  expect(trials[0].productName).toBe("Night serum");
  expect(trials[0].guard).toEqual({ action: "warn", rules: ["sun_sensitivity"] });
  expect(errors).toEqual([]);
});
