import { test, expect } from "@playwright/test";

const origin = "http://127.0.0.1:3177";
const meal = { id: "meal-1", date: "2026-09-29", slot: "Lunch", entryType: "recipe", name: "Ricetta Norish", quantityGrams: null, servings: 1, kcal: 458, protein: null, fat: null, carbs: null, source: "norish_sync", norishDeleted: false };

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-09-29T12:00:00"));
});

test("calendar → sync feed → dashboard and diary display real kcal without demo storage", async ({ page }) => {
  await page.route("**/api/v1/diary?month=*", async (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ entries: [meal], sync: { status: "ok", reason: null, origin: null }, target: null }) }));
  await page.goto(`${origin}/calendar`);
  await expect(page.getByRole("region", { name: "Pasti importati nella data selezionata" })).toContainText("458 kcal");
  await page.getByRole("link", { name: "Oggi" }).first().click();
  await expect(page.getByRole("region", { name: "Bilancio energetico" })).toContainText("458");
  await page.getByRole("link", { name: "Diario" }).first().click();
  await expect(page.getByRole("region", { name: "Pranzo" })).toContainText("Ricetta Norish");
  await expect(page.getByRole("region", { name: "Pranzo" })).toContainText("458");
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
});

test("auth failure shows reassociation link and does not mutate credentials", async ({ page }) => {
  const writes: string[] = [];
  page.on("request", (request) => { if (request.method() !== "GET") writes.push(`${request.method()} ${request.url()}`); });
  await page.route("**/api/v1/diary?month=*", async (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ entries: [], sync: { status: "error", reason: "auth", origin: "https://norish.example.invalid" }, target: null }) }));
  await page.goto(`${origin}/dashboard`);
  await expect(page.locator('.demo-alert[role="alert"]')).toContainText("Norish ha rifiutato la chiave");
  await expect(page.getByRole("link", { name: "Impostazioni" })).toHaveAttribute("href", "/settings");
  expect(writes).toEqual([]);
});

test("anonymous browser never sees mock meals", async ({ page }) => {
  await page.route("**/api/v1/diary?month=*", async (route) => route.fulfill({ status: 401, contentType: "application/json", body: '{"error":"Autenticazione richiesta"}' }));
  await page.goto(`${origin}/dashboard`);
  await expect(page.locator('p[role="alert"]')).toContainText("Accedi per visualizzare il tuo diario");
  await expect(page.getByText("Ricetta Norish")).toHaveCount(0);
});
