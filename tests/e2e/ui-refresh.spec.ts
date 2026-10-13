import { it, expect } from "vitest";
import { expect as pw } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { diaryUrl, withDiaryBrowser } from "./helpers/diary-harness";

it("each meal + opens a dedicated view and preserves the selected date and slot through save", async () => {
  await withDiaryBrowser(async page => {
    const entries: Record<string, unknown>[] = [];
    const writes: Record<string, unknown>[] = [];
    await page.route("**/api/v1/**", async route => {
      const req = route.request();
      if (req.url().includes("/frequent")) return route.fulfill({ json: { foods: [] } });
      if (req.url().includes("/catalog")) return route.fulfill({ json: { foods: [], recipes: [] } });
      if (req.method() === "POST") {
        const body = req.postDataJSON(); writes.push(body);
        entries.push({ ...body, id: `entry-${writes.length}`, source: "manual", norishDeleted: false });
        return route.fulfill({ status: 201, json: { entry: entries.at(-1) } });
      }
      return route.fulfill({ json: { entries, sync: null, target: 2000 } });
    });
    await page.goto(diaryUrl(page));
    await page.getByLabel("Seleziona data").fill("2026-10-05");
    const slots = ["Breakfast", "Lunch", "Snack", "Dinner"];
    for (const slot of slots) {
      const trigger = page.locator(`[data-add-slot="${slot}"]`);
      await trigger.click();
      await pw(page.getByLabel("Pasto", { exact: true })).toHaveValue(slot);
      await pw(page.getByLabel("Data inserimento", { exact: true })).toHaveValue("2026-10-05");
      await page.getByRole("button", { name: "Inserisci un alimento manualmente" }).click();
      await page.getByLabel("Nome alimento", { exact: true }).fill(`Alimento ${slot}`);
      await page.getByLabel("Quantità in grammi", { exact: true }).fill("100");
      await page.getByLabel("Kcal per 100 g", { exact: true }).fill("200");
      await page.getByRole("button", { name: /^Aggiungi a / }).click();
      await pw(page.getByRole("status")).toContainText("aggiunto");
      await page.getByRole("link", { name: "Fine", exact: true }).click();
    }
    expect(writes.map(write => [write.date, write.slot])).toEqual(slots.map(slot => ["2026-10-05", slot]));
    if (process.env.DIARY_VISUAL_CSS === "1") {
      const dir = process.env.UI_EVIDENCE_DIR ?? "test-results/ui-refresh";
      await mkdir(dir, { recursive: true });
      for (const width of [320, 390, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.evaluate(() => window.scrollTo(0, 0));
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        await page.screenshot({ path: path.join(dir, `diary-${width}.png`), fullPage: true });
      }
    }
  });
}, 60_000);

it.skipIf(process.env.DIARY_VISUAL_CSS !== "1")("production dashboard: layered animated gauge fits mobile/desktop, empty/unknown/over-target totals and reduced motion", async () => {
  await withDiaryBrowser(async page => {
    let consumed: number | null = 1260;
    let target: number | null = 2000;
    await page.route("**/api/v1/**", route => route.fulfill({ json: {
      entries: [{ id: "fixture", date: "2026-09-29", slot: "Lunch", entryType: "food", name: "Pasto di esempio", quantityGrams: 100, kcal: consumed, source: "manual", norishDeleted: false }], sync: null, target,
    } }));
    const dir = process.env.UI_EVIDENCE_DIR ?? "test-results/ui-refresh";
    await mkdir(dir, { recursive: true });
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(diaryUrl(page));
      await pw(page.locator(".energy-number")).toHaveText("1.260");
      await pw(page.locator(".gauge-fill")).toBeVisible();
      await pw.poll(() => page.locator(".gauge-fill").evaluate(el => Number.parseFloat(getComputedStyle(el).strokeDashoffset))).toBeCloseTo(37, 0);
      const bounds = await page.locator(".energy-card").evaluate(el => ({ page: document.documentElement.scrollWidth, client: innerWidth, scroll: el.scrollWidth, width: el.clientWidth }));
      expect(bounds.page).toBeLessThanOrEqual(width); expect(bounds.scroll).toBeLessThanOrEqual(bounds.width);
      await page.screenshot({ path: path.join(dir, `dashboard-${width}.png`), fullPage: true });
    }
    consumed = 2500;
    await page.reload();
    await pw(page.locator(".energy-number")).toHaveText("2.500");
    await pw(page.locator(".energy-foot")).toContainText("125% registrato");
    await pw.poll(() => page.locator(".gauge-fill").evaluate(el => Number.parseFloat(getComputedStyle(el).strokeDashoffset))).toBeCloseTo(0, 0);
    consumed = null; target = null;
    await page.reload();
    await pw(page.locator(".energy-number")).toHaveText("0");
    await pw(page.getByText("1 voce senza kcal definite: non incluse nel totale.")).toBeVisible();
    await pw(page.getByRole("link", { name: "Configura obiettivo" })).toBeVisible();
    await page.emulateMedia({ reducedMotion: "reduce" });
    consumed = 1260; target = 2000; await page.reload();
    await pw(page.locator(".energy-number")).toHaveText("1.260");
    expect(await page.locator(".gauge-fill").evaluate(el => Number.parseFloat(getComputedStyle(el).animationDuration))).toBeLessThan(0.01);
    await pw.poll(() => page.locator(".gauge-fill").evaluate(el => Number.parseFloat(getComputedStyle(el).strokeDashoffset))).toBeCloseTo(37, 0);
  }, "dashboard");
}, 90_000);
