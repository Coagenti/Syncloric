import { test, expect } from "@playwright/test";

const origin = "http://127.0.0.1:3177";
const key = "syncloric-demo-diary-v1";

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-05T12:00:00"));
});

test("Oggi selects the local current day on first visit and after navigating from history", async ({ page }) => {
  await page.goto(`${origin}/dashboard`);
  await expect(page.getByLabel("Seleziona data")).toHaveValue("2026-11-05");
  await page.getByLabel("Seleziona data").fill("2026-09-29");
  await expect(page.getByText("Yogurt greco e mirtilli")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Riepilogo del giorno." })).toBeVisible();
  await page.getByRole("link", { name: "Diario" }).first().click();
  await expect(page.getByRole("heading", { name: "Diario." })).toBeVisible();
  await expect(page.getByLabel("Seleziona data")).toHaveValue("2026-09-29");
  await page.getByRole("link", { name: "Oggi" }).first().click();
  await expect(page.getByRole("heading", { name: "Riepilogo del giorno." })).toBeVisible();
  await expect(page.getByLabel("Seleziona data")).toHaveValue("2026-11-05");
});

test("manual add, validation and edit persist after reload", async ({ page }) => {
  await page.goto(`${origin}/diary`);
  await page.getByRole("button", { name: "Oggi" }).click();
  await expect(page.getByLabel("Seleziona data")).toHaveValue("2026-11-05");
  await page.getByRole("region", { name: "Colazione" }).getByRole("button", { name: "Aggiungi voce" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nome del cibo o della ricetta").fill("Avena");
  await dialog.getByLabel("Quantità (g o porzioni)").fill("-1");
  await dialog.getByLabel("Kcal totali").fill("190");
  await dialog.getByRole("button", { name: "Salva voce" }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Quantità (g o porzioni)").fill("50");
  await dialog.getByRole("button", { name: "Salva voce" }).click();
  await expect(page.getByRole("status")).toContainText("Modifiche salvate in questo browser");
  await page.getByRole("button", { name: "Modifica Avena" }).click();
  await dialog.getByLabel("Nome del cibo o della ricetta").fill("Avena integrale");
  await dialog.getByLabel("Kcal totali").fill("205");
  await dialog.getByRole("button", { name: "Salva voce" }).click();
  await page.reload();
  await expect(page.getByText("Avena integrale")).toBeVisible();
  await expect(page.getByRole("region", { name: "Colazione" })).toContainText("205");
});

test("calendar selection shows imported meals for the selected date", async ({ page }) => {
  await page.goto(`${origin}/calendar`);
  await expect(page.getByLabel("Seleziona data")).toHaveValue("2026-11-05");
  await page.getByLabel("Seleziona data").fill("2026-09-29");
  await expect(page.getByRole("heading", { name: "settembre 2026" })).toBeVisible();
  await page.getByRole("button", { name: /2 ottobre 2026, 1 pasti importati/ }).click();
  await expect(page.getByLabel("Seleziona data")).toHaveValue("2026-10-02");
  await expect(page.getByRole("region", { name: "Pasti importati nella data selezionata" })).toContainText("Insalata mediterranea");
});

test("failed storage writes keep edits visible but never claim persistence", async ({ page }) => {
  await page.addInitScript((storageKey) => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === storageKey) throw new DOMException("quota", "QuotaExceededError");
      return original.call(this, name, value);
    };
  }, key);
  await page.goto(`${origin}/diary`);
  await page.getByRole("region", { name: "Colazione" }).getByRole("button", { name: "Aggiungi voce" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nome del cibo o della ricetta").fill("Non persistito");
  await dialog.getByLabel("Kcal totali").fill("0");
  await dialog.getByRole("button", { name: "Salva voce" }).click();
  await expect(page.getByText("Non persistito")).toBeVisible();
  await expect(page.getByRole("status")).toContainText("non salvate nel browser");
  await expect(page.getByRole("status")).not.toContainText("Modifiche salvate");
  await page.reload();
  await expect(page.getByText("Non persistito")).toHaveCount(0);
});
