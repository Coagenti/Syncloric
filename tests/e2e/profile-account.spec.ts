import { expect as pw, chromium, type Page } from "@playwright/test";
import { it, expect } from "vitest";
import { build } from "esbuild";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { productionCss } from "./helpers/production-css";
import { calculateGoal } from "@/server/services/profile/goals";
import { defaultMacroSettings } from "@/lib/goal-targets";
const user = { id: "11111111-1111-4111-8111-111111111111", username: "alice", name: "Alice", image: null, role: "user", createdAt: "2026-01-01" };
const initial = { sex: "m" as const, heightCm: 180, weightKg: 100, birthYear: 1996, activityLevel: "moderate" as const, goal: "lose" as const, targetSource: "calculated", manualTargetKcal: null, calculatedTargetKcal: 2570, weightGoal: null, macroSettings: defaultMacroSettings };
async function browserTest(run: (page: Page, url: string, writes: { path: string; data: Record<string, unknown> }[]) => Promise<void>) {
  const bundle = await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import{ProfileContent}from'./src/components/profile/profile-content';fetch('/api/v1/profile').then(r=>r.json()).then(p=>createRoot(document.getElementById('root')).render(<ProfileContent initialProfile={p.profile}/>));`, resolveDir: process.cwd(), loader: "tsx" }, loader: { ".css": "empty" }, bundle: true, platform: "browser", write: false, jsx: "automatic", define: { "process.env.NODE_ENV": '"production"', "process.env": '{}' } });
  const css = process.env.DIARY_VISUAL_CSS === "1" ? await productionCss() : "";
  const server = createServer(async (req, res) => { if (req.url === "/app.js") { res.setHeader("Content-Type", "application/javascript"); res.end(bundle.outputFiles[0].text); return; } if (req.url?.startsWith("/brand/")) { res.end(await readFile("public/brand/syncloric-mark.png")); return; } res.setHeader("Content-Type", "text/html"); res.end(`<html lang="it"><meta name="viewport" content="width=device-width"><style>${css}</style><div id="root"></div><script src="/app.js"></script></html>`); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 900 } }); const writes: { path: string; data: Record<string, unknown> }[] = [];
    let profile: Record<string, unknown> = { ...initial }; let account = { ...user };
    await page.route("**/api/**", async route => {
      const request = route.request(), path = new URL(request.url()).pathname; const data = request.method() === "GET" ? {} : request.postDataJSON();
      if (request.method() !== "GET") writes.push({ path, data });
      if (path === "/api/v1/account") { if (request.method() === "PATCH") account = { ...account, name: data.name }; if (request.method() === "DELETE") return route.fulfill({ status: 403, json: { error: "Password attuale non corretta." } }); return route.fulfill({ json: { user: account } }); }
      if (path === "/api/v1/profile/preview") { const calculation = calculateGoal(data); return route.fulfill({ json: { calculatedTargetKcal: calculation.calculatedTargetKcal, calculation } }); }
      if (path === "/api/v1/profile/macros") { profile = { ...profile, macroSettings: data }; return route.fulfill({ json: { profile } }); }
      if (path === "/api/v1/profile") { if (request.method() !== "GET") profile = { ...profile, ...data, calculatedTargetKcal: calculateGoal(data).calculatedTargetKcal }; return route.fulfill({ json: { profile } }); }
      return route.fulfill({ json: {} });
    });
    await run(page, `http://127.0.0.1:${(server.address() as { port: number }).port}`, writes);
  } finally { await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
}
it("account menu keyboard, profile tabs, personal display name and deletion confirmation", async () => {
  await browserTest(async (page, url, writes) => {
    await page.goto(url + "/profile"); await pw(page.getByLabel("Nome visualizzato")).toHaveValue("Alice");
    await page.getByRole("button", { name: "Menu profilo" }).click(); await pw(page.getByRole("menuitem", { name: "Profilo", exact: true })).toBeFocused(); await page.getByRole("menuitem", { name: "Profilo", exact: true }).press("ArrowDown"); await pw(page.getByRole("menuitem", { name: "Temi", exact: true })).toBeFocused(); await page.getByRole("menuitem", { name: "Temi", exact: true }).press("Escape"); await pw(page.getByRole("button", { name: "Menu profilo" })).toBeFocused();
    await page.getByLabel("Nome visualizzato").fill("Alice Neon"); await page.getByRole("button", { name: "Salva profilo personale" }).click(); await pw(page.getByText("Profilo aggiornato.", { exact: true })).toBeVisible(); expect(writes.find(w => w.path === "/api/v1/account")?.data).toEqual({ name: "Alice Neon" });
    await page.getByRole("tab", { name: "Profilo", exact: true }).press("End"); await pw(page.getByRole("tab", { name: "Sicurezza" })).toBeFocused(); await page.getByRole("button", { name: "Elimina account", exact: true }).click(); const dialog = page.getByRole("dialog"); await pw(dialog.getByRole("button", { name: "Annulla" })).toBeFocused(); await pw(dialog.getByRole("button", { name: "Elimina definitivamente" })).toBeDisabled(); await dialog.getByLabel("Password attuale per eliminare").fill("bad"); await dialog.getByLabel("Scrivi ELIMINA per confermare").fill("ELIMINA"); await dialog.getByRole("button", { name: "Elimina definitivamente" }).click(); await pw(dialog.getByRole("alert")).toContainText("Password attuale non corretta"); await dialog.getByRole("button", { name: "Annulla" }).click(); await pw(dialog).toHaveCount(0); await pw(page.getByRole("button", { name: "Elimina account", exact: true })).toBeFocused();
  });
}, 60000);
it("deadline offers a later date, saves a safe plan and allows custom macro goals", async () => {
  await browserTest(async (page, url, writes) => {
    await page.goto(url + "/profile#obiettivo"); await page.getByRole("switch", { name: "Obiettivo temporale", exact: true }).check(); await page.getByLabel("Peso desiderato (kg)").fill("95"); await page.getByLabel("Data obiettivo").fill(new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10)); await pw(page.getByRole("button", { name: "Usa data suggerita", exact: false })).toBeVisible(); await pw(page.getByRole("button", { name: "Salva profilo", exact: true })).toBeDisabled(); await page.getByRole("button", { name: "Usa data suggerita", exact: false }).click(); await pw(page.getByRole("button", { name: "Salva profilo", exact: true })).toBeEnabled(); await page.getByRole("button", { name: "Salva profilo", exact: true }).click(); await pw(page.getByText("Modifiche salvate. Il tuo obiettivo è aggiornato.", { exact: true })).toBeVisible(); expect(writes.find(w => w.path === "/api/v1/profile")?.data.weightGoal).toMatchObject({ targetWeightKg: 95 });
    await page.getByRole("tab", { name: "Nutrienti" }).click(); await page.getByRole("switch", { name: "Suggerimento automatico macro" }).uncheck(); await page.getByLabel("Carboidrati (%)").fill("50"); await page.getByLabel("Proteine (%)").fill("20"); await page.getByLabel("Grassi (%)").fill("30"); await page.getByRole("button", { name: "Salva obiettivi macro" }).click(); await pw(page.getByText(/Obiettivi macro salvati/)).toBeVisible(); expect(writes.find(w => w.path.endsWith("/macros"))?.data).toMatchObject({ mode: "custom", carbs: 50, protein: 20, fat: 30 });
  });
}, 60000);
it.skipIf(process.env.DIARY_VISUAL_CSS !== "1")("profile, goals, macros and security fit mobile and desktop", async () => {
  await browserTest(async (page, url) => {
    await mkdir("test-results/profile-account", { recursive: true });
    for (const width of [320, 390, 1440]) { await page.setViewportSize({ width, height: 1000 }); await page.goto(url + "/profile"); await pw(page.getByLabel("Nome visualizzato")).toBeVisible(); for (const section of ["Profilo", "Obiettivo", "Nutrienti", "Sicurezza"]) { await page.getByRole("tab", { name: section, exact: true }).click(); expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width); await page.screenshot({ path: `test-results/profile-account/${section}-${width}.png`, fullPage: true }); } }
  });
}, 90000);
