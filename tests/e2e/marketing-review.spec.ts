import { it, expect } from "vitest";
import { expect as pw, type Locator, type Page } from "@playwright/test";
import { diaryUrl, withDiaryBrowser } from "./helpers/diary-harness";

// Extended from Marketing's review/tests/e2e/marketing-review.spec.ts.
// Real client, Chromium and production CSS; only API transport is mocked.
// Run with DIARY_VISUAL_CSS=1 after a production build (see companion README).
const outcomes = [
  { name: "200", status: 200, message: "Sincronizzazione Norish: completata." },
  { name: "503", status: 503, message: "Sincronizzazione già in corso. Attendi e riprova." },
  { name: "401", status: 401, message: "Accedi per sincronizzare il tuo diario." },
  { name: "network", status: null, message: "Connessione non disponibile. Riprova la sincronizzazione." },
] as const;
type Outcome = typeof outcomes[number];

async function withPendingSync(width: number, outcome: Outcome, run: (
  page: Page, trigger: Locator, complete: () => Promise<void>,
) => Promise<void>) {
  expect(process.env.DIARY_VISUAL_CSS, "Production CSS is mandatory: build, then set DIARY_VISUAL_CSS=1").toBe("1");
  await withDiaryBrowser(async page => {
    await page.setViewportSize({ width, height: 844 });
    let release!: () => void;
    let resolveStarted!: () => void;
    let resolveCompleted!: () => void;
    const started = new Promise<void>(resolve => { resolveStarted = resolve; });
    const completed = new Promise<void>(resolve => { resolveCompleted = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    let syncRequests = 0;
    await page.route("**/api/v1/**", async route => {
      if (new URL(route.request().url()).pathname === "/api/v1/sync") {
        syncRequests++;
        expect(route.request().method()).toBe("POST");
        resolveStarted();
        await gate;
        try {
          if (outcome.status === null) await route.abort("failed");
          else await route.fulfill({ status: outcome.status, json: outcome.status === 200
            ? { status: "ok", reason: null, origin: null }
            : { error: outcome.status === 503 ? "Sincronizzazione già in corso." : "Unauthorized" } });
        } finally { resolveCompleted(); }
        return;
      }
      await route.fulfill({ json: { entries: [], sync: null, target: null, foods: [], recipes: [] } });
    });
    try {
      await page.goto(diaryUrl(page));
      // Catch missing/empty CSS instead of silently testing a naked harness.
      expect(await page.locator("#diary-production-css").textContent()).toContain(".app-shell");
      const trigger = page.getByRole("button", { name: /^(Sincronizza ora|Sincronizzazione…)$/ });
      await pw(trigger).toHaveText("Sincronizza ora");
      await pw(trigger).toBeEnabled();
      await trigger.focus();
      await pw(trigger).toBeFocused();
      await page.keyboard.press("Enter");
      await started;
      const pending = page.getByRole("button", { name: "Sincronizzazione…", exact: true });
      await pw(pending).toBeDisabled();
      await pw(page.getByRole("status").filter({ hasText: "Sincronizzazione in corso…" })).toBeVisible();
      await run(page, trigger, async () => {
        release();
        await completed;
        await pw(trigger).toBeEnabled();
        if (outcome.status === 200) {
          await pw(page.locator(".sync-dot.ok")).toBeVisible();
          await pw(page.locator("#sync-status")).toHaveText(outcome.message);
        } else await pw(page.getByRole("status").filter({ hasText: outcome.message })).toBeVisible();
        expect(syncRequests, "Exactly one keyboard-initiated sync request").toBe(1);
      });
    } finally { release(); }
  });
}

async function assertReadableFeedback(page: Page, outcome: Outcome) {
  if (outcome.status === 200) {
    await pw(page.locator(".sync-dot.ok")).toBeVisible();
    await pw(page.locator("#sync-status")).toHaveText(outcome.message);
    await pw(page.getByRole("button", { name: "Sincronizza ora", exact: true })).toHaveAttribute("aria-describedby", "sync-status");
    return;
  }
  const feedback = page.getByText(outcome.message, { exact: true });
  await pw(feedback).toBeVisible();
  await feedback.scrollIntoViewIfNeeded();
  const readability = await feedback.evaluate(element => {
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    let announced = false;
    let hidden = false;
    for (let parent: Element | null = element; parent; parent = parent.parentElement) {
      const role = parent.getAttribute("role");
      const live = parent.getAttribute("aria-live");
      announced ||= live === "polite" || live === "assertive" || role === "status" || role === "alert";
      hidden ||= parent.getAttribute("aria-hidden") === "true" || parent.hasAttribute("inert");
    }
    // Text ranges catch clipping which element bounding boxes alone can miss.
    const range = document.createRange();
    range.selectNodeContents(element);
    const textFits = Array.from(range.getClientRects()).every(rect =>
      rect.left >= -1 && rect.right <= innerWidth + 1);
    return { announced, hidden, textFits, fontSize: parseFloat(style.fontSize),
      width: box.width, height: box.height, text: element.textContent?.trim() };
  });
  expect(readability.text).toBe(outcome.message);
  expect(readability.announced, "Outcome is exposed through a live region or status/alert role").toBe(true);
  expect(readability.hidden, "Outcome must not be hidden from assistive technology").toBe(false);
  expect(readability.fontSize).toBeGreaterThanOrEqual(12);
  expect(readability.width).toBeGreaterThan(0);
  expect(readability.height).toBeGreaterThan(0);
  expect(readability.textFits, "Feedback text fits the production-CSS viewport").toBe(true);
  if (outcome.status === 401) await pw(page.getByRole("link", { name: "Vai al login", exact: true })).toBeVisible();
}

for (const width of [320, 390, 1440]) {
  for (const outcome of outcomes) {
    it(`sync ${outcome.name} at ${width}px restores keyboard focus after re-enable`, async () => {
      await withPendingSync(width, outcome, async (_page, trigger, complete) => {
        await complete();
        // Explicit document.activeElement identity (not just a focus CSS class).
        await pw.poll(() => trigger.evaluate(element => document.activeElement === element),
          { message: "Sync CTA must regain document.activeElement after completion" }).toBe(true);
      });
    }, 60000);

    it(`sync ${outcome.name} at ${width}px does not steal focus moved with Tab`, async () => {
      await withPendingSync(width, outcome, async (page, trigger, complete) => {
        await page.keyboard.press("Tab");
        const destination = await page.evaluateHandle(() => document.activeElement);
        try {
          expect(await destination.evaluate(element => element !== document.body && element !== null),
            "Tab must reach another real control while sync is pending").toBe(true);
          expect(await trigger.evaluate(element => document.activeElement === element)).toBe(false);
          await complete();
          // Flush post-render effects/animation-frame focus callbacks too.
          await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
          expect(await destination.evaluate(element => document.activeElement === element),
            "The exact user-selected element must keep document.activeElement").toBe(true);
          expect(await trigger.evaluate(element => document.activeElement === element)).toBe(false);
        } finally { await destination.dispose(); }
      });
    }, 60000);

    it(`sync ${outcome.name} at ${width}px exposes readable announced outcome feedback`, async () => {
      await withPendingSync(width, outcome, async (page, _trigger, complete) => {
        await complete();
        await assertReadableFeedback(page, outcome);
      });
    }, 60000);
  }
}
