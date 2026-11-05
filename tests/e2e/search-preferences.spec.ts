import { it, expect } from "vitest";
import { chromium, expect as pw, type Page } from "@playwright/test";
import { build } from "esbuild";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { productionCss } from "./helpers/production-css";
import type { UiPreferences } from "@/lib/ui-preferences";

type State = { preferences: UiPreferences; failSave: boolean; diaryUnauthorized: boolean; searches: URLSearchParams[]; writes: Record<string, unknown>[] };
async function withPreferencesBrowser(run: (page: Page, url: string, state: State) => Promise<void>) {
  const client = await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import{CalorieApp}from'./src/components/calorie-app';import{UiPreferencesProvider}from'./src/components/ui-preferences-provider';import{PreferencesPage}from'./src/components/preferences/preferences-page';import{FoodEntryView}from'./src/components/food-entry/food-entry-view';import{ProfileContent}from'./src/components/profile/profile-content';const params=new URLSearchParams(location.search);createRoot(document.getElementById('root')).render(<UiPreferencesProvider>{location.pathname==='/dashboard'?<CalorieApp view='dashboard'/>:location.pathname==='/profile'?<ProfileContent initialProfile={null}/>:location.pathname==='/diary/add'?<FoodEntryView initialDate={params.get('date')||'2026-11-03'} initialSlot='Breakfast'/>:<PreferencesPage section={location.pathname==='/language'?'language':'themes'}/>}</UiPreferencesProvider>);`, loader: "tsx", resolveDir: process.cwd() }, loader: { ".css": "empty" }, bundle: true, write: false, platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"', "process.env": '{}' } });
  const css = process.env.DIARY_VISUAL_CSS === "1" ? await productionCss() : "";
  const server = createServer(async (req, res) => {
    if (req.url === "/app.js") { res.setHeader("Content-Type", "application/javascript"); res.end(client.outputFiles[0].text); return; }
    if (req.url?.startsWith("/brand/")) { res.end(await readFile("public/brand/syncloric-mark.png")); return; }
    const font = req.url?.match(/^\/fonts\/(arasaka-red|themes)\/([a-z0-9-]+\.woff2)$/);
    if (font) { res.setHeader("Content-Type", "font/woff2"); res.end(await readFile("public/fonts/" + font[1] + "/" + font[2])); return; }
    res.setHeader("Content-Type", "text/html"); res.end(`<!doctype html><html lang="it"><meta name="viewport" content="width=device-width"><meta name="theme-color" content="#090d14"><style>${css}</style><div id="root"></div><script src="/app.js"></script></html>`);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 950 } });
    await page.clock.setFixedTime(new Date("2026-11-03T12:00:00Z"));
    const state: State = { preferences: { locale: "it", theme: "cyberpunk" }, failSave: false, diaryUnauthorized: false, searches: [], writes: [] };
    let savedFood: Record<string, unknown> | null = null;
    await page.route("**/api/**", async route => {
      const request = route.request(), url = new URL(request.url()), path = url.pathname;
      if (path === "/api/v1/account/preferences") {
        if (request.method() === "PATCH") {
          if (state.failSave) return route.fulfill({ status: 503, json: { error: "Unavailable" } });
          state.preferences = { ...state.preferences, ...request.postDataJSON() };
        }
        return route.fulfill({ json: { preferences: state.preferences } });
      }
      if (path === "/api/v1/account") return route.fulfill({ json: { user: { id: "user", username: "alice", name: "Colazione", image: null, role: "user", createdAt: "2026-01-01" } } });
      if (path === "/api/v1/diary") return state.diaryUnauthorized ? route.fulfill({ status: 401, json: {} }) : route.fulfill({ json: { target: 2000, sync: null, entries: [{ id: "entry", date: "2026-11-03", slot: "Breakfast", entryType: "food", name: "Colazione", quantityGrams: 100, kcal: 1234, nutrients: { protein: 1.5 }, source: "manual", norishDeleted: false }] } });
      if (path.endsWith("/search")) { state.searches.push(url.searchParams); return route.fulfill({ json: { local: [], foods: [], hasMore: false } }); }
      if (path.endsWith("/frequent")) return route.fulfill({ json: { foods: [] } });
      if (path.endsWith("/catalog")) return route.fulfill({ json: { foods: [], recipes: [] } });
      if (path.endsWith("/label-scan")) return route.fulfill({ json: request.method() === "GET" ? { ready: true, cloud: true, provider: "openai" } : { label: { name: "Latte", brand: "ACME", barcode: "0001234567895", per100g: { kcal: 50, protein: 3, carbs: 5, fat: 2 }, servingSize: 200 } } });
      if (path === "/api/v1/foods" && request.method() === "POST") {
        const data = request.postDataJSON(); state.writes.push(data); savedFood = { ...data, id: "saved-food", canEdit: true };
        return route.fulfill({ status: 201, json: { food: savedFood } });
      }
      if (path === "/api/v1/barcode") return route.fulfill({ json: { origin: "local", food: savedFood } });
      if (path.startsWith("/api/v1/foods/")) return route.fulfill({ json: { food: savedFood } });
      return route.fulfill({ json: {} });
    });
    await run(page, `http://127.0.0.1:${(server.address() as { port: number }).port}`, state);
  } finally { await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
}

