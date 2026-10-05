import { it } from "vitest";
import { expect as pw } from "@playwright/test";
import { withDiaryBrowser, diaryUrl } from "./helpers/diary-harness";

it("preserves authenticated topbar and profile target alongside diary actions", async () => {
  await withDiaryBrowser(async page => {
    await page.route("**/api/v1/diary?**", route => route.fulfill({ json: { entries: [], sync: null, target: 2100 } }));
    await page.goto(diaryUrl(page));
    await pw(page.locator(".energy-number")).toBeVisible();
    await pw(page.getByRole("link", { name: "Impostazioni", exact: true })).toHaveAttribute("href", "/settings", { timeout: 5000 });
    await pw(page.getByRole("button", { name: "Esci", exact: true })).toBeVisible();
    await pw(page.getByRole("link", { name: "Modifica obiettivo", exact: true })).toHaveAttribute("href", "/profile");
    await pw(page.locator(".energy-card")).toContainText("Obiettivo: 2100 kcal");
    await pw(page.getByRole("button", { name: "Sincronizza ora", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Aggiungi voce", exact: true }).click();
    await pw(page.getByRole("dialog", { name: "Aggiungi voce", exact: true })).toBeVisible();
  }, "dashboard");
}, 60000);
