import { afterAll, beforeAll, expect, it } from "vitest";
import { chromium, expect as pw, type Browser, type Page } from "@playwright/test";
import { build } from "esbuild";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { productionCss } from "./helpers/production-css";

let browser: Browser, server: Server, base: string;
const date = "2026-10-13";
const errors: string[] = [];

beforeAll(async () => {
  const bundle = await build({
    stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
      import {CalorieApp} from './src/components/calorie-app';
      import {SettingsContent} from './src/components/settings/settings-content';
      import {FoodEntryView} from './src/components/food-entry/food-entry-view';
      const query = new URLSearchParams(location.search);
      createRoot(document.getElementById('root')).render(location.pathname === '/settings'
        ? <SettingsContent access="requires-admin" /> : location.pathname === '/diary/add'
        ? <FoodEntryView initialDate={query.get('date')} initialSlot={query.get('slot')} />
        : <CalorieApp view={location.pathname.slice(1)} />);`, loader: "tsx", resolveDir: process.cwd() },
    bundle: true, write: false, platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
  });
  const css = await productionCss();
  server = createServer(async (req, res) => {
    try {
      const path = new URL(req.url!, "http://localhost").pathname;
      if (path === "/app.js") { res.setHeader("Content-Type", "application/javascript"); res.end(bundle.outputFiles[0].text); return; }
      if (path.startsWith("/brand/")) { res.setHeader("Content-Type", "image/png"); res.end(await readFile(`public${path}`)); return; }
      if (path.startsWith("/api/")) {
        const data = path === "/api/v1/diary" ? {
          target: 2000, sync: null, entries: [{ id: "breakfast", date, slot: "Breakfast", entryType: "food", name: "Yogurt", quantityGrams: 100, servings: null, kcal: 80, protein: 10, carbs: 3, fat: 2, nutrients: { protein: 10, vitaminD: 2.5 }, source: "manual", norishDeleted: false }],
        } : path === "/api/v1/account" ? { user: { id: "mobile", username: "mobile", name: null, image: null, role: "user", createdAt: "2026-10-01" } }
          : path === "/api/v1/household" ? { household: null }
          : path === "/api/v1/foods/frequent" ? { foods: [] }
          : path === "/api/v1/diary/catalog" ? { recipes: [] }
          : path === "/api/v1/settings/export-tokens" ? { tokens: [] } : {};
        res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(data)); return;
      }
      res.setHeader("Content-Type", "text/html");
      res.end(`<!doctype html><html lang="it"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/app.js"></script></html>`);
    } catch (error) { errors.push(String(error)); res.writeHead(500); res.end("Fixture error"); }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  browser = await chromium.launch({ args: ["--no-sandbox"] });
}, 30_000);
afterAll(async () => {
  await browser?.close();
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  expect(errors).toEqual([]);
});

async function mobilePage() {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  await page.clock.setFixedTime(new Date(`${date}T12:00:00`));
  return page;
}

// Chromium's real touch input also exercises native scrolling and synthetic click suppression.
async function drag(page: Page, x: number, y: number, dx: number, dy = 0, cancel = false) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 1 }] });
  for (let step = 1; step <= 8; step++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + dx * step / 8, y: y + dy * step / 8, id: 1 }] });
    await page.waitForTimeout(20);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: cancel ? "touchCancel" : "touchEnd", touchPoints: [] });
  await cdp.detach();
}
async function headingSwipe(page: Page, dx: number) {
  const heading = page.locator(".view-title h1");
  await pw(heading).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  const box = (await heading.boundingBox())!;
  await drag(page, dx < 0 ? 300 : 90, box.y + box.height / 2, dx);
}

