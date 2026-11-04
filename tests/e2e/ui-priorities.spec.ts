import { it, expect } from "vitest";
import { expect as pw } from "@playwright/test";
import { diaryUrl, withDiaryBrowser } from "./helpers/diary-harness";
const date = "2026-09-29";
const entry = (id: string, protein?: number) => ({ id, date, slot: "Lunch", entryType: "food", name: id, quantityGrams: 100, kcal: 100, source: "manual", norishDeleted: false, nutrients: protein === undefined ? {} : { protein } });

it("manual creation puts product fields before quantity and confirmation without focusing the input", async () => {
  await withDiaryBrowser(async page => {
    await page.route("**/api/v1/**", route => route.fulfill({ json: { foods: [], recipes: [] } }));
    await page.goto(diaryUrl(page) + `/diary/add?date=${date}&slot=Lunch`);
    await page.getByRole("button", { name: "Inserisci un alimento manualmente" }).click();
    const name = page.getByLabel("Nome alimento", { exact: true });
    await pw(name).toBeVisible(); await pw(name).not.toBeFocused();
    expect(await name.evaluate(element => !!(element.compareDocumentPosition(document.querySelector('.food-quantity-fields input')!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
    expect(await name.evaluate(element => !!(element.compareDocumentPosition(document.querySelector('.food-save')!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
    await pw(page.getByRole("button", { name: "Chiudi modifica", exact: true })).toHaveCount(0);
  });
});

it("partial macros stay visible on mobile; zero is known and all-missing values stay unknown", async () => {
  await withDiaryBrowser(async page => {
    let entries = [entry("Noto", 10), entry("Sconosciuto")];
    await page.route("**/api/v1/**", route => route.fulfill({ json: { entries, target: 2000, sync: null } }));
    await page.goto(diaryUrl(page) + "/dashboard");
    await pw(page.locator(".macro-protein .macro-partial")).toHaveText("Parziale");
    await page.locator(".nutrition-summary .extra-nutrients summary").click();
    await pw(page.locator(".macro-completeness")).toContainText("Proteine: 1/2 voci con dati");
    entries = [entry("Zero noto", 0), entry("Altro zero", 0)]; await page.reload();
    await pw(page.locator(".macro-protein .macro-amount-full")).toContainText("0");
    await pw(page.locator(".macro-partial")).toHaveCount(0);
    entries = [entry("Sconosciuto")]; await page.reload();
    await pw(page.locator(".macro-protein .macro-amount-full")).toContainText("—");
    await pw(page.locator(".macro-partial")).toHaveCount(0);
  }, "dashboard");
});

it("calendar includes manual, copied and imported entries and can filter Norish", async () => {
  await withDiaryBrowser(async page => {
    const entries = [entry("Manuale", 10), { ...entry("Importato"), source: "norish_sync", kcal: 200 }, { ...entry("Copia"), copiedMeal: true, kcal: 50 }, { ...entry("Senza kcal"), kcal: null }];
    await page.route("**/api/v1/**", route => route.fulfill({ json: { entries, target: 2000, sync: null } }));
    await page.goto(diaryUrl(page) + "/calendar");
    await pw(page.locator(".calendar-import")).toHaveCount(4);
    await pw(page.locator(".calendar-day-summary")).toContainText("350 kcal note");
    await pw(page.locator(".calendar-list .data-note")).toContainText("totale parziale");
    await page.getByLabel("Filtra pasti nel calendario").selectOption("norish");
    await pw(page.locator(".calendar-import")).toHaveCount(1);
    await pw(page.locator(".calendar-import")).toContainText("Importato");
    await pw(page.locator(".calendar-day-summary")).toContainText("200 kcal note");
    await page.getByLabel("Filtra pasti nel calendario").selectOption("all");
    await pw(page.locator(".calendar-import")).toHaveCount(4);
  }, "calendar");
});

it("same-month navigation uses the loaded feed; new months use skeletons and refresh keeps data", async () => {
  await withDiaryBrowser(async page => {
    let requests = 0, defer = false, release: (() => void) | undefined;
    await page.route("**/api/v1/**", async route => {
      const url = new URL(route.request().url());
      if (url.pathname === "/api/v1/sync") return route.fulfill({ json: { status: "ok", reason: null, origin: null } });
      if (url.pathname !== "/api/v1/diary") return route.fulfill({ json: {} });
      requests++; const request = requests;
      if (defer) await new Promise<void>(resolve => { release = resolve; });
      return route.fulfill({ json: { entries: [{ ...entry("Dato caricato", 10), date: url.searchParams.get("month") === "2026-08" ? "2026-08-31" : date, kcal: request === 3 ? 200 : 100 }], target: 2000, sync: null } });
    });
    await page.goto(diaryUrl(page) + "/dashboard");
    await pw(page.locator(".energy-number")).toHaveText("100");
    await page.getByLabel("Giorno precedente", { exact: true }).click();
    await pw(page.locator(".energy-number")).toHaveText("0"); expect(requests).toBe(1);
    await page.getByLabel("Giorno successivo", { exact: true }).click();
    await pw(page.locator(".energy-number")).toHaveText("100"); expect(requests).toBe(1);
    defer = true; await page.getByLabel("Seleziona data", { exact: true }).fill("2026-08-31");
    await pw(page.locator(".diary-loading")).toBeVisible(); await pw(page.locator(".energy-card")).toHaveCount(0);
    await pw.poll(() => requests).toBe(2); release?.();
    await pw(page.locator(".energy-number")).toHaveText("100");
    await page.getByRole("button", { name: "Sincronizza ora", exact: true }).click();
    await pw.poll(() => requests).toBe(3);
    await pw(page.locator(".feed-content")).toHaveAttribute("aria-busy", "true");
    await pw(page.locator(".energy-number")).toHaveText("100");
    release?.(); await pw(page.locator(".energy-number")).toHaveText("200");
    await pw(page.locator(".feed-content")).toHaveAttribute("aria-busy", "false");
  }, "dashboard");
});
