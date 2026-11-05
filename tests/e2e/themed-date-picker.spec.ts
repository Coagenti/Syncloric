import { it, expect } from "vitest";
import { expect as pw } from "@playwright/test";
import { diaryUrl, withDiaryBrowser } from "./helpers/diary-harness";

it("the themed calendar selects with keyboard, navigates months, dismisses and restores focus", async () => {
  await withDiaryBrowser(async page => {
    await page.route("**/api/v1/diary?**", route => route.fulfill({ json: { entries: [], target: 2000, sync: null } }));
    await page.goto(diaryUrl(page));
    const trigger = page.getByRole("button", { name: "Apri calendario", exact: true });
    const input = page.getByLabel("Seleziona data", { exact: true });
    await pw(input).toHaveValue("2026-09-29");
    await trigger.focus(); await page.keyboard.press("Enter");
    const popup = page.getByRole("dialog", { name: "Seleziona data", exact: true });
    await pw(popup).toBeVisible();
    await pw(popup.locator(".app-date-cell[data-selected]")).toBeFocused();
    await page.keyboard.press("ArrowRight"); await page.keyboard.press("Enter");
    await pw(popup).toBeHidden(); await pw(input).toHaveValue("2026-09-30");
    await pw(trigger).toBeFocused();
    await trigger.click();
    await popup.getByRole("button", { name: "Mese successivo" }).click();
    await pw(popup.getByRole("heading")).toHaveText("ottobre 2026");
    await popup.getByRole("button", { name: "Mese precedente" }).click();
    await pw(popup.getByRole("heading")).toHaveText("settembre 2026");
    await page.keyboard.press("Escape");
    await pw(input).toHaveValue("2026-09-30"); await pw(trigger).toBeFocused();
    await trigger.click(); await page.mouse.click(5, 5);
    await pw(popup).toBeHidden();
  }, "dashboard");
}, 60_000);

it("direct entry, leap days, month changes, reselecting a date and today keep the diary date coherent", async () => {
  await withDiaryBrowser(async page => {
    const months: string[] = [];
    await page.route("**/api/v1/diary?**", route => {
      months.push(new URL(route.request().url()).searchParams.get("month")!);
      return route.fulfill({ json: { entries: [], target: 2000, sync: null } });
    });
    await page.goto(diaryUrl(page));
    const input = page.locator(".app-date-picker input");
    await pw(input).toHaveValue("2026-09-29");
    await input.fill("2024-02-29");
    await input.click();
    const popup = page.getByRole("dialog", { name: "Seleziona data", exact: true });
    await pw(popup.getByRole("heading")).toHaveText("febbraio 2024");
    await pw(popup.locator(".app-date-cell[data-selected]")).toHaveText("29");
    await popup.locator(".app-date-cell[data-selected]").click();
    await pw(popup).toBeHidden(); await pw(input).toHaveValue("2024-02-29");
    await input.press("Alt+ArrowDown");
    await popup.getByRole("button", { name: "Mese successivo" }).click();
    await popup.locator(".app-date-cell:not([data-outside-month])").filter({ hasText: /^1$/ }).click();
    await pw(input).toHaveValue("2024-03-01"); await pw(popup).toBeHidden();
    await pw.poll(() => months).toContain("2024-03");
    await page.getByRole("button", { name: "Apri calendario", exact: true }).click();
    await popup.getByRole("button", { name: "Vai a oggi", exact: true }).click();
    await pw(input).toHaveValue("2026-09-29"); await pw(popup).toBeHidden();
    expect(months).toContain("2024-02");
  }, "dashboard");
}, 60_000);
