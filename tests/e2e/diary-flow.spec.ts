import { expect as jestExpect, it, vi } from "vitest";
import { chromium, expect } from "@playwright/test";
import { build } from "esbuild";
import { createServer } from "node:http";
import { sql } from "drizzle-orm";
import { makeTestDb, closeTestDb, type TestDb } from "../integration/setup";
import { resetEnvConfigCache } from "@/server/config";
import { buildDiaryFeedHandlers } from "@/server/services/diary/feed";
import { buildDiaryCreateHandlers } from "@/server/services/diary/create";
import { buildDiaryMutationHandlers } from "@/server/services/diary/mutate";
import { buildFoodEntryHandlers } from "@/server/services/foods/entry-http";
import { buildDiaryCatalogHandlers } from "@/server/services/diary/catalog";
import { buildSyncHandlers } from "@/server/services/norish/http";
import { NorishApiError } from "@/server/services/norish/client";
import type { runNorishSync, SyncPort } from "@/server/services/norish/runner";

let db: TestDb;
let requestHeaders = new Headers();
vi.mock("@/server/db", () => ({ getDb: () => db }));
vi.mock("next/headers", () => ({ headers: async () => requestHeaders }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));

/** Production login/client/services and real session cookies over local HTTP/PGlite.
 * Only Next page hosting is adapted. Norish is disabled for diary writes; the cached
 * recipe is a fixture. Sync injects a mocked runner/client at the upstream boundary.
 * No diary, sync HTTP response or session is synthesized; all egress is fail-closed.
 */
