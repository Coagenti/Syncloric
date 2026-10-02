import { it, expect } from "vitest";
import { chromium, expect as pwExpect, type Locator } from "@playwright/test";
import type { DiaryEntry } from "../../src/lib/diary";
import { build } from "esbuild";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

// UI fixture only: include an adjacent-month import to exercise its small label.
const entries: DiaryEntry[] = ["2026-09-29", "2026-08-31"].map((date, index) => ({
  id: `contrast-fixture-${index}`, date, slot: "Lunch", entryType: "recipe",
  name: "Pasto fixture contrasto", quantityGrams: null, servings: 1,
  kcal: 420, protein: null, fat: null, carbs: null,
  source: "norish_sync", norishDeleted: false,
}));

async function measureText(text: Locator) {
  return text.evaluate((element) => {
    const parse = (color: string) => {
      const parts = color.match(/[\d.]+/g);
      if (!parts) throw new Error(`Unsupported computed color: ${color}`);
      const [r, g, b, a = 1] = parts.map(Number);
      return { rgb: [r, g, b], alpha: a };
    };
    const blend = (front: number[], back: number[], alpha: number) =>
      front.map((channel, i) => channel * alpha + back[i] * (1 - alpha));
    const luminance = (rgb: number[]) => {
      const [r, g, b] = rgb.map((channel) => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    // Composite computed backgrounds/opacity from the root towards the text.
    // Keep the painted text pixel separate from its surrounding background.
    const chain: Element[] = [];
    for (let node: Element | null = element; node; node = node.parentElement) chain.unshift(node);
    const paint = (index: number, includeText: boolean, backdrop: number[]): number[] => {
      const style = getComputedStyle(chain[index]);
      if (style.backgroundImage !== "none") throw new Error("Gradient needs pixel sampling");
      const color = parse(style.backgroundColor);
      let pixel = blend(color.rgb, backdrop, color.alpha);
      if (index + 1 < chain.length) pixel = paint(index + 1, includeText, pixel);
      else if (includeText) {
        const foreground = parse(style.color);
        pixel = blend(foreground.rgb, pixel, foreground.alpha);
      }
      return blend(pixel, backdrop, Number(style.opacity));
    };
    const foreground = paint(0, true, [255, 255, 255]);
    const background = paint(0, false, [255, 255, 255]);
    const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
    return { ratio: (light + 0.05) / (dark + 0.05), color: getComputedStyle(element).color };
  });
}

/**
 * Since PR #22 the calendar page requires a session, so the former Playwright
 * + Next server setup (public /calendar, API intercepted by route.fulfill) can
 * no longer render the view. Harness: production CalorieApp bundle (esbuild)
 * served by a static server that answers the diary feed with the fixture;
 * pinned clock via a Date shim injected before the app. Guards themselves are
 * covered by tests/e2e/auth.spec.ts and the page unit tests.
 */
it("feed calendar outside-month text meets AA and retains interaction (1280/390)", async () => {
  const env = { ...process.env };
  const bundle = await build({
    stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
      import {CalorieApp} from './src/components/calorie-app';
      createRoot(document.getElementById('root')).render(<CalorieApp view="calendar"/>);`,
      resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"', "process.env": '{"MODE":"production"}' },
  });
  // Test-only CSS: strip imports/theme wrapper while retaining the production rules and tokens.
  const css = (await readFile("src/app/globals.css", "utf8")).replace(/^@import .*;$/gm, "").replace("@theme {", ":root {");
  const fixedMs = new Date("2026-09-29T12:00:00").getTime();
  const server = createServer(async (req, res) => {
    try {
      if (req.url === "/app.js") { res.setHeader("Content-Type", "application/javascript"); res.end(bundle.outputFiles[0].text); return; }
      if (req.url === "/style.css") { res.setHeader("Content-Type", "text/css"); res.end(css); return; }
      if (req.url?.startsWith("/api/v1/diary")) {
        expect(req.method).toBe("GET");
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ entries, target: null, sync: { state: "never", lastSuccessAt: null } }));
        return;
      }
      res.setHeader("Content-Type", "text/html");
      res.end(`<html lang="it"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/style.css">
        <script>window.Date = class extends Date { constructor(...a) { a.length === 0 ? super(${fixedMs}) : super(...a); } static now() { return ${fixedMs}; } };</script>
        <div id="root"></div><script src="/app.js"></script></html>`);
    } catch (e) { res.writeHead(500); res.end(String(e)); }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.setDefaultTimeout(30_000);
    for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      await page.goto(`${url}/calendar`);
      await pwExpect(page.getByLabel("Seleziona data")).toHaveValue("2026-09-29");
      await pwExpect(page.getByRole("heading", { name: "settembre 2026" })).toBeVisible();
      const outside = page.locator(".calendar-day.outside").first();
      await pwExpect(outside).toBeEnabled();
      await pwExpect(outside.locator("small")).toHaveText("1 norish");
      const insideText = page.locator(".calendar-day:not(.outside):not(.selected) > span").first();
      const inside = await measureText(insideText);
      const day = await measureText(outside.locator("span"));
      const label = await measureText(outside.locator("small"));
      console.info(JSON.stringify({ viewport: viewport.width, inside, outside: day, importLabel: label }));
      expect(day.ratio).toBeGreaterThanOrEqual(4.5);
      expect(label.ratio).toBeGreaterThanOrEqual(4.5);
      expect(inside.ratio).toBeGreaterThanOrEqual(4.5);
      expect(day.color).not.toBe(inside.color);
      await pwExpect(outside).toHaveCSS("opacity", "1");

      await outside.focus();
      await pwExpect(outside).toBeFocused();
      await pwExpect(outside).toHaveCSS("outline-color", "rgb(0, 240, 255)");
      await pwExpect(outside).toHaveCSS("outline-style", "solid");
      await pwExpect(outside).toHaveCSS("outline-width", "3px");
      await page.keyboard.press("Shift+Tab");
      await page.keyboard.press("Tab");
      await pwExpect(outside).toBeFocused();
      await page.screenshot({ path: `test-results/calendar-${viewport.width}.png`, fullPage: true });
      expect((await measureText(outside.locator("span"))).ratio).toBeGreaterThanOrEqual(4.5);
      await outside.hover();
      await pwExpect(outside).toHaveCSS("border-top-color", "rgb(0, 240, 255)");
      expect((await measureText(outside.locator("small"))).ratio).toBeGreaterThanOrEqual(4.5);
      const selected = page.locator(".calendar-day:not(.outside)").filter({ hasText: /^1$/ });
      await selected.click();
      await pwExpect(page.getByLabel("Seleziona data")).toHaveValue("2026-09-01");
      const selectedDay = page.locator(".calendar-day.selected");
      await pwExpect(selectedDay).toHaveAttribute("aria-pressed", "true");
      await pwExpect(selectedDay).toHaveCSS("border-top-color", "rgb(252, 238, 10)");
      expect((await measureText(selectedDay.locator("span"))).ratio).toBeGreaterThanOrEqual(4.5);
      // Outside cells are active: keyboard activation navigates to the adjacent month.
      await page.locator(".calendar-day.outside").first().focus();
      await page.keyboard.press("Enter");
      await pwExpect(page.getByLabel("Seleziona data")).toHaveValue("2026-08-31");
      await pwExpect(page.getByRole("heading", { name: "agosto 2026" })).toBeVisible();
    }
  } finally {
    await browser.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
    process.env = env;
  }
}, 600_000);