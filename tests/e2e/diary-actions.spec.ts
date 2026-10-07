import { it, expect } from "vitest";
import { chromium, expect as pw } from "@playwright/test";
import { build } from "esbuild";
import { createServer } from "node:http";

it("adds inline food to the real diary and restores focus after asynchronous save", async () => {
  const bundle = await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import{CalorieApp}from'./src/components/calorie-app';createRoot(document.getElementById('root')).render(<CalorieApp view="diary"/>);`, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"', "process.env": '{}' } });
  const server = createServer((req, res) => { res.setHeader("Content-Type", req.url === "/app.js" ? "application/javascript" : "text/html"); res.end(req.url === "/app.js" ? bundle.outputFiles[0].text : '<html lang="it"><meta name="viewport" content="width=device-width"><div id="root"></div><script src="/app.js"></script></html>'); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.clock.setFixedTime(new Date("2026-09-29T12:00:00"));
    const entries: unknown[] = [];
    const writes: unknown[] = [];
    await page.route("**/api/v1/**", async route => {
      const req = route.request();
      if (req.url().includes("/catalog")) return route.fulfill({ json: { foods: req.url().includes("query=Ri") ? [{ id: "food-rice", name: "Riso", brand: null, kcalPer100g: 200, servingGrams: 100, servingLabel: null, source: "manual" }] : [], recipes: [{ id: "recipe-1", name: "Pasta", servings: 4, kcalPerServing: 320 }] } });
      if (req.method() === "POST") {
        const body = req.postDataJSON(); writes.push(body);
        entries.push({ ...body, name: body.name ?? (body.foodId ? "Riso" : "Pasta"), kcal: body.kcal ?? (body.foodId ? Math.round(body.quantityGrams * 2) : Math.round(body.servings * 320)), id: `manual-${entries.length + 1}`, source: "manual", norishDeleted: false, protein: null, fat: null, carbs: null, servings: body.servings ?? null, foodId: body.entryType === "food" ? "food-1" : null, recipeId: body.recipeId ?? null });
        return route.fulfill({ status: 201, json: { entry: entries[0] } });
      }
      if (req.method() === "PATCH") {
        const body = req.postDataJSON(); writes.push(body);
        const entry = entries.find(e => (e as { id: string }).id === req.url().split("/").pop()) as Record<string, unknown>;
        Object.assign(entry, body, { kcal: Math.round(body.servings * 320) });
        return route.fulfill({ json: { entry } });
      }
      return route.fulfill({ json: { entries, sync: null, target: null } });
    });
    await page.goto(`http://127.0.0.1:${(server.address() as { port: number }).port}`);
    const trigger = page.locator('[data-add-slot="Lunch"]');
    await trigger.click({ timeout: 10000 });
    const dialog = page.getByRole("dialog", { name: "Aggiungi voce" });
    await dialog.getByRole("textbox", { name: "Nome alimento" }).fill("Yogurt");
    await dialog.getByRole("spinbutton", { name: "Quantità in grammi" }).fill("125");
    await dialog.getByRole("spinbutton", { name: "Kcal totali" }).fill("80");
    await dialog.getByRole("combobox", { name: "Pasto" }).selectOption("Snack");
    await dialog.getByRole("button", { name: "Salva voce" }).click();
    await pw(dialog).not.toBeVisible();
    await pw(page.locator(".entry-row")).toContainText("Yogurt");
    await pw(page.locator(".entry-row")).toContainText("80");
    await pw(trigger).toBeFocused();
    expect(writes).toEqual([{ date: "2026-09-29", slot: "Snack", entryType: "food", name: "Yogurt", quantityGrams: 125, kcal: 80 }]);
    await trigger.click();
    await dialog.getByRole("combobox", { name: "Tipo di voce" }).selectOption("recipe");
    await dialog.getByRole("combobox", { name: "Ricetta" }).selectOption("recipe-1");
    await dialog.getByRole("spinbutton", { name: "Numero di porzioni" }).fill("2.5");
    await dialog.getByRole("button", { name: "Salva voce" }).click();
    await pw(page.locator(".entry-row").filter({ hasText: "Pasta" })).toContainText("800");
    expect(writes[1]).toEqual({ date: "2026-09-29", slot: "Lunch", entryType: "recipe", recipeId: "recipe-1", servings: 2.5 });
    const recipeRow = page.locator(".entry-row").filter({ hasText: "Pasta" });
    const edit = recipeRow.getByRole("button", { name: "Modifica" });
    await edit.click();
    const editor = page.getByRole("dialog", { name: "Modifica voce" });
    await pw(editor.getByRole("spinbutton", { name: "Numero di porzioni" })).toHaveValue("2.5");
    await editor.getByRole("spinbutton", { name: "Numero di porzioni" }).fill("1");
    await editor.getByRole("combobox", { name: "Pasto" }).selectOption("Dinner");
    await editor.getByRole("button", { name: "Salva voce" }).click();
    await pw(recipeRow).toContainText("320");
    await pw(recipeRow).toContainText("1 porzione");
    await pw(edit).toBeFocused();
    expect(writes[2]).toEqual({ date: "2026-09-29", slot: "Dinner", servings: 1 });
    await trigger.click();
    await dialog.getByRole("textbox", { name: "Nome alimento" }).fill("Ri");
    await dialog.getByRole("button", { name: "Riso · 200 kcal/100 g" }).click();
    await dialog.getByRole("spinbutton", { name: "Quantità in grammi" }).fill("150");
    await pw(dialog.getByRole("spinbutton", { name: "Kcal totali" })).toHaveValue("300");
    await dialog.getByRole("button", { name: "Salva voce" }).click();
    await pw(page.locator(".entry-row").filter({ hasText: "Riso" })).toContainText("300");
    expect(writes[3]).toEqual({ date: "2026-09-29", slot: "Lunch", entryType: "food", foodId: "food-rice", quantityGrams: 150 });
  } finally { await browser?.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
}, 600000);
