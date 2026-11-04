import { it, expect } from "vitest";
import { chromium } from "@playwright/test";
import { build } from "esbuild";
import { createServer } from "node:http";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { buildBarcodeHandlers } from "@/server/services/foods/http";
import { buildFoodEntryHandlers } from "@/server/services/foods/entry-http";
import { buildDiaryCatalogHandlers } from "@/server/services/diary/catalog";
import { buildDiaryFeedHandlers } from "@/server/services/diary/feed";
import type { Db } from "@/server/db";
import { resetEnvConfigCache } from "@/server/config";

it("manual barcode: unknown product, confirmation, proportional diary kcal, reload and local lookup", async () => {
  const env = { ...process.env };
  Object.assign(process.env, { DATABASE_URL: "postgres://test@localhost/test", BETTER_AUTH_SECRET: "test-only-not-real-secret-01234567890123456789", ENCRYPTION_KEY: "a".repeat(64), NORISH_BASE_URL: "https://example.invalid" });
  delete process.env.NORISH_API_KEY; resetEnvConfigCache();
  const client = new PGlite();
  const db = drizzle(client) as unknown as Db;
  await migrate(db as never, { migrationsFolder: "./drizzle" });
  const user = "11111111-1111-4111-8111-111111111111";
  await client.query("INSERT INTO users(id,username) VALUES ($1,'barcode-browser')", [user]);
  let calls = 0;
  const deps = { getDb: () => db, getSession: async () => ({ user: { id: user } }) };
  const barcode = buildBarcodeHandlers({ ...deps, lookup: async () => { calls++; return null; } });
  const diary = buildDiaryFeedHandlers(deps);
  const foodEntry = buildFoodEntryHandlers({ ...deps, lookup: async () => { calls++; return null; } });
  const catalog = buildDiaryCatalogHandlers(deps);
  const bundle = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {FoodEntryView} from './src/components/food-entry/food-entry-view'; import {CalorieApp} from './src/components/calorie-app'; createRoot(document.getElementById('root')).render(location.pathname==='/diary/add'?<FoodEntryView initialDate={new URLSearchParams(location.search).get('date')||''} initialSlot={new URLSearchParams(location.search).get('slot')||'Snack'}/>:<CalorieApp view={location.pathname==='/diary/meal'?'meal':'diary'} initialSlot={new URLSearchParams(location.search).get('slot')||'Lunch'}/>);`, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"', "process.env": '{}' } });
  const server = createServer(async (req, res) => {
    try {
      if (req.url === "/app.js") { res.setHeader("Content-Type", "application/javascript"); res.end(bundle.outputFiles[0].text); return; }
      if (req.url?.startsWith("/api/")) {
        const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
        const url = `http://${req.headers.host}${req.url}`;
        const request = new Request(url, { method: req.method, headers: req.headers as Record<string,string>, ...(req.method === "POST" ? { body: Buffer.concat(chunks).toString() } : {}) });
        const pathname = new URL(url).pathname;
        const response = pathname.startsWith("/api/v1/barcode") ? await barcode.GET(request)
          : pathname === "/api/v1/foods/frequent" ? await foodEntry.FREQUENT(request)
          : pathname === "/api/v1/foods" ? await foodEntry.POST(request)
          : pathname.startsWith("/api/v1/foods/") ? await foodEntry.GET(request, pathname.split("/").at(-1)!)
          : pathname === "/api/v1/diary/catalog" ? await catalog.GET(request) : await diary.GET(request);
        res.writeHead(response.status, { "Content-Type": "application/json" }); res.end(await response.text()); return;
      }
      res.end('<html lang="it"><meta name="viewport" content="width=device-width"><div id="root"></div><script src="/app.js"></script></html>');
    } catch { res.writeHead(500); res.end('{}'); }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
    await page.clock.setFixedTime(new Date("2026-10-01T12:00:00"));
    await page.goto(`http://127.0.0.1:${(server.address() as {port:number}).port}`);
    const scan = page.getByRole("link", { name: "Scansiona", exact: true });
    await scan.click({ timeout: 10000 });
    await page.getByLabel("Codice a barre", { exact: true }).fill("8001234567890");
    await page.getByRole("button", { name: "Cerca prodotto" }).click();
    await page.getByLabel("Nome alimento", { exact: true }).fill("Snack barcode");
    await page.getByLabel("Kcal per 100 g").fill("400");
    await page.getByLabel("Quantità in grammi", { exact: true }).fill("25");
    await page.getByRole("button", { name: "Aggiungi a Spuntino", exact: true }).click();
    await page.locator(".entry-success").waitFor(); await page.getByRole("link", { name: "Fine", exact: true }).click(); await page.getByRole("link", { name: "Apri Spuntino", exact: true }).click(); await page.getByText("Snack barcode", { exact: true }).waitFor();
    expect((await client.query<{kcal:number}>("SELECT kcal FROM diary_entries")).rows[0].kcal).toBe(100);
    await page.reload(); await page.getByText("Snack barcode", { exact: true }).waitFor();
    const before = calls;
    await page.getByRole("link", { name: "Torna al diario", exact: true }).click();
    await scan.click(); await page.getByLabel("Codice a barre", { exact: true }).fill("8001234567890");
    await page.getByRole("button", { name: "Cerca prodotto" }).click();
    await page.getByRole("heading", { name: "Snack barcode", exact: true }).waitFor();
    expect(calls).toBe(before);
    await page.goBack();
    await page.getByRole("tab", { name: "Scansione", exact: true }).waitFor();
    expect(errors).toEqual([]);
  } finally {
    await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())); await client.close(); process.env = env; resetEnvConfigCache();
  }
}, 600000);
