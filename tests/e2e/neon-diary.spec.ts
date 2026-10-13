import { it, expect } from "vitest";
import { expect as pw } from "@playwright/test";
import { diaryUrl, withDiaryBrowser } from "./helpers/diary-harness";

it("neon diary: icon actions, protected imports, confirmed DELETE, focus restoration and excess/remaining balance", async () => {
  await withDiaryBrowser(async page => {
    let entries = [
      { id: "manual", date: "2026-09-29", slot: "Breakfast", entryType: "food", name: "Yogurt", quantityGrams: 100, kcal: 800, source: "manual", norishDeleted: false },
      { id: "imported", date: "2026-09-29", slot: "Lunch", entryType: "recipe", name: "Bowl Norish", servings: 1, kcal: 1300, source: "norish_sync", norishDeleted: false },
    ];
    const deleted: string[] = []; let fail = true;
    await page.route("**/api/v1/**", async route => {
      const request = route.request();
      if (request.method() === "DELETE") {
        deleted.push(request.url());
        if (fail) return route.fulfill({ status: 403, json: { error: "Protected" } });
        entries = entries.filter(entry => entry.id !== "manual");
        return route.fulfill({ json: { ok: true } });
      }
      return route.fulfill({ json: { entries, sync: { status: "ok", reason: null, origin: null }, target: 1800, foods: [], recipes: [] } });
    });
    await page.goto(diaryUrl(page));
    await pw(page.getByRole("button", { name: "Aggiungi voce", exact: true })).toHaveCount(0);
    await pw(page.locator(".diary-balance")).toContainText("In eccesso"); await pw(page.locator(".energy-balance")).toContainText("300");
    await pw(page.locator(".diary-balance")).toHaveClass(/is-over-target/);
    await pw(page.locator(".sync-dot.ok")).toBeVisible();
    const imported = page.locator(".entry-row").filter({ hasText: "Bowl Norish" });
    await pw(imported.getByRole("button")).toHaveCount(0);
    const row = page.locator(".entry-row").filter({ hasText: "Yogurt" });
    await pw(row.getByRole("button", { name: "Modifica", exact: true }).locator("svg")).toBeVisible();
    expect(await row.getByRole("button", { name: "Modifica", exact: true }).textContent()).toBe("");
    const trash = row.getByRole("button", { name: "Elimina", exact: true });
    await trash.click(); const dialog = page.getByRole("dialog", { name: "Eliminare la voce?" });
    await pw(dialog.getByRole("button", { name: "Annulla" })).toBeFocused(); expect(deleted).toEqual([]);
    await page.keyboard.press("Escape"); await pw(trash).toBeFocused(); expect(deleted).toEqual([]);
    await trash.click(); await dialog.getByRole("button", { name: "Elimina voce" }).click();
    await pw(dialog.getByRole("alert")).toContainText("Questa voce non può essere eliminata.");
    await pw(row).toBeVisible(); await dialog.getByRole("button", { name: "Annulla" }).click();
    fail = false; await trash.click(); await dialog.getByRole("button", { name: "Elimina voce" }).click();
    await pw(dialog).not.toBeVisible(); await pw(row).toHaveCount(0);
    await pw(page.locator('[data-add-slot="Breakfast"]')).toBeFocused();
    await pw(page.locator(".diary-balance")).not.toHaveClass(/is-over-target/);
    await pw(page.locator(".energy-balance")).toContainText("Rimanenti"); await pw(page.locator(".energy-balance")).toContainText("500");
    expect(deleted).toHaveLength(2);
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 950 });
      if (process.env.DIARY_VISUAL_CSS === "1") expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await pw(page.getByRole("link", { name: "Scansiona", exact: true })).toBeVisible();
    }
  });
}, 60_000);
