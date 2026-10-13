import { it, expect } from "vitest";
import { expect as pw } from "@playwright/test";
import { diaryUrl, withDiaryBrowser } from "./helpers/diary-harness";

it("all edit dialog close paths restore their trigger, including delayed saves", async () => {
  await withDiaryBrowser(async page => {
    const entry = { id: "manual-1", date: "2026-09-29", slot: "Lunch", entryType: "food", foodId: "food-1", recipeId: null, name: "Yogurt", quantityGrams: 125, servings: null, kcal: 80, source: "manual", norishDeleted: false, protein: null, fat: null, carbs: null };
    let release: (() => void) | undefined;
    let count = 0;
    await page.route("**/api/v1/**", async route => {
      if (route.request().url().includes("/catalog")) return route.fulfill({ json: { foods: [], recipes: [] } });
      if (route.request().method() !== "GET") {
        count++;
        await new Promise<void>(resolve => { release = resolve; });
        return route.fulfill({ status: route.request().method() === "POST" ? 201 : 200, json: { entry } });
      }
      return route.fulfill({ json: { entries: [entry], sync: null, target: null } });
    });
    await page.goto(diaryUrl(page));
    for (const mode of ["edit"]) {
      const trigger = mode === "add" ? page.locator('[data-add-slot="Lunch"]') : page.getByRole("button", { name: "Modifica", exact: true });
      for (const action of ["Escape", "Chiudi", "Annulla", "Salva voce"]) {
        await trigger.click();
        const dialog = page.getByRole("dialog");
        if (action === "Escape") await page.keyboard.press("Escape");
        else if (action !== "Salva voce") await dialog.getByRole("button", { name: action, exact: true }).click();
        else {
          if (mode === "add") {
            await dialog.getByRole("textbox", { name: "Nome alimento" }).fill("Yogurt");
            await dialog.getByRole("spinbutton", { name: "Quantità in grammi" }).fill("125");
            await dialog.getByRole("spinbutton", { name: "Kcal totali" }).fill("80");
          }
          const oldCount = count;
          await dialog.getByRole("button", { name: action }).click();
          await pw.poll(() => count).toBe(oldCount + 1);
          await pw(dialog.getByRole("button", { name: "Salvataggio…" })).toBeDisabled();
          await page.keyboard.press("Escape");
          await pw(dialog).toBeVisible();
          release?.();
        }
        await pw(dialog).not.toBeVisible();
        await pw(trigger).toBeFocused();
      }
    }
    expect(count).toBe(1);
  });
}, 600000);