it("browser: login → inline food/recipe → persisted feed/dashboard → manual edit → on-demand sync notice", async () => {
  const log = (stage: string) => console.info(`FLOW: ${stage}`);
  const oldEnv = { ...process.env };
  Object.assign(process.env, {
    DATABASE_URL: "postgres://test@localhost:5432/test",
    BETTER_AUTH_SECRET: "test-only-not-a-real-secret-01234567890123456789",
    ENCRYPTION_KEY: "a".repeat(64),
  });
  delete process.env.NORISH_API_KEY;
  delete process.env.NORISH_BASE_URL;
  resetEnvConfigCache();
  let browser;
  let server: ReturnType<typeof createServer> | undefined;
  const upstream = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    throw new Error("Unexpected server-side external fetch");
  });
  try {
    log("database initializing");
    db = await makeTestDb();
    log("database ready");
    const { getAuth } = await import("@/server/auth");
    const { requirePageSession } = await import("@/server/auth/page-session");
    const auth = getAuth();
    log("auth ready");
    const deps = { getDb: () => db as never, getSession: (headers: Headers) => auth.api.getSession({ headers }) };
    const feed = buildDiaryFeedHandlers(deps);
    const create = buildDiaryCreateHandlers(deps);
    const mutate = buildDiaryMutationHandlers(deps);
    const catalog = buildDiaryCatalogHandlers(deps);
    const foodEntry = buildFoodEntryHandlers({ ...deps, lookup: async () => null, search: async () => ({ foods: [], hasMore: false }) });
    // DI only at the upstream boundary: HTTP guards, lock, audit and feed stay real.
    const client: SyncPort = {
      getPlannedRecipesWeek: vi.fn(), getPlannedRecipesToday: vi.fn(), getRecipe: vi.fn(),
    };
    let releaseSync!: () => void;
    const syncGate = new Promise<void>(resolve => { releaseSync = resolve; });
    const runSync = vi.fn<typeof runNorishSync>().mockImplementationOnce(async () => {
      await syncGate;
      return { imported: 2, updated: 1, skipped: 0, marked: 0 };
    }).mockResolvedValueOnce({ imported: 0, updated: 0, skipped: 1, marked: 0, partial: true })
      .mockRejectedValueOnce(new NorishApiError("test-only auth failure", 401));
    const resolveClient = vi.fn(async () => client);
    const sync = buildSyncHandlers({ ...deps, resolveClient, runSync });
    const recipeId = "bbbbbbbb-1111-4111-8111-111111111111";
    await db.execute(sql`INSERT INTO recipes (id, name, servings, kcal_per_serving, snapshot) VALUES (${recipeId}::uuid, 'Pasta fixture', 4, 320, '{}'::jsonb)`);
    log("recipe seeded");
    const bundle = await build({
      stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';
        import{LoginForm}from'./src/components/auth/login-form';
        import{FoodEntryView}from'./src/components/food-entry/food-entry-view';
        import{CalorieApp}from'./src/components/calorie-app';
        createRoot(document.getElementById('root')).render(location.pathname==='/login'?<LoginForm/>:location.pathname==='/diary/add'?<FoodEntryView initialDate={new URLSearchParams(location.search).get('date')||''} initialSlot={new URLSearchParams(location.search).get('slot')||'Lunch'}/>:<CalorieApp view={location.pathname==='/dashboard'?'dashboard':'diary'}/>);`, resolveDir: process.cwd(), loader: "tsx" },
      bundle: true, write: false, platform: "browser", jsx: "automatic",
      define: { "process.env.NODE_ENV": '"production"', "process.env": '{}' },
    });
    log(`bundle built ${bundle.outputFiles[0].text.length} chars`);
    const hostErrors: string[] = [];
    server = createServer(async (req, res) => {
      console.info("FLOW: request", req.method, req.url);
      try {
        const origin = `http://${req.headers.host}`;
        const headers = new Headers();
        for (const [key, value] of Object.entries(req.headers)) if (value) headers.set(key, Array.isArray(value) ? value.join("; ") : value);
        if (req.url === "/app.js") { res.setHeader("Content-Type", "application/javascript"); res.end(bundle.outputFiles[0].text); return; }
        if (req.url?.startsWith("/api/")) {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(Buffer.from(chunk));
          const request = new Request(origin + req.url, { method: req.method, headers,
            ...(["POST", "PATCH", "PUT"].includes(req.method ?? "") ? { body: Buffer.concat(chunks).toString() } : {}) });
          const pathname = new URL(request.url).pathname;
          const response = pathname.startsWith("/api/auth/") ? await auth.handler(request)
            : pathname === "/api/v1/sync" && req.method === "POST" ? await sync.POST(request)
            : pathname === "/api/v1/foods/frequent" ? await foodEntry.FREQUENT(request)
            : pathname === "/api/v1/foods" && req.method === "POST" ? await foodEntry.POST(request)
            : pathname.startsWith("/api/v1/foods/") ? await foodEntry.GET(request, pathname.split("/").pop()!)
            : pathname === "/api/v1/diary/catalog" ? await catalog.GET(request)
            : pathname === "/api/v1/diary" && req.method === "GET" ? await feed.GET(request)
            : pathname === "/api/v1/diary" && req.method === "POST" ? await create.POST(request)
            : pathname.startsWith("/api/v1/diary/") && req.method === "PATCH" ? await mutate.PATCH(request, { params: Promise.resolve({ id: pathname.split("/").pop()! }) })
            : new Response("Unexpected API", { status: 404 });
          res.statusCode = response.status;
          response.headers.forEach((value, key) => { if (key !== "set-cookie") res.setHeader(key, value); });
          if (response.headers.getSetCookie().length) res.setHeader("set-cookie", response.headers.getSetCookie());
          res.end(await response.text());
          console.info("FLOW: response", req.method, req.url, response.status);
          return;
        }
        requestHeaders = headers;
        if (req.url !== "/login") await requirePageSession();
        res.setHeader("Content-Type", "text/html");
        res.setHeader("Cache-Control", "no-store");
        res.end('<html lang="it"><meta name="viewport" content="width=device-width"><div id="root"></div><script src="/app.js"></script></html>');
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("redirect:")) { res.writeHead(302, { Location: error.message.slice(9) }); console.info("FLOW: redirect", error.message.slice(9)); }
        else { hostErrors.push(String(error)); res.writeHead(500); console.info("FLOW: host error", String(error)); }
        res.end();
      }
    });
    await new Promise<void>(resolve => server!.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    log(`server listening ${url}`);
    browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    log("chromium launched");
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
    const external: string[] = [];
    await context.route("**/*", route => {
      if (new URL(route.request().url()).origin !== url) { external.push(route.request().url()); return route.abort("blockedbyclient"); }
      return route.continue();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    await page.clock.setFixedTime(new Date("2026-09-29T12:00:00"));
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    log("goto /diary (expect login redirect)");
    await page.goto(`${url}/diary`);
    await expect(page).toHaveURL(`${url}/login`);
    log("anonymous redirect asserted");
    // Seed credentials through real signup, then revoke that session so the scenario
    // starts with a real UI login rather than treating signup as login coverage.
    const signup = await page.request.post(`${url}/api/auth/sign-up/email`, { data: {
      email: "diary-flow@example.invalid", name: "Diary Flow", username: "diary_flow", password: "test-password-123",
    } });
    log(`signup status ${signup.status()}`);
    expect(signup.status()).toBe(200);
    expect((await page.request.post(`${url}/api/auth/sign-out`, { data: {} })).status()).toBe(200);
    log("signup session revoked");
    expect((await page.request.get(`${url}/api/v1/diary?month=2026-09`)).status()).toBe(401);
    await page.getByLabel("Username", { exact: true }).fill("diary_flow");
    await page.getByLabel("Password", { exact: true }).fill("test-password-123");
    const login = page.waitForResponse(r => r.url().endsWith("/api/auth/sign-in/username"));
    await page.getByRole("button", { name: "Accedi", exact: true }).click();
    expect((await login).status()).toBe(200);
    log("login response 200");
    await expect(page).toHaveURL(`${url}/diary`, { timeout: 60_000 });
    log("arrived at /diary");
    expect((await context.cookies()).some(c => c.name.includes("session_token") && c.httpOnly)).toBe(true);
    const getFeed = async () => {
      const response = await page.request.get(`${url}/api/v1/diary?month=2026-09`);
      expect(response.status()).toBe(200);
      return response.json();
    };
    expect((await getFeed()).entries).toEqual([]);
    log("empty feed asserted");
    await page.locator('[data-add-slot="Lunch"]').click();
    await page.getByLabel("Pasto", { exact: true }).selectOption("Snack");
    await page.getByRole("button", { name: "Inserisci un alimento manualmente" }).click();
    await page.getByLabel("Nome alimento", { exact: true }).fill("Yogurt fixture");
    await page.getByLabel("Quantità in grammi", { exact: true }).fill("125");
    await page.getByLabel("Kcal per 100 g", { exact: true }).fill("64");
    const foodWrite = page.waitForResponse(r => r.url().endsWith("/api/v1/foods") && r.request().method() === "POST");
    await page.getByRole("button", { name: "Aggiungi a Spuntino", exact: true }).click();
    expect((await foodWrite).status()).toBe(201);
    await expect(page.getByRole("status")).toContainText("Yogurt fixture aggiunto");
    await page.getByRole("link", { name: "Fine", exact: true }).click();
    const food = (await getFeed()).entries[0];
    expect(food).toMatchObject({ name: "Yogurt fixture", source: "manual", entryType: "food", quantityGrams: 125, kcal: 80, slot: "Snack", date: "2026-09-29" });
    expect(food.foodId).toBeTruthy();
    await page.locator('[data-add-slot="Lunch"]').click();
    await page.locator(".entry-recipes summary").click();
    await page.getByRole("button", { name: "Scegli Pasta fixture", exact: true }).click();
    await page.getByLabel("Numero di porzioni").fill("2.5");
    const recipeWrite = page.waitForResponse(r => r.url().endsWith("/api/v1/diary") && r.request().method() === "POST");
    await page.getByRole("button", { name: "Aggiungi a Pranzo", exact: true }).click();
    expect((await recipeWrite).status()).toBe(201);
    await expect(page.getByRole("status")).toContainText("Pasta fixture aggiunto");
    await page.getByRole("link", { name: "Fine", exact: true }).click();
    expect((await getFeed()).entries).toEqual(expect.arrayContaining([expect.objectContaining({ id: food.id, kcal: 80 }), expect.objectContaining({ recipeId, name: "Pasta fixture", source: "manual", servings: 2.5, kcal: 800 })]));
    expect((await getFeed()).entries).toHaveLength(2);
    await page.goto(`${url}/dashboard`);
    await expect(page.locator(".meal-card").filter({ hasText: "Yogurt fixture" })).toContainText("80");
    await expect(page.locator(".meal-card").filter({ hasText: "Pasta fixture" })).toContainText("800");
    await expect(page.locator(".energy-number")).toHaveText("880");
    await expect(page.locator(".energy-unit")).toHaveText("kcal");
    log("dashboard reflects both entries");
    await page.goto(`${url}/diary`);
    await page.locator(".entry-row").filter({ hasText: "Yogurt fixture" }).getByRole("button", { name: "Modifica" }).click();
    const editor = page.getByRole("dialog", { name: "Modifica voce" });
    await editor.getByRole("spinbutton", { name: "Kcal totali" }).fill("120");
    await editor.getByRole("combobox", { name: "Pasto" }).selectOption("Breakfast");
    const editWrite = page.waitForResponse(r => r.url().endsWith(`/api/v1/diary/${food.id}`) && r.request().method() === "PATCH");
    await editor.getByRole("button", { name: "Salva voce" }).click();
    expect((await editWrite).status()).toBe(200);
    log("manual edit PATCH 200");
    await expect(editor).not.toBeVisible();
    await expect(page.getByRole("region", { name: "Colazione", exact: true }).locator(".entry-row")).toContainText("120");
    expect((await getFeed()).entries.find((entry: { id: string }) => entry.id === food.id)).toMatchObject({ kcal: 120, slot: "Breakfast", source: "manual" });
    await page.reload();
    await expect(page.locator(".entry-row").filter({ hasText: "Yogurt fixture" })).toContainText("120");
    await page.goto(`${url}/dashboard`);
    await expect(page.locator(".energy-number")).toHaveText("920");
    await expect(page.locator(".meal-card").filter({ hasText: "Yogurt fixture" })).toContainText("Colazione");
    log("edit reflected in feed and dashboard");
    await expect(page.locator(".sync-dot.idle")).toHaveCount(1);
    process.env.NORISH_BASE_URL = "https://norish.example.invalid";
    resetEnvConfigCache();
    const session = await auth.api.getSession({ headers: new Headers({ cookie: (await context.cookies()).map(c => `${c.name}=${c.value}`).join("; ") }) });
    expect(session?.user.id).toBeTruthy();
    const syncResponse = () => page.waitForResponse(r => r.url().endsWith("/api/v1/sync") && r.request().method() === "POST");
    const firstSync = syncResponse();
    await page.getByRole("button", { name: "Sincronizza ora", exact: true }).click();
    try {
      await jestExpect.poll(() => runSync.mock.calls.length).toBe(1);
      await expect(page.getByRole("button", { name: "Sincronizzazione…", exact: true })).toBeDisabled();
      await expect(page.getByRole("status").filter({ hasText: "Sincronizzazione in corso…" })).toBeVisible();
      jestExpect(runSync.mock.calls[0][0]).toMatchObject({ userId: session!.user.id, client });
    } finally { releaseSync(); }
    const completed = await firstSync;
    expect(completed.status()).toBe(200);
    const outcome = await completed.json();
    expect(outcome).toMatchObject({ status: "ok", reason: null, origin: null, finishedAt: expect.any(String) });
    await expect(page.locator(".sync-dot.ok")).toHaveCount(1);
    expect((await getFeed()).sync).toEqual(outcome);
    await page.reload();
    await expect(page.locator(".sync-dot.ok")).toHaveCount(1);
    for (const [status, text] of [["partial", "Sincronizzazione Norish: parziale."], ["error", "Sincronizzazione fallita per autenticazione"]] as const) {
      const response = syncResponse();
      await page.getByRole("button", { name: "Sincronizza ora", exact: true }).click();
      const result = await response;
      expect(result.status()).toBe(200);
      const state = await result.json();
      expect(state.status).toBe(status);
      await expect(page.getByRole(status === "error" ? "alert" : "status").filter({ hasText: text })).toBeVisible();
      expect((await getFeed()).sync).toEqual(state);
      await page.reload();
      await expect(page.getByRole(status === "error" ? "alert" : "status").filter({ hasText: text })).toBeVisible();
    }
    await expect(page.getByRole("alert")).toContainText("Verifica o sostituisci la tua chiave personale");
    await expect(page.getByRole("alert").getByRole("link", { name: "Impostazioni" })).toHaveAttribute("href", "/settings#norish");
    jestExpect(runSync).toHaveBeenCalledTimes(3);
    jestExpect(resolveClient).toHaveBeenCalledTimes(3);
    for (const method of Object.values(client)) jestExpect(method).not.toHaveBeenCalled();
    const audit = await db.execute(sql`SELECT status, items_upserted, reason FROM norish_sync_runs WHERE user_id=${session!.user.id}::uuid ORDER BY started_at`);
    expect(audit.rows).toMatchObject([
      { status: "ok", items_upserted: 3, reason: null },
      { status: "partial", items_upserted: 0, reason: null },
      { status: "error", items_upserted: 0, reason: "auth" },
    ]);
    log("sync runner → notice → persisted feed/reload outcomes asserted");
    expect(hostErrors).toEqual([]);
    expect(errors).toEqual([]);
    expect(external).toEqual([]);
    jestExpect(upstream).not.toHaveBeenCalled();
    log("PASS assertions complete");
  } finally {
    try { await browser?.close(); }
    finally {
      if (server?.listening) await new Promise<void>(resolve => server!.close(() => resolve()));
      await closeTestDb();
      upstream.mockRestore();
      process.env = oldEnv;
      resetEnvConfigCache();
    }
  }
}, 600_000);