it("mobile swipes follow the four navigation links and leave scrolling, forms, tabs and dialogs usable", async () => {
  const page = await mobilePage();
  try {
    await page.goto(`${base}/dashboard`);
    await pw(page.locator(".energy-card")).toBeVisible();
    // First/last page do not wrap.
    await headingSwipe(page, 210); await page.waitForTimeout(150); expect(new URL(page.url()).pathname).toBe("/dashboard");
    for (const route of ["diary", "calendar", "settings"]) {
      await headingSwipe(page, -210); await pw(page).toHaveURL(`${base}/${route}`);
    }
    await headingSwipe(page, -210); await page.waitForTimeout(150); expect(new URL(page.url()).pathname).toBe("/settings");

    const strip = page.getByRole("tablist", { name: "Sezioni impostazioni" });
    const stripBox = (await strip.boundingBox())!;
    await drag(page, 300, stripBox.y + stripBox.height / 2, -210);
    expect(new URL(page.url()).pathname).toBe("/settings");
    expect(await strip.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
    await headingSwipe(page, 210); await pw(page).toHaveURL(`${base}/calendar`);
    await headingSwipe(page, 210); await pw(page).toHaveURL(`${base}/diary`);
    await pw(page.locator(".diary-balance")).toBeVisible();

    await page.getByLabel("Seleziona data", { exact: true }).focus();
    await headingSwipe(page, -210); await page.waitForTimeout(150); expect(new URL(page.url()).pathname).toBe("/diary");
    await page.getByLabel("Seleziona data", { exact: true }).evaluate(element => (element as HTMLElement).blur());
    await page.getByRole("button", { name: "Pasti del nucleo", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Pasti del nucleo" });
    const message = dialog.getByText(/^Non fai ancora parte di un nucleo\./);
    await pw(message).toBeVisible(); const box = (await message.boundingBox())!;
    await drag(page, 300, box.y + box.height / 2, -210);
    await pw(dialog).toBeVisible(); expect(new URL(page.url()).pathname).toBe("/diary");
    await dialog.getByRole("button", { name: "Chiudi", exact: true }).click();

    await page.evaluate(() => window.scrollTo(0, 0));
    await drag(page, 190, 570, 0, -240); await page.waitForTimeout(250);
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(50);
    expect(new URL(page.url()).pathname).toBe("/diary");
    await page.evaluate(() => window.scrollTo(0, 0));
    const title = (await page.locator(".view-title h1").boundingBox())!;
    await drag(page, 12, title.y + 10, 210); // OS back edge remains untouched.
    expect(new URL(page.url()).pathname).toBe("/diary");
    await headingSwipe(page, -210);
    await pw(page).toHaveURL(`${base}/calendar`);
    await page.goto(`${base}/diary`);
    const again = (await page.locator(".view-title h1").boundingBox())!;
    await drag(page, 300, again.y + 10, -210, 0, true);
    await page.waitForTimeout(150); expect(new URL(page.url()).pathname).toBe("/diary");

    await page.setViewportSize({ width: 1440, height: 950 });
    await headingSwipe(page, -210); await page.waitForTimeout(150); expect(new URL(page.url()).pathname).toBe("/diary");
  } finally { await page.context().close(); }
}, 45_000);

it("today meal cards open entry with the selected date and meal, while swiping a card only changes page", async () => {
  const page = await mobilePage();
  try {
    const slots = ["Breakfast", "Lunch", "Snack", "Dinner"];
    const labels = ["Colazione", "Pranzo", "Spuntino", "Cena"];
    for (let index = 0; index < slots.length; index++) {
      await page.goto(`${base}/dashboard?date=${date}`);
      const card = page.getByRole("link", { name: `Aggiungi alimenti a ${labels[index]}`, exact: true });
      await pw(card).toHaveAttribute("href", `/diary/add?date=${date}&slot=${slots[index]}#ricerca`);
      await pw(card.locator("button, .meal-add")).toHaveCount(0);
      await card.tap();
      await pw(page).toHaveURL(`${base}/diary/add?date=${date}&slot=${slots[index]}#ricerca`);
      await pw(page.getByLabel("Data inserimento", { exact: true })).toHaveValue(date);
      await pw(page.getByLabel("Pasto", { exact: true })).toHaveValue(slots[index]);
      await pw(page.getByRole("tab", { name: "Ricerca", exact: true })).toHaveAttribute("aria-selected", "true");
    }
    // Entry views never participate in main-page swipe navigation.
    const header = (await page.locator(".entry-page-header h1").boundingBox())!;
    await drag(page, 300, header.y + header.height / 2, -210);
    expect(new URL(page.url()).pathname).toBe("/diary/add");

    await page.goto(`${base}/dashboard?date=${date}`);
    await pw(page.locator(".nutrition-summary")).toBeVisible();
    await pw(page.locator(".macro-protein")).toContainText("10");
    const card = page.locator(".meal-card").first(); await card.scrollIntoViewIfNeeded();
    const box = (await card.boundingBox())!;
    // A card is narrower than the screen: begin inside it, finish outside it.
    await drag(page, box.x + box.width - 10, box.y + box.height / 2, -110);
    await pw(page).toHaveURL(`${base}/diary`);
    await pw(page.locator(".nutrition-summary")).toHaveCount(0);
    await pw(page.locator(".entry-nutrients")).toBeVisible();
    await page.locator(".entry-nutrients summary").click();
    await pw(page.locator(".entry-nutrients")).toContainText("2,5 µg");
  } finally { await page.context().close(); }
}, 45_000);
