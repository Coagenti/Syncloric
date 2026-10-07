import { it, expect } from "vitest";
import { expect as pw } from "@playwright/test";
import { diaryUrl, withDiaryBrowser } from "./helpers/diary-harness";

it("feed parsing errors never expose server response text", async () => {
  await withDiaryBrowser(async page => {
    await page.route("**/api/v1/**", route => route.fulfill({ contentType: "application/json", body: "raw SQL password" }));
    await page.goto(diaryUrl(page));
    await pw(page.getByRole("alert")).toContainText("Impossibile caricare i pasti. Riprova.");
    await pw(page.locator("body")).not.toContainText("SQL");
  });
}, 600000);

it("sanitizes errors inline, offers login on401 and supports food PATCH without editing imports", async () => {
  await withDiaryBrowser(async page => {
    let status = 400;
    let message = "Alimento non trovato.";
    const writes: unknown[] = [];
    const entry = { id: "manual-1", name: "Yogurt", date: "2026-09-29", slot: "Snack", entryType: "food", quantityGrams: 125, kcal: 80, servings: null, foodId: "food-1", recipeId: null, source: "manual", norishDeleted: false, protein: null, carbs: null, fat: null };
    await page.route("**/api/v1/**", route => {
      const req = route.request();
      if (req.url().includes("/catalog")) return route.fulfill({ json: { foods: [], recipes: [] } });
      if (req.method() === "PATCH") { const body = req.postDataJSON(); writes.push(body); Object.assign(entry, body); return route.fulfill({ json: { entry } }); }
      if (req.method() === "POST") return status === 0 ? route.abort("failed") : route.fulfill({ status, json: { error: message } });
      return route.fulfill({ json: { entries: [entry, { ...entry, id: "import-1", name: "Importata", source: "norish_sync" }], sync: null, target: null } });
    });
    await page.goto(diaryUrl(page));
    await pw(page.locator(".entry-row").filter({ hasText: "Importata" }).getByRole("button", { name: "Modifica" })).toHaveCount(0);
    await page.locator('[data-add-slot="Lunch"]').click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox", { name: "Nome alimento" }).fill("Nuovo");
    await dialog.getByRole("spinbutton", { name: "Quantità in grammi" }).fill("125");
    await dialog.getByRole("spinbutton", { name: "Kcal totali" }).fill("80");
    const save = dialog.getByRole("button", { name: "Salva voce" });
    await save.click();
    await pw(dialog.getByRole("alert")).toContainText("Alimento non trovato");
    await pw(save).toBeFocused();
    message = "postgres password secret";
    await save.click();
    await pw(dialog.getByRole("alert")).toContainText("Controlla");
    await pw(dialog).not.toContainText("postgres");
    status = 500;
    await save.click();
    await pw(dialog.getByRole("alert")).toContainText("Non è stato possibile salvare");
    status = 0;
    await save.click();
    await pw(dialog.getByRole("alert")).toContainText("Connessione non disponibile");
    status = 401;
    await save.click();
    await pw(dialog.getByRole("link", { name: "Vai al login" })).toHaveAttribute("href", "/login");
    await dialog.getByRole("button", { name: "Annulla" }).click();
    const edit = page.locator(".entry-row").filter({ hasText: "Yogurt" }).getByRole("button", { name: "Modifica" });
    await edit.click();
    await pw(dialog.getByRole("textbox", { name: "Nome alimento" })).toHaveValue("Yogurt");
    await pw(dialog.getByRole("textbox", { name: "Nome alimento" })).toHaveAttribute("readonly", "");
    await dialog.getByRole("spinbutton", { name: "Quantità in grammi" }).fill("150");
    await dialog.getByRole("spinbutton", { name: "Kcal totali" }).fill("95");
    await save.click();
    await pw(dialog).not.toBeVisible();
    await pw(edit).toBeFocused();
    expect(writes).toEqual([{ date: "2026-09-29", slot: "Snack", quantityGrams: 150, kcal: 95 }]);
  });
}, 600000);