it("search separates name and brand, manual and AI entry retain optional barcodes for scanning", async () => {
  await withPreferencesBrowser(async (page, url, state) => {
    await page.goto(url + "/diary/add");
    await pw(page.getByRole("searchbox", { name: "Cerca alimento per nome" })).not.toBeFocused();
    await pw(page.locator(".entry-country")).toHaveCount(0);
    await page.getByRole("searchbox", { name: "Filtra per marca" }).fill("Barilla");
    await pw.poll(() => state.searches.length).toBe(1);
    expect(Object.fromEntries(state.searches[0])).toEqual({ query: "", brand: "Barilla", locale: "it", page: "1" });
    await page.getByRole("searchbox", { name: "Cerca alimento per nome" }).fill("Pasta");
    await pw.poll(() => state.searches.at(-1)?.get("query")).toBe("Pasta");
    await page.getByRole("button", { name: "Inserisci un alimento manualmente" }).click();
    await pw(page.getByLabel("Marca", { exact: true })).toHaveValue("Barilla");
    await page.getByLabel("Nome alimento", { exact: true }).fill("Colazione");
    await page.getByLabel("Codice a barre (facoltativo)").fill("01234565");
    await page.getByLabel("Kcal per 100 g", { exact: true }).fill("200");
    await page.getByRole("button", { name: "Aggiungi a Colazione", exact: true }).click();
    await pw(page.locator(".entry-success")).toContainText("Colazione aggiunto a colazione.");
    expect(state.writes[0]).toMatchObject({ name: "Colazione", brand: "Barilla", barcode: "01234565" });
    await page.getByRole("tab", { name: "Scansione", exact: true }).click();
    await page.getByLabel("Codice a barre", { exact: true }).fill("01234565");
    await page.getByRole("button", { name: "Cerca prodotto", exact: true }).click();
    await pw(page.getByRole("heading", { name: "Colazione", exact: true }).last()).toBeVisible();
    await pw(page.locator(".food-barcode")).toHaveText("01234565");
    await page.getByRole("button", { name: "Torna alla selezione" }).click();
    await page.getByRole("tab", { name: "Etichetta AI", exact: true }).click();
    await page.getByLabel("Foto etichetta").setInputFiles({ name: "label.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ64AAAAASUVORK5CYII=", "base64") });
    await page.getByRole("button", { name: "Scansiona etichetta", exact: true }).click();
    await pw(page.getByLabel("Codice a barre (facoltativo)")).toHaveValue("0001234567895");
    const add = page.getByRole("button", { name: "Aggiungi a Colazione", exact: true }); await pw(add).toBeDisabled();
    await page.getByLabel("Ho verificato i valori proposti dall’AI").check(); await add.click();
    await pw(page.locator(".entry-success")).toContainText("Latte aggiunto");
    expect(state.writes[1]).toMatchObject({ name: "Latte", barcode: "0001234567895" });
  });
}, 60000);

