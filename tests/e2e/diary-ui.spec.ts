/**
 * Prova end-to-end del flusso richiesto dalla card: pasto pianificato importato
 * dal client Norish (runner) su Postgres di test PGlite → proiezione feed
 * autenticata per utente → UI reale (dashboard/calendario) con kcal visibili.
 * Componente autentico via esbuild + Chromium reale; nessuna chiamata live
 * a Norish, nessun bypass di autenticazione nel codice applicativo.
 * Il file usa `it` di vitest (config e2e non carica hook @playwright/test);
 * la suite Playwright driver-based resta in playwright.config.ts.
 */
import { it, expect as vexpect } from "vitest";
import { chromium } from "@playwright/test";
import { build } from "esbuild";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { sql } from "drizzle-orm";
import { buildDiaryFeedHandlers } from "@/server/services/diary/feed";
import { runNorishSync } from "@/server/services/norish/runner";
import type { Db } from "@/server/db";
import { resetEnvConfigCache } from "@/server/config";

const USER = "11111111-1111-4111-8111-111111111111";
const RECIPE = "aaaaaaaa-1111-4111-8111-111111111111";
const ITEM = "bbbbbbbb-1111-4111-8111-111111111111";

it("e2e browser: synced calendar meal with kcal appears in the real UI for the user", async () => {
  const oldEnv = { ...process.env };
  Object.assign(process.env, {
    DATABASE_URL: "postgres://test@localhost:5432/test",
    BETTER_AUTH_SECRET: "test-only-not-a-real-secret-01234567890123456789",
    ENCRYPTION_KEY: "a".repeat(64),
    NORISH_BASE_URL: "https://norish-test.example.invalid",
  });
  delete process.env.NORISH_API_KEY;
  resetEnvConfigCache();
  const dir = await mkdtemp(path.join(tmpdir(), "syncloric-diary-e2e-"));
  const client = new PGlite(dir);
  const db = drizzle(client) as unknown as Db;
  await migrate(db as never, { migrationsFolder: "./drizzle" });
  await client.query("INSERT INTO users (id, username) VALUES ($1, 'eatwell')", [USER]);
  // 1) Il pasto segnato sul calendario norish (fixture GET-only) entra nel DB via runner.
  const syncResult = await runNorishSync({
    db,
    userId: USER,
    client: {
      getPlannedRecipesWeek: async () => [{ id: ITEM, date: "2026-09-29", slot: "Lunch" as const, sortOrder: 0, recipeId: RECIPE, version: 1, recipeName: "Ricetta Norish", recipeImage: null, servings: 2, calories: 458 }],
      getPlannedRecipesToday: async () => [],
      getRecipe: async () => ({ id: RECIPE, name: "Ricetta Norish", servings: 2, calories: 458, fat: null, carbs: null, protein: null }),
    },
  });
  vexpect(syncResult.imported).toBe(1);
  const handlers = buildDiaryFeedHandlers({
    getDb: () => db,
    getSession: async () => ({ user: { id: USER } }),
  });
  const bundle = await build({
    stdin: {
      contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
        import {CalorieApp} from './src/components/calorie-app';
        createRoot(document.getElementById('root')).render(<CalorieApp view="dashboard" />);`,
      resolveDir: process.cwd(), loader: "tsx",
    },
    bundle: true, write: false, platform: "browser", jsx: "automatic",
    define: {
      "process.env.NODE_ENV": '"production"',
      "process.env": '{"MODE":"production"}',
    },
  });
  const server = createServer(async (req, res) => {
    try {
      if (req.url === "/app.js") { res.setHeader("Content-Type", "application/javascript"); res.end(bundle.outputFiles[0].text); return; }
      if (req.url?.startsWith("/api/v1/diary")) {
        const response = await handlers.GET(new Request("http://localhost/api/v1/diary?month=2026-09", { headers: { cookie: "session-fixture" } }));
        res.writeHead(response.status, { "Content-Type": "application/json" }); res.end(await response.text()); return;
      }
      res.setHeader("Content-Type", "text/html"); res.end('<html lang="it"><meta name="viewport" content="width=device-width"><div id="root"></div><script type="module">import "/app.js";</script></html>');
    } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: String(e) })); }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: "Europe/Rome" });
    const page = await context.newPage();
    const pageErrors: string[] = []; page.on("pageerror", e => pageErrors.push(e.message));
    await page.clock.setFixedTime(new Date("2026-09-29T12:00:00"));
    await page.goto(`http://127.0.0.1:${port}`);
    const card = page.locator(".energy-card");
    await card.waitFor({ state: "visible", timeout: 15000 });
    // La dashboard mostra le kcal reali (458 per porzione × 1 porzione locale).
    await vexpect((await card.textContent()) ?? "").toContain("458");
    await vexpect(await page.getByRole("heading", { name: "Riepilogo del giorno." }).textContent()).toBeTruthy();
    // Il pasto è nello slot pranzo reale, con provenienza sincronizzata.
    const lunch = page.locator(".meal-card").nth(1);
    await vexpect((await lunch.textContent()) ?? "").toContain("Ricetta Norish");
    await vexpect((await lunch.textContent()) ?? "").toContain("458");
    // Nessun layer demo: zero scritture su localStorage.
    await vexpect(await page.evaluate(() => localStorage.length)).toBe(0);
    // Idempotenza: una seconda run non duplica voci né altera la UI.
    const again = await runNorishSync({
      db,
      userId: USER,
      client: {
        getPlannedRecipesWeek: async () => [{ id: ITEM, date: "2026-09-29", slot: "Lunch" as const, sortOrder: 0, recipeId: RECIPE, version: 1, recipeName: "Ricetta Norish", recipeImage: null, servings: 2, calories: 458 }],
        getPlannedRecipesToday: async () => [],
        getRecipe: async () => ({ id: RECIPE, name: "Ricetta Norish", servings: 2, calories: 458, fat: null, carbs: null, protein: null }),
      },
    });
    vexpect(again.imported).toBe(0);
    await page.reload();
    await card.waitFor({ state: "visible", timeout: 15000 });
    const servedEntries = await db.execute(sql`SELECT COUNT(*)::int AS n FROM diary_entries WHERE user_id = ${USER}::uuid AND source = 'norish_sync'`);
    vexpect(Number((servedEntries as unknown as { rows: Array<{ n: number }> }).rows[0]?.n ?? 0)).toBe(1);
    await page.goto(`http://127.0.0.1:${port}`); // stesso mese, vista coerente dopo il reload
    await card.waitFor({ state: "visible", timeout: 15000 });
    await vexpect((await card.textContent()) ?? "").toContain("458");
    vexpect(pageErrors).toEqual([]);
    console.log("DIAG-E e2e browser feed ok");
  } finally {
    await browser.close(); await new Promise<void>(resolve => server.close(() => resolve()));
    await client.close(); await rm(dir, { recursive: true, force: true });
    process.env = oldEnv;
    resetEnvConfigCache();
  }
}, 600_000);