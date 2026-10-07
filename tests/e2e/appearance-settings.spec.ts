import { it, expect } from "vitest";
import { chromium, expect as pw } from "@playwright/test";
import { build } from "esbuild";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { productionCss } from "./helpers/production-css";

it("settings switches: keyboard access, system default, persistent motion override and cross-tab updates", async () => {
  const bundle = await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import{SettingsContent}from'./src/components/settings/settings-content';import{CalorieApp}from'./src/components/calorie-app';createRoot(document.getElementById('root')).render(location.pathname==='/dashboard'?<CalorieApp view='dashboard'/>:location.pathname==='/member'?<SettingsContent access='requires-admin'/>:<SettingsContent initialSaved={null} initialStatus={{enabled:true,source:'env',urlPresent:true,apiKeyPresent:false}}/>);`, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"', "process.env": '{}' } });
  const css = process.env.DIARY_VISUAL_CSS === "1" ? await productionCss() : "";
  const server = createServer(async (req, res) => {
    if (req.url === "/app.js") { res.setHeader("Content-Type", "application/javascript"); res.end(bundle.outputFiles[0].text); return; }
    if (req.url === "/brand/syncloric-mark.png") { res.setHeader("Content-Type", "image/png"); res.end(await readFile("public/brand/syncloric-mark.png")); return; }
    res.end(`<html lang="it"><meta name="viewport" content="width=device-width"><style>${css}</style><div id="root"></div><script src="/app.js"></script></html>`);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  try {
    const context = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 390, height: 844 } });
    await context.route("**/api/v1/**", async route => {
      const path = new URL(route.request().url()).pathname;
      const keys = { openai: false, anthropic: false, ollama: false };
      const json = path === "/api/v1/settings/ai" ? { enabled: false, provider: null, ready: false, keys }
        : path === "/api/v1/settings/barcode" ? { enabled: true }
        : path === "/api/v1/admin/users" ? { users: [], currentUserId: "admin" }
        : path === "/api/v1/diary" ? { entries: [], target: 2000, sync: null }
        : { configured: false, stored: false, urlConfigured: true, keys };
      return route.fulfill({ json });
    });
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const page = await context.newPage();
    await page.goto(`${base}/member`);
    const motion = page.getByRole("switch", { name: "Riduci animazioni" });
    await pw(motion).toBeChecked();
    await pw(page.locator("html")).toHaveAttribute("data-motion", "reduce");
    await motion.focus(); await page.keyboard.press("Space");
    await pw(motion).not.toBeChecked();
    await pw(page.locator("html")).toHaveAttribute("data-motion", "full");
    await page.reload(); await pw(motion).not.toBeChecked();
    const second = await context.newPage(); await second.goto(`${base}/member`);
    await motion.check();
    await pw(second.getByRole("switch", { name: "Riduci animazioni" })).toBeChecked();
    await second.goto(`${base}/dashboard`);
    await pw(second.locator(".energy-card")).toBeVisible();
    await pw(second.locator("html")).toHaveAttribute("data-motion", "reduce");
    if (css) expect(await second.locator(".gauge-wave").evaluate(el => getComputedStyle(el).animationName)).toBe("none");
    await motion.uncheck();
    await pw(second.locator("html")).toHaveAttribute("data-motion", "full");
    if (css) expect(await second.locator(".gauge-wave").evaluate(el => getComputedStyle(el).animationName)).toBe("gauge-wave");
    await page.goto(`${base}/settings`);
    const ai = page.getByRole("switch", { name: "Abilita scansione AI" });
    const barcode = page.getByRole("switch", { name: "Ricerca prodotti su Open Food Facts" });
    await pw(ai).toBeDisabled(); await pw(barcode).toBeChecked();
    await page.getByLabel("Provider AI").selectOption("ollama");
    await pw(ai).toBeEnabled(); await ai.check(); await pw(ai).toBeChecked();
    await pw(page.getByRole("checkbox")).toHaveCount(0);
    for (const toggle of [motion, ai, barcode]) {
      expect(await toggle.evaluate(el => !!el.closest(".settings-toggle-heading")?.querySelector("h2"))).toBe(true);
    }
    if (css) for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      expect(await ai.evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    }
  } finally { await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
}, 90_000);