it("menu, persistent themes and English labels, numbers and confirmation work; failed updates roll back", async () => {
  await withPreferencesBrowser(async (page, url, state) => {
    await page.goto(url + "/themes");
    await page.getByRole("button", { name: "Menu profilo" }).click();
    await pw(page.getByRole("menuitem")).toHaveText(["Profilo", "Temi", "Lingua", "Impostazioni", "Esci"]);
    await page.getByRole("menuitem", { name: "Temi", exact: true }).press("Escape");
    await page.locator(".theme-option").filter({ hasText: "Synthwave" }).click();
    await pw(page.locator(".preferences-feedback")).toHaveText("Preferenze salvate.");
    await page.reload(); await pw(page.locator("html")).toHaveAttribute("data-theme", "synthwave");
    await pw(page.locator('input[value="synthwave"]')).toBeChecked();
    await page.locator(".theme-option").filter({ hasText: "Arasaka Red" }).click();
    await pw(page.locator("html")).toHaveAttribute("data-theme", "arasaka-red");
    await pw(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#0b090b");
    await page.reload(); await pw(page.locator('input[value="arasaka-red"]')).toBeChecked();
    if (process.env.DIARY_VISUAL_CSS === "1") {
      await page.evaluate(() => document.fonts.ready);
      const typography = await page.evaluate(() => ({
        heading: getComputedStyle(document.querySelector("h1")!).fontFamily,
        body: getComputedStyle(document.body).fontFamily,
        loaded: [...document.fonts].filter(font => font.status === "loaded").map(font => font.family),
        standard: getComputedStyle(document.querySelector(".side-nav .ui-icon-standard")!).display,
        custom: getComputedStyle(document.querySelector(".side-nav .ui-icon-arasaka")!).display,
      }));
      expect(typography.heading).toContain("Rajdhani");
      expect(typography.body).toContain("Zen Kaku Gothic New");
      expect(typography.loaded.some(font => font.includes("Rajdhani"))).toBe(true);
      expect(typography.loaded.some(font => font.includes("Zen Kaku Gothic New"))).toBe(true);
      expect(typography.standard).toBe("none"); expect(typography.custom).toBe("inline");
    }
    await page.goto(url + "/language"); await page.locator(".language-option").filter({ hasText: "English" }).click();
    await pw(page.locator("html")).toHaveAttribute("lang", "en");
    await pw(page.locator(".preferences-feedback")).toHaveText("Preferences saved.");
    await page.reload(); await pw(page.getByRole("heading", { name: "Language." })).toBeVisible();
    await page.getByRole("button", { name: "Profile menu" }).click();
    await pw(page.getByRole("menuitem")).toHaveText(["Profile", "Themes", "Language", "Settings", "Sign out"]);
    await pw(page.locator(".account-menu-identity strong")).toHaveText("Colazione");
    await page.getByRole("menuitem", { name: "Themes", exact: true }).click();
    state.failSave = true;
    await page.locator(".theme-option").filter({ hasText: "Terminal" }).click();
    await pw(page.getByRole("alert")).toContainText("Could not save preferences");
    await pw(page.locator("html")).toHaveAttribute("data-theme", "arasaka-red");
    expect(state.preferences).toEqual({ locale: "en", theme: "arasaka-red" });
    await page.goto(url + "/diary/add");
    await pw(page.getByRole("heading", { name: "Breakfast." })).toBeVisible();
    await page.getByRole("searchbox", { name: "Filter by brand" }).fill("Acme");
    await pw.poll(() => state.searches.at(-1)?.get("locale")).toBe("en");
    await page.goto(url + "/dashboard?date=2026-11-03");
    await pw(page.getByRole("heading", { name: "Daily overview." })).toBeVisible();
    await pw(page.locator(".energy-number")).toHaveText("1,234");
    await pw(page.locator(".selected-date strong")).toContainText("Tuesday, 3 November 2026");
    state.diaryUnauthorized = true; await page.reload();
    await pw(page.getByRole("alert")).toContainText("Sign in to view your diary.");
    await pw(page.getByRole("link", { name: "Go to sign in" })).toBeVisible();
    await page.goto(url + "/profile#sicurezza");
    await page.getByRole("button", { name: "Delete account", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Current password to delete account").fill("test");
    await dialog.getByLabel("Type DELETE to confirm").fill("ELIMINA");
    await pw(dialog.getByRole("button", { name: "Delete permanently" })).toBeDisabled();
    await dialog.getByLabel("Type DELETE to confirm").fill("DELETE");
    await pw(dialog.getByRole("button", { name: "Delete permanently" })).toBeEnabled();
  });
}, 60000);

it.skipIf(process.env.DIARY_VISUAL_CSS !== "1")("all themes and both languages fit mobile and desktop with production CSS", async () => {
  await withPreferencesBrowser(async (page, url, state) => {
    await mkdir("test-results/search-preferences", { recursive: true });
    for (const locale of ["it", "en"] as const) for (const theme of ["cyberpunk", "arasaka-red", "synthwave", "terminal"] as const) {
      state.preferences = { locale, theme };
      for (const width of [320, 390, 1440]) {
        await page.setViewportSize({ width, height: 950 });
        for (const path of ["/themes", "/language", "/diary/add"]) {
          await page.goto(url + path); await pw(page.locator("html")).toHaveAttribute("data-theme", theme);
          await pw(page.locator("html")).toHaveAttribute("lang", locale);
          await pw(page.locator("fieldset[disabled]")).toHaveCount(0);
          const faces = { cyberpunk: ["Barlow", "Chakra Petch"], "arasaka-red": ["Zen Kaku Gothic New", "Rajdhani"], synthwave: ["Space Grotesk", "Orbitron"], terminal: ["IBM Plex Mono", "IBM Plex Mono"] }[theme];
          await page.evaluate(() => document.fonts.ready);
          const identity = await page.evaluate(() => ({
            body: getComputedStyle(document.body).fontFamily,
            heading: getComputedStyle(document.querySelector("h1")!).fontFamily,
            loaded: [...document.fonts].filter(face => face.status === "loaded").map(face => face.family),
            icons: Object.fromEntries(["standard", "cyberpunk", "synthwave", "terminal", "arasaka"].map(name => [name, getComputedStyle(document.querySelector(`.ui-icon-${name}`)!).display])),
          }));
          expect(identity.body).toContain(faces[0]); expect(identity.heading).toContain(faces[1]);
          for (const family of faces) expect(identity.loaded.some(face => face.includes(family))).toBe(true);
          for (const [name, display] of Object.entries(identity.icons)) expect(display).toBe(name === (theme === "arasaka-red" ? "arasaka" : theme) ? "inline" : "none");
          if (width < 1025) {
            const navLabels = await page.locator(".mobile-nav a").evaluateAll(links => links.map(link => {
              const range = document.createRange(); range.selectNodeContents(link);
              const rect = range.getBoundingClientRect(); return { left: rect.left, right: rect.right };
            }));
            expect(navLabels).toHaveLength(4);
            for (let index = 1; index < navLabels.length; index++) expect(navLabels[index].left - navLabels[index - 1].right).toBeGreaterThanOrEqual(4);
          }
          expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
          if (path === "/themes" || width === 390) await page.screenshot({ path: `test-results/search-preferences/${path.split("/").pop()}-${locale}-${theme}-${width}.png`, fullPage: true });
        }
      }
    }
  });
}, 120000);
