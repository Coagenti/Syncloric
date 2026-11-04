import { it, expect } from "vitest";
import { expect as pw } from "@playwright/test";
import { diaryUrl, withDiaryBrowser } from "./helpers/diary-harness";

it("energy effects follow the balance, stay inside the filled arc and respect reduced motion", async () => {
  await withDiaryBrowser(async page => {
    let target: number | null = 2000;
    await page.route("**/api/v1/**", route => route.fulfill({ json: {
      entries: [2300, 1600, 2000].map((kcal, index) => ({ id: String(index), date: `2026-09-${29 - index}`, slot: "Lunch", entryType: "food", name: "Pasto", quantityGrams: 100, kcal, source: "manual", norishDeleted: false })),
      target, sync: null,
    } }));
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto(diaryUrl(page));
    const card = page.locator(".energy-card");
    const animations = () => page.evaluate(() => ({
      wave: getComputedStyle(document.querySelector(".gauge-wave")!).animationName,
      glitch: getComputedStyle(document.querySelector(".gauge-glitch")!).animationName,
      bar: getComputedStyle(document.querySelector(".energy-rule > span")!, "::after").animationName,
    }));
    await pw(card).toHaveClass(/is-over-target/);
    if (process.env.DIARY_VISUAL_CSS === "1") expect(await animations()).toEqual({ wave: "none", glitch: "energy-glitch", bar: "energy-glitch" });
    await page.getByRole("button", { name: "Giorno precedente" }).click();
    await pw(card).toHaveClass(/is-under-target/);
    await pw(page.locator(".gauge-art mask circle")).toHaveAttribute("stroke-dashoffset", "20");
    expect(await page.locator(".gauge-wave").evaluate(element => {
      const id = element.parentElement!.getAttribute("mask")!.slice(5, -1);
      return document.getElementById(id)?.tagName;
    })).toBe("mask");
    if (process.env.DIARY_VISUAL_CSS === "1") {
      expect(await animations()).toEqual({ wave: "gauge-wave", glitch: "none", bar: "energy-wave" });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await pw(page.locator("html")).toHaveAttribute("data-motion", "reduce");
      expect(await animations()).toEqual({ wave: "none", glitch: "none", bar: "none" });
    }
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await pw(page.locator("html")).toHaveAttribute("data-motion", "full");
    await page.getByRole("button", { name: "Giorno precedente" }).click();
    await pw(card).toContainText("Obiettivo raggiunto");
    await pw(card).not.toHaveClass(/is-(under|over)-target/);
    if (process.env.DIARY_VISUAL_CSS === "1") expect(await animations()).toEqual({ wave: "none", glitch: "none", bar: "none" });
    target = null;
    // Reload the target with the next monthly feed, rather than a cached day.
    await page.getByLabel("Seleziona data", { exact: true }).fill("2026-08-31");
    await pw(card).toContainText("Obiettivo non configurato");
    await pw(card).not.toHaveClass(/is-(under|over)-target/);
  }, "dashboard");
}, 60_000);
