import { it, expect } from "vitest";
import { expect as pw } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { diaryUrl, withDiaryBrowser } from "./helpers/diary-harness";

it.skipIf(process.env.DIARY_VISUAL_CSS !== "1")("production CSS: prefilled food/recipe edit dialogs fit mobile and desktop", async () => {
  await withDiaryBrowser(async page => {
    const entries = ["food", "recipe"].map(type => ({ id: type, date: "2026-09-29", slot: "Lunch", entryType: type, name: type === "food" ? "Yogurt" : "Pasta al pomodoro", quantityGrams: type === "food" ? 125 : null, servings: type === "recipe" ? 2 : null, foodId: type === "food" ? "food-1" : null, recipeId: type === "recipe" ? "recipe-1" : null, kcal: 320, source: "manual", norishDeleted: false, protein: null, carbs: null, fat: null }));
    await page.route("**/api/v1/**", route => route.fulfill({ json: route.request().url().includes("/catalog") ? { foods: [], recipes: [{ id: "recipe-1", name: "Pasta al pomodoro", servings: 4, kcalPerServing: 160 }] } : { entries, sync: null, target: null } }));
    await page.goto(diaryUrl(page));
    const dir = process.env.DIARY_EVIDENCE_DIR ?? "../diary-ui-evidence";
    await mkdir(dir, { recursive: true });
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      for (const type of ["food", "recipe"]) {
        const trigger = page.locator(`[data-edit-id="${type}"]`);
        await trigger.click();
        const dialog = page.getByRole("dialog", { name: "Modifica voce" });
        const geometry = await dialog.evaluate(el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, scroll: el.scrollWidth, client: el.clientWidth }; });
        expect(geometry.left).toBeGreaterThanOrEqual(8);
        expect(geometry.right).toBeLessThanOrEqual(width - 8);
        expect(geometry.scroll).toBeLessThanOrEqual(geometry.client);
        await dialog.getByRole("button", { name: "Chiudi" }).focus();
        await page.screenshot({ path: `${dir}/${width}-edit-${type}.png` });
        await page.keyboard.press("Escape");
        await pw(trigger).toBeFocused();
      }
    }
  });
}, 600000);

it.skipIf(process.env.DIARY_VISUAL_CSS !== "1")("production CSS: dialogs reflow320/390/1440, AA contrast, focus trap and restore", async () => {
  const report: unknown[] = [];
  await withDiaryBrowser(async page => {
    await page.route("**/api/v1/**", route => route.fulfill({ json: route.request().url().includes("/catalog") ? { foods: [], recipes: [{ id: "recipe-1", name: "Ricetta con un nome molto lungo per controllare la leggibilità", servings: 2, kcalPerServing: null }] } : { entries: [], sync: null, target: null } }));
    await page.goto(diaryUrl(page));
    const trigger = page.getByRole("button", { name: "Aggiungi voce", exact: true });
    const dir = process.env.DIARY_EVIDENCE_DIR ?? "../diary-ui-evidence";
    await mkdir(dir, { recursive: true });
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      await trigger.click();
      const dialog = page.getByRole("dialog");
      for (const type of ["food", "recipe"]) {
        await dialog.getByRole("combobox", { name: "Tipo di voce" }).selectOption(type);
        if (type === "recipe") {
          await dialog.getByRole("combobox", { name: "Ricetta", exact: true }).selectOption("recipe-1");
          await pw(dialog.locator(".selected-recipe")).toHaveText("Ricetta con un nome molto lungo per controllare la leggibilità");
        }
        const geometry = await dialog.evaluate(el => {
          const r = el.getBoundingClientRect();
          return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, viewport: innerWidth, scroll: el.scrollWidth, client: el.clientWidth, pageScroll: document.documentElement.scrollWidth };
        });
        expect(geometry.scroll).toBeLessThanOrEqual(geometry.client);
        expect(geometry.pageScroll).toBeLessThanOrEqual(width);
        expect(geometry.left).toBeGreaterThanOrEqual(8);
        expect(geometry.right).toBeLessThanOrEqual(width - 8);
        expect(Math.abs((geometry.left + geometry.right) / 2 - width / 2)).toBeLessThan(2);
        const contrast = await dialog.evaluate(el => {
          const rgb = (s: string) => s.match(/[\d.]+/g)!.slice(0, 3).map(Number);
          const luminance = (v: number[]) => v.map(n => { const c = n / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; }).reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
          const bg = luminance(rgb(getComputedStyle(el).backgroundColor));
          return Array.from(el.querySelectorAll('label, .form-help, h2, button')).map(node => {
            const style = getComputedStyle(node);
            const ownBg = style.backgroundColor === 'rgba(0, 0, 0, 0)' ? bg : luminance(rgb(style.backgroundColor));
            const fg = luminance(rgb(style.color));
            return { text: node.textContent, ratio: (Math.max(ownBg, fg) + .05) / (Math.min(ownBg, fg) + .05) };
          });
        });
        contrast.forEach(c => expect(c.ratio).toBeGreaterThanOrEqual(4.5));
        await dialog.getByRole("button", { name: "Salva voce" }).focus();
        await page.keyboard.press("Tab");
        expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true);
        const outline = await page.locator(":focus").evaluate(el => getComputedStyle(el).outlineWidth);
        expect(parseFloat(outline)).toBeGreaterThanOrEqual(3);
        await page.screenshot({ path: `${dir}/${width}-${type}.png` });
        report.push({ width, type, geometry, contrast });
      }
      await page.keyboard.press("Escape");
      await pw(trigger).toBeFocused();
    }
    await writeFile(`${dir}/visual-report.json`, JSON.stringify(report, null, 2));
  });
}, 600000);
