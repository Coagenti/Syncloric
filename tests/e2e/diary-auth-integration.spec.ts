import { it } from "vitest";
import { expect as pw } from "@playwright/test";
import { withDiaryBrowser, diaryUrl } from "./helpers/diary-harness";

it("preserves authenticated topbar and profile target alongside diary actions", async () => {
  await withDiaryBrowser(async page => {
    await page.setViewportSize({ width: 1440, height: 950 });
    await page.route("**/api/v1/diary?**", route => route.fulfill({ json: { entries: [], sync: null, target: 2100 } }));
    await page.goto(diaryUrl(page));
    await pw(page.locator(".energy-number")).toBeVisible();
    await page.getByRole("button", { name: "Menu profilo" }).click(); await pw(page.getByRole("menuitem", { name: "Impostazioni", exact: true })).toHaveAttribute("href", "/settings");
    await pw(page.getByRole("menuitem", { name: "Esci", exact: true })).toBeVisible();
    await pw(page.getByRole("link", { name: "Modifica obiettivo", exact: true })).toHaveAttribute("href", "/profile#obiettivo");
    await pw(page.locator(".energy-target")).toHaveText("2.100 kcal");
    await pw(page.getByRole("button", { name: "Sincronizza ora", exact: true })).toBeEnabled();
    await pw(page.getByRole("button", { name: "Aggiungi voce", exact: true })).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await pw(page.getByRole("navigation", { name: "Navigazione mobile" }).getByRole("link", { name: "Diario", exact: true })).toHaveAttribute("href", "/diary");
  }, "dashboard");
}, 60000);
