import { it, expect } from "vitest";
import { expect as pw } from "@playwright/test";
import { diaryUrl, withDiaryBrowser } from "./helpers/diary-harness";

it("debounces/aborts old food searches and sanitizes catalog parsing errors", async () => {
  await withDiaryBrowser(async page => {
    const queries: string[] = [];
    let release: (() => void) | undefined;
    await page.route("**/api/v1/**", async route => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith("/catalog")) {
        const query = url.searchParams.get("query");
        if (!query) return route.fulfill({ body: "raw SQL password", contentType: "application/json" });
        queries.push(query);
        if (query === "Ri") { await new Promise<void>(resolve => { release = resolve; }); }
        return route.fulfill({ json: { foods: [{ id: query, name: query === "Ri" ? "Riso vecchio" : "Pasta attuale", brand: null, kcalPer100g: 200 }], recipes: [] } }).catch(() => {});
      }
      return route.fulfill({ json: { entries: [], sync: null, target: null } });
    });
    await page.goto(diaryUrl(page));
    await page.locator('[data-add-slot="Lunch"]').click();
    const dialog = page.getByRole("dialog");
    await pw(dialog.getByRole("alert")).toContainText("Catalogo non disponibile");
    await pw(dialog).not.toContainText("JSON");
    const name = dialog.getByRole("textbox", { name: "Nome alimento" });
    // Pause ahead of page-clock delivery latency: 16ms measured idle/burn on QA;
    // +2000ms gives ~125x margin; constant offset preserves runFor(249)/runFor(1).
    await page.clock.install();
    await page.clock.pauseAt(new Date(Date.now() + 2000));
    await name.fill("R"); await name.fill("Ri");
    await page.clock.runFor(249);
    expect(queries).toEqual([]);
    await page.clock.runFor(1);
    await pw.poll(() => queries).toEqual(["Ri"]);
    await name.fill("Pa");
    await page.clock.runFor(250);
    await pw(dialog.getByRole("button", { name: "Pasta attuale · 200 kcal/100 g" })).toBeVisible();
    release?.();
    await pw(dialog.getByRole("button", { name: "Riso vecchio · 200 kcal/100 g" })).toHaveCount(0);
    expect(queries).toEqual(["Ri", "Pa"]);
  });
}, 600000);

it("dashboard refreshes a recipe addition with fractional servings and accepts unknown kcal", async () => {
  await withDiaryBrowser(async page => {
    const entries: unknown[] = [];
    await page.route("**/api/v1/**", route => {
      if (route.request().url().includes("/catalog")) return route.fulfill({ json: { foods: [], recipes: [{ id: "known", name: "Pasta", servings: 4, kcalPerServing: 320 }, { id: "unknown", name: "Zuppa", servings: 2, kcalPerServing: null }] } });
      if (route.request().method() === "POST") {
        const body = route.request().postDataJSON();
        const unknown = body.recipeId === "unknown";
        entries.push({ ...body, id: String(entries.length), name: unknown ? "Zuppa" : "Pasta", source: "manual", kcal: unknown ? null : Math.round(body.servings * 320), quantityGrams: null, protein: null, fat: null, carbs: null, norishDeleted: false });
        return route.fulfill({ status: 201, json: { entry: entries.at(-1) } });
      }
      return route.fulfill({ json: { entries, sync: null, target: null } });
    });
    await page.goto(diaryUrl(page));
    const trigger = page.locator('[data-add-slot="Lunch"]');
    for (const id of ["known", "unknown"]) {
      await page.goto(diaryUrl(page) + "/diary");
      await trigger.click();
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("combobox", { name: "Tipo di voce" }).selectOption("recipe");
      await dialog.getByRole("combobox", { name: "Ricetta", exact: true }).selectOption(id);
      await dialog.getByRole("spinbutton", { name: "Numero di porzioni" }).fill("1.5");
      if (id === "unknown") await pw(dialog).toContainText("Kcal totali: —");
      await dialog.getByRole("button", { name: "Salva voce" }).click();
      await pw(trigger).toBeFocused();
      await page.goto(diaryUrl(page) + "/dashboard");
      await pw(page.locator(".energy-number")).toContainText("480");
    }
    await pw(page.locator(".energy-card")).toContainText("1 voce senza kcal definite");
    await pw(page.locator(".meal-card").filter({ hasText: "Pranzo" })).toContainText("Pasta · Zuppa");
  }, "dashboard");
}, 600000);
