import { it, expect } from "vitest";
import { expect as pw } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { diaryUrl, withDiaryBrowser } from "./helpers/diary-harness";

it("each meal + preserves the selected date and slot through save and restores focus after the feed reload", async () => {
  await withDiaryBrowser(async page => {
    const entries: Record<string, unknown>[] = [];
    const writes: Record<string, unknown>[] = [];
    await page.route("**/api/v1/**", async route => {
      const req = route.request();
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
      const dialog = page.getByRole("dialog");
      await pw(dialog.getByRole("combobox", { name: "Pasto" })).toHaveValue(slot);
      await pw(dialog.getByLabel("Data", { exact: true })).toHaveValue("2026-10-05");
      await dialog.getByLabel("Nome alimento").fill(`Alimento ${slot}`);
      await dialog.getByLabel("Quantità in grammi").fill("100");
      await dialog.getByLabel("Kcal totali").fill("200");
      await dialog.getByRole("button", { name: "Salva voce" }).click();
      await pw(dialog).not.toBeVisible();
      await pw(page.locator(`[data-add-slot="${slot}"]`)).toBeFocused();
    }
    expect(writes.map(write => [write.date, write.slot])).toEqual(slots.map(slot => ["2026-10-05", slot]));
    const trigger = page.locator('[data-add-slot="Breakfast"]');
    await trigger.click(); await page.keyboard.press("Escape"); await pw(trigger).toBeFocused();
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
