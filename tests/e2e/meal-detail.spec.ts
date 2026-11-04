import { it, expect } from "vitest";
import { expect as pw } from "@playwright/test";
import { diaryUrl, withDiaryBrowser } from "./helpers/diary-harness";

const date = "2026-09-29";
const food = { id: "food", date, slot: "Breakfast", entryType: "food", name: "Yogurt", quantityGrams: 100, kcal: 100, nutrients: { protein: 10, carbs: 0, fat: 2, vitaminC: 20 }, source: "manual", norishDeleted: false };
const imported = { ...food, id: "imported", slot: "Lunch", entryType: "recipe", name: "Bowl Norish", quantityGrams: null, servings: 2, source: "norish_sync" };

it("compact meal cards expose honest totals and open nutrition and editable entries on a real page", async () => {
  await withDiaryBrowser(async page => {
    await page.route("**/api/v1/**", route => route.fulfill({ json: { entries: [food, { ...food, id: "unknown", name: "Valori assenti", kcal: null, nutrients: {} }, imported], target: 2000, sync: null, recipes: [], foods: [] } }));
    await page.goto(diaryUrl(page) + "/diary");
    await pw(page.locator(".diary-meal-link")).toHaveCount(4);
    await pw(page.locator(".entry-row")).toHaveCount(0);
    const breakfast = page.getByRole("region", { name: "Colazione", exact: true });
    await pw(breakfast.locator(".meal-energy")).toContainText("100");
    await pw(breakfast.locator(".meal-macro-carbs dd")).toHaveText("0 g");
    await pw(breakfast.locator(".meal-macro-protein .meal-partial")).toHaveText("Parziale");
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      if (process.env.DIARY_VISUAL_CSS === "1") {
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        const target = await breakfast.locator(".meal-add").boundingBox();
        expect(target!.width).toBeGreaterThanOrEqual(44); expect(target!.height).toBeGreaterThanOrEqual(44);
      }
    }
    await breakfast.getByRole("link", { name: "Apri Colazione", exact: true }).click();
    await pw(page).toHaveURL(/\/diary\/meal\?date=2026-09-29&slot=Breakfast$/);
    await pw(page.getByRole("heading", { name: "Colazione.", exact: true })).toBeVisible();
    await pw(page.locator(".meal-micronutrients")).toContainText("Vitamina C");
    await pw(page.locator(".entry-row")).toHaveCount(2);
    const row = page.locator(".entry-row").filter({ hasText: "Yogurt" });
    await pw(row.getByRole("button", { name: "Modifica", exact: true })).toBeVisible();
    await pw(row.getByRole("button", { name: "Elimina", exact: true })).toBeVisible();
    await pw(row.getByRole("button", { name: "Duplica", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Torna al diario", exact: true }).click();
    await pw(page).toHaveURL(/\/diary\?date=2026-09-29$/);
    await pw(page.locator(".diary-meal-link")).toHaveCount(4);
    await page.getByRole("link", { name: "Apri Cena", exact: true }).click();
    await pw(page.locator(".meal-energy")).toHaveText("0 kcal");
    await pw(page.getByText("Nessuna voce in questo pasto.", { exact: true })).toBeVisible();
    await page.locator('[data-add-slot="Dinner"]').click();
    await pw(page).toHaveURL(/\/diary\/add\?date=2026-09-29&slot=Dinner(?:#ricerca)?$/);
  });
}, 60000);

it("duplicates imported rows once into a selected destination, preserving the source and restoring focus", async () => {
  await withDiaryBrowser(async page => {
    const entries: Record<string, unknown>[] = [imported];
    let release: (() => void) | undefined;
    const writes: unknown[] = [];
    await page.route("**/api/v1/**", async route => {
      if (route.request().method() === "POST") {
        const body = route.request().postDataJSON(); writes.push(body);
        await new Promise<void>(resolve => { release = resolve; });
        entries.push({ ...imported, ...body, id: "copy", source: "manual", copiedMeal: true });
        return route.fulfill({ status: 201, json: { id: "copy", ...body } });
      }
      return route.fulfill({ json: { entries, target: 2000, sync: null, foods: [], recipes: [] } });
    });
    await page.goto(diaryUrl(page) + `/diary/meal?date=${date}&slot=Lunch`);
    const source = page.locator(".entry-row").filter({ hasText: "Bowl Norish" });
    await pw(source.getByRole("button", { name: "Modifica", exact: true })).toHaveCount(0);
    await pw(source.getByRole("button", { name: "Elimina", exact: true })).toHaveCount(0);
    const trigger = source.getByRole("button", { name: "Duplica", exact: true });
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "Duplica voce", exact: true });
    await dialog.getByLabel("Data di destinazione").fill("2026-09-30");
    await dialog.getByLabel("Pasto di destinazione").selectOption("Dinner");
    await dialog.getByRole("button", { name: "Duplica voce", exact: true }).click();
    await pw.poll(() => writes.length).toBe(1);
    await pw(dialog.getByRole("button", { name: "Duplicazione…", exact: true })).toBeDisabled();
    await page.keyboard.press("Escape"); await pw(dialog).toBeVisible();
    release?.(); await pw(dialog).not.toBeVisible(); await pw(trigger).toBeFocused();
    expect(writes).toEqual([{ date: "2026-09-30", slot: "Dinner" }]);
    await page.getByRole("link", { name: "Apri il pasto di destinazione", exact: true }).click();
    const copy = page.locator(".entry-row");
    await pw(copy).toHaveCount(1); await pw(copy).toContainText("Bowl Norish");
    await pw(copy.getByRole("button", { name: "Modifica", exact: true })).toBeVisible();
    await pw(copy.getByRole("button", { name: "Elimina", exact: true })).toBeVisible();
    await pw(copy.getByRole("button", { name: "Duplica", exact: true })).toBeVisible();
    expect(entries[0]).toMatchObject(imported);
  });
}, 60000);

it("keeps duplicate destination inputs on failure and offers login without losing the original", async () => {
  await withDiaryBrowser(async page => {
    let status = 401;
    await page.route("**/api/v1/**", route => route.fulfill(route.request().method() === "POST" ? { status, json: { error: "private server error" } } : { json: { entries: [food], target: null, sync: null } }));
    await page.goto(diaryUrl(page) + `/diary/meal?date=${date}&slot=Breakfast`);
    const trigger = page.getByRole("button", { name: "Duplica", exact: true }); await trigger.click();
    const dialog = page.getByRole("dialog", { name: "Duplica voce", exact: true });
    await dialog.getByLabel("Pasto di destinazione").selectOption("Snack");
    await dialog.getByRole("button", { name: "Duplica voce", exact: true }).click();
    await pw(dialog.getByRole("alert")).toContainText("Accedi per duplicare");
    await pw(dialog.getByLabel("Pasto di destinazione")).toHaveValue("Snack");
    await pw(dialog.getByRole("link", { name: "Vai al login", exact: true })).toBeVisible();
    await pw(dialog).not.toContainText("private server error");
    status = 200;
    await dialog.getByRole("button", { name: "Duplica voce", exact: true }).click();
    await pw(dialog.getByRole("alert")).toContainText("Duplicazione non verificata");
    await pw(page.getByText("Voce duplicata.", { exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape"); await pw(trigger).toBeFocused();
    await pw(page.locator(".entry-row")).toHaveCount(1);
  });
}, 60000);
