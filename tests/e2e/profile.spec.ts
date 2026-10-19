import { it } from "vitest";
import { chromium, expect } from "@playwright/test";
import { build } from "esbuild";
import { createServer } from "node:http";
import { mkdtemp, rm, readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { sql } from "drizzle-orm";
import { buildProfileHandlers } from "@/server/services/profile/http";
import { buildDiaryFeedHandlers } from "@/server/services/diary/feed";
import { resetEnvConfigCache } from "@/server/config";
import type { Db } from "@/server/db";

// Real browser/components/HTTP/PGlite; injected session, never a production auth bypass.
it("profile: server preview, save/reload, target switch and dashboard without/with target", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "syncloric-profile-"));
  const oldEnv = { ...process.env };
  Object.assign(process.env, { DATABASE_URL: "postgres://test@localhost/test", BETTER_AUTH_SECRET: "test-only-not-a-real-secret-01234567890123456789", ENCRYPTION_KEY: "a".repeat(64) });
  delete process.env.NORISH_API_KEY;
  delete process.env.NORISH_BASE_URL;
  resetEnvConfigCache();
  const client = new PGlite(dir);
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: "./drizzle" });
  const id = "11111111-1111-4111-8111-111111111111";
  await db.execute(sql`INSERT INTO users (id, username) VALUES (${id}::uuid, 'profile-test')`);
  const deps = { getDb: () => db as unknown as Db, getSession: async () => ({ user: { id } }) };
  const profile = buildProfileHandlers(deps), diary = buildDiaryFeedHandlers(deps);
  const bundle = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {ProfileContent} from './src/components/profile/profile-content'; import {DashboardView} from './src/components/calorie-views';
    const root=createRoot(document.getElementById('root'));
    if(location.pathname==='/profile') fetch('/api/v1/profile').then(r=>r.json()).then(p=>root.render(<ProfileContent initialProfile={p.profile}/>));
    else fetch('/api/v1/diary?month=2026-01').then(r=>r.json()).then(p=>root.render(<DashboardView entries={p.entries} date='2026-01-01' target={p.target}/>));`, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, platform: "browser", loader: { ".css": "empty" }, jsx: "automatic", define: { "process.env.NODE_ENV": '"production"', "process.env": '{}' } });
  let css = await readFile("src/app/globals.css", "utf8") + await readFile("src/components/profile.css", "utf8");
  if (process.env.PROFILE_VISUAL === "1") {
    // Compile the real production Tailwind/PostCSS pipeline for visual evidence.
    const { createRequire } = await import("node:module");
    const require = createRequire(path.resolve("package.json"));
    const postcss = createRequire(require.resolve("@tailwindcss/postcss"))("postcss");
    const tailwind = (await import("@tailwindcss/postcss")).default;
    css = (await postcss([tailwind()]).process(await readFile("src/app/globals.css", "utf8"), { from: path.resolve("src/app/globals.css") })).css + await readFile("src/components/profile.css", "utf8");
  }
  const server = createServer(async (req, res) => {
    try {
      if (req.url === "/app.js") { res.setHeader("Content-Type", "application/javascript"); res.end(bundle.outputFiles[0].text); return; }
      if (!req.url?.startsWith("/api/")) { res.setHeader("Content-Type", "text/html"); res.end(`<html lang="it"><meta name="viewport" content="width=device-width"><style>:root{--color-cyber-bg:#090d14;--color-cyber-cyan:#00f0ff;--color-cyber-yellow:#fcee0a}${css.replace(/@import[^;]+;/g, "")}</style><div id="root"></div><script src="/app.js"></script></html>`); return; }
      const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const method = req.method ?? "GET";
      const request = new Request("http://localhost" + req.url, { method, headers: { "content-type": "application/json", origin: "http://localhost" }, ...(method !== "GET" ? { body: Buffer.concat(chunks).toString() } : {}) });
      const response = req.url.startsWith("/api/v1/diary") ? await diary.GET(request) : req.url.endsWith("/preview") ? await profile.PREVIEW(request) : method === "PUT" ? await profile.PUT(request) : await profile.GET(request);
      res.writeHead(response.status, { "Content-Type": "application/json" }); res.end(await response.text());
    } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: String(e) })); }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Missing address");
  const base = `http://127.0.0.1:${address.port}`;
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.setDefaultTimeout(60000);
    const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
    await page.goto(base + "/dashboard");
    await expect(page.locator(".energy-details a[href='/profile#obiettivo']")).toBeHidden();
    await expect(page.locator(".energy-unconfigured")).toBeVisible();
    await expect(page.getByText(/kcal di differenza/)).toHaveCount(0);
    await page.goto(base + "/profile#obiettivo");
    await page.getByLabel("Sesso per il calcolo").selectOption("m");
    await page.getByLabel("Altezza (cm)").fill("180");
    await page.getByLabel("Peso (kg)").fill("80");
    await page.getByLabel("Anno di nascita").fill(String(new Date().getFullYear() - 30));
    await page.getByLabel("Livello di attività").selectOption("moderate");
    await page.getByRole("combobox", { name: "Obiettivo", exact: true }).selectOption("maintain");
    await expect(page.getByTestId("target-preview")).toContainText("2760 kcal");
    await page.getByRole("button", { name: "Salva profilo" }).click();
    await expect(page.getByRole("status")).toContainText("Modifiche salvate");
    await page.reload();
    await expect(page.getByLabel("Peso (kg)")).toHaveValue("80");
    await page.getByRole("link", { name: "Torna alla dashboard" }).click();
    await expect(page.locator(".energy-balance")).toContainText("2.760");
    await page.goto(base + "/profile#obiettivo");
    await page.getByLabel("Manuale", { exact: true }).check();
    await page.getByLabel("Target manuale (kcal)").fill("2101");
    await page.getByRole("button", { name: "Salva profilo" }).click();
    await expect(page.getByRole("status")).toContainText("Modifiche salvate");
    await page.getByRole("link", { name: "Torna alla dashboard" }).click();
    await expect(page.locator(".energy-balance")).toContainText("2.101");
    await mkdir("test-results", { recursive: true });
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 900 }); await page.goto(base + "/profile#obiettivo");
      await expect(page.getByRole("heading", { name: "Il tuo obiettivo." })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: path.resolve("test-results", `profile-${width}.png`), fullPage: true });
    }
    await page.goto(base + "/profile#obiettivo");
    await page.getByLabel("Anno di nascita").fill("1800");
    const save = page.getByRole("button", { name: "Salva profilo" });
    let release!: () => void;
    const delayed = new Promise<void>(resolve => { release = resolve; });
    await page.route("**/api/v1/profile", async route => {
      if (route.request().method() === "PUT") await delayed;
      await route.continue();
    });
    await save.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Salvataggio…" })).toBeDisabled();
    release();
    await expect(page.getByLabel("Anno di nascita")).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByLabel("Anno di nascita")).toBeFocused();
    await page.unroute("**/api/v1/profile");
    await expect(page.locator("#error-birthYear")).toContainText("Inserisci un anno di nascita intero tra");
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: path.resolve("..", `profile-error-${width}.png`), fullPage: true });
    }
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Livello di attività")).toBeFocused();
    await page.getByLabel("Anno di nascita").fill(String(new Date().getFullYear() - 30));
    await save.click();
    await expect(page.getByRole("status")).toContainText("Modifiche salvate");
    await expect(save).toBeFocused();
    await page.route("**/api/v1/profile", route => route.request().method() === "PUT"
      ? route.fulfill({ status: 503, contentType: "text/html", body: "Gateway unavailable" }) : route.continue());
    await save.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("status")).toContainText("Servizio temporaneamente non disponibile");
    await expect(page.getByRole("status")).not.toContainText("Controlla i dati");
    await expect(save).toBeFocused();
    await expect(page.getByLabel("Peso (kg)")).toHaveValue("80");
    await page.unroute("**/api/v1/profile");
    await page.route("**/api/v1/profile", route => route.request().method() === "PUT" ? route.abort() : route.continue());
    await save.click();
    await expect(page.getByRole("status")).toContainText("Connessione non riuscita");
    await expect(save).toBeFocused();
    await page.unroute("**/api/v1/profile");
    await save.click();
    await expect(page.getByRole("status")).toContainText("Modifiche salvate");
    await expect(save).toBeFocused();
    for (const moveFocus of [false, true]) {
      let complete!: () => void;
      const waiting = new Promise<void>(resolve => { complete = resolve; });
      let puts = 0;
      await page.route("**/api/v1/profile", async route => {
        if (route.request().method() === "PUT") { puts++; await waiting; }
        await route.continue();
      });
      const weight = page.getByLabel("Peso (kg)");
      await weight.focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("button", { name: "Salvataggio…" })).toBeDisabled();
      await page.getByRole("tabpanel", { name: "Obiettivo", exact: true }).locator("form").evaluate(form => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
      const back = page.getByRole("link", { name: "Torna alla dashboard" });
      if (moveFocus) await back.focus();
      complete();
      await expect(page.getByRole("status")).toContainText("Modifiche salvate");
      await expect(moveFocus ? back : weight).toBeFocused();
      expect(puts).toBe(1);
      await page.unroute("**/api/v1/profile");
    }
    expect(errors).toEqual([]);
  } finally { await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())); await client.close(); await rm(dir, { recursive: true, force: true }); process.env = oldEnv; resetEnvConfigCache(); }
}, 600000);
