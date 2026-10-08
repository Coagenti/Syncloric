import { it, vi } from "vitest";
import { chromium, expect } from "@playwright/test";
import { build } from "esbuild";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { makeTestDb, closeTestDb, type TestDb } from "../integration/setup";
import { resetEnvConfigCache } from "@/server/config";
import { buildNorishUrlHandlers } from "@/server/services/settings/http";
import { buildDiaryFeedHandlers } from "@/server/services/diary/feed";
import { buildCredentialHandlers } from "@/server/services/settings/credentials-http";

let db: TestDb;
let requestHeaders = new Headers();
vi.mock("@/server/db", () => ({ getDb: () => db }));
vi.mock("next/headers", () => ({ headers: async () => requestHeaders }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));

/** Actual Better Auth handler/cookies, migrated PGlite, production components and page services.
 * HTTP host adapts Next's headers/redirect primitives only; no fabricated session or external API.
 */
it("browser: signup → persistent diary → logout → login, protected routes and non-admin settings", async () => {
  const oldEnv = { ...process.env };
  Object.assign(process.env, { DATABASE_URL: "postgres://test@localhost:5432/test", BETTER_AUTH_SECRET: "test-only-not-a-real-secret-01234567890123456789", ENCRYPTION_KEY: "a".repeat(64) });
  delete process.env.NORISH_API_KEY; delete process.env.NORISH_BASE_URL;
  resetEnvConfigCache();
  console.info("AUTH-E2E: database initialization");
  db = await makeTestDb();
  console.info("AUTH-E2E: database migrated");
  const { getAuth } = await import("@/server/auth");
  const { requirePageSession } = await import("@/server/auth/page-session");
  const { settingsPageProps } = await import("@/server/services/settings/page-data");
  const auth = getAuth();
  const diary = buildDiaryFeedHandlers({ getDb: () => db as never, getSession: headers => auth.api.getSession({ headers }) });
  const settings = buildNorishUrlHandlers({ getDb: () => db as never, getSession: headers => auth.api.getSession({ headers }) });
  const norishKey = buildCredentialHandlers({ getDb: () => db as never, getSession: headers => auth.api.getSession({ headers }) }, "norish");
  const bundle = await build({
    stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
      import {LoginForm} from './src/components/auth/login-form';
      import {CalorieApp} from './src/components/calorie-app';
      import {SettingsContent} from './src/components/settings/settings-content';
      const route=location.pathname;
      createRoot(document.getElementById('root')).render(route==='/login'?<main className="auth-shell"><LoginForm/></main>:route==='/settings'?<SettingsContent {...JSON.parse(document.getElementById('settings-props').textContent)}/>:<CalorieApp view={route==='/calendar'?'calendar':route==='/dashboard'?'dashboard':'diary'}/>);`, resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"', "process.env": '{"MODE":"production"}' },
  });
  // Test-only CSS: strip imports/theme wrapper while retaining the production rules and tokens.
  const css = (await readFile("src/app/globals.css", "utf8")).replace(/^@import .*;$/gm, "").replace("@theme {", ":root {");
  const server = createServer(async (req, res) => {
    console.info("AUTH-E2E: request", req.method, req.url);
    res.on("finish", () => console.info("AUTH-E2E: response", req.method, req.url, res.statusCode));
    try {
      const origin = `http://${req.headers.host}`;
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) if (value) headers.set(key, Array.isArray(value) ? value.join("; ") : value);
      if (req.url === "/app.js") { res.setHeader("Content-Type", "application/javascript"); res.end(bundle.outputFiles[0].text); return; }
      if (req.url === "/style.css") { res.setHeader("Content-Type", "text/css"); res.end(css); return; }
      if (req.url?.startsWith("/api/")) {
        const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
        const request = new Request(origin + req.url, { method: req.method, headers, ...(req.method === "POST" || req.method === "PUT" ? { body: Buffer.concat(chunks).toString() } : {}) });
        const response = req.url.startsWith("/api/auth/") ? await auth.handler(request) : req.url.startsWith("/api/v1/settings/norish-key") ? await norishKey[req.method as keyof typeof norishKey](request) : req.url.startsWith("/api/v1/settings/") ? await settings[req.method as keyof typeof settings](request) : await diary.GET(request);
        res.statusCode = response.status;
        response.headers.forEach((value, key) => { if (key !== "set-cookie") res.setHeader(key, value); });
        if (response.headers.getSetCookie().length) res.setHeader("set-cookie", response.headers.getSetCookie());
        res.end(await response.text()); return;
      }
      requestHeaders = headers;
      if (req.url !== "/login") await requirePageSession();
      const props = req.url === "/settings" ? await settingsPageProps(db as never) : null;
      res.setHeader("Content-Type", "text/html");
      res.setHeader("Cache-Control", "no-store");
      res.end(`<html lang="it"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/style.css"><div id="root"></div><script id="settings-props" type="application/json">${JSON.stringify(props).replace(/</g, "\\u003c")}</script><script src="/app.js"></script></html>`);
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("redirect:")) { res.writeHead(302, { Location: e.message.slice(9) }); res.end(); }
      else { res.writeHead(500); res.end(String(e)); }
    }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.setDefaultTimeout(30_000);
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    for (const route of ["dashboard", "diary", "calendar", "settings"]) {
      await page.goto(`${url}/${route}`); await expect(page).toHaveURL(`${url}/login`);
    }
    await page.getByRole("button", { name: "Accedi", exact: true }).click();
    await expect(page.getByRole("alert")).toBeFocused();
    await page.getByRole("button", { name: "Crea un account", exact: true }).click();
    await expect(page.getByLabel("Username", { exact: true })).toBeFocused();
    await page.getByLabel("Username", { exact: true }).fill("first_user");
    await page.getByLabel("Password", { exact: true }).fill("test-password-123");
    await page.getByRole("button", { name: "Crea account", exact: true }).click();
    await expect(page).toHaveURL(`${url}/diary`, { timeout: 60_000 });
    await expect(page.getByRole("heading", { name: "Diario." })).toBeVisible();
    await page.reload(); await expect(page).toHaveURL(`${url}/diary`);
    const cookies = await page.context().cookies();
    expect(cookies.some(c => c.name.includes("session_token") && c.httpOnly && c.sameSite === "Lax")).toBe(true);
    await page.goto(`${url}/settings`);
    await page.getByRole("tab", { name: "Norish", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Norish URL", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Richiede amministratore" })).toHaveCount(0);
    await page.goto(`${url}/diary`);
    const logoutResponse = page.waitForResponse(response => response.url().endsWith("/api/auth/sign-out"));
    await page.getByRole("button", { name: "Esci", exact: true }).click();
    const logout = await logoutResponse;
    // Navigation unloads the fetch document; reading its response body can hang in Chromium.
    // Status plus the protected-page redirect below verifies successful server-side revocation.
    expect(logout.status()).toBe(200);
    await expect(page).toHaveURL(`${url}/login`);
    await page.goto(`${url}/diary`); await expect(page).toHaveURL(`${url}/login`);
    await page.getByLabel("Username", { exact: true }).fill("first_user");
    await page.getByLabel("Password", { exact: true }).fill("wrong-password-123");
    const invalidLogin = page.waitForResponse(response => response.url().endsWith("/api/auth/sign-in/username"));
    await page.getByRole("button", { name: "Accedi", exact: true }).click();
    expect((await invalidLogin).status()).toBe(401);
    await expect(page.getByRole("alert")).toContainText("Username o password", { timeout: 30_000 });
    await expect(page.getByRole("alert")).toBeFocused();
    await page.getByLabel("Password", { exact: true }).fill("test-password-123");
    await page.getByRole("button", { name: "Accedi", exact: true }).click();
    await expect(page).toHaveURL(`${url}/diary`, { timeout: 60_000 });
    await page.goto(`${url}/login`); await expect(page).toHaveURL(`${url}/login`);
    // Hold one animation frame to reproduce a mode-switch focus callback arriving
    // after the user has already moved to Password (the intermittent CI failure).
    await page.evaluate(() => {
      const original = window.requestAnimationFrame;
      const pending: FrameRequestCallback[] = [];
      window.requestAnimationFrame = callback => { pending.push(callback); return pending.length; };
      Object.assign(window, { releaseAuthFocusFrame: () => {
        window.requestAnimationFrame = original;
        pending.splice(0).forEach(callback => callback(performance.now()));
      } });
    });
    await page.getByRole("button", { name: "Crea un account", exact: true }).click();
    await page.getByLabel("Password", { exact: true }).focus();
    await page.evaluate(() => (window as unknown as { releaseAuthFocusFrame: () => void }).releaseAuthFocusFrame());
    await expect(page.getByLabel("Password", { exact: true })).toBeFocused();
    await page.getByLabel("Username", { exact: true }).fill("second_user");
    await page.getByLabel("Password", { exact: true }).fill("test-password-123");
    await page.getByRole("button", { name: "Crea account", exact: true }).click();
    await expect(page).toHaveURL(`${url}/diary`, { timeout: 60_000 });
    for (const route of ["dashboard", "calendar", "diary"]) { await page.goto(`${url}/${route}`); await expect(page).toHaveURL(`${url}/${route}`); }
    await page.goto(`${url}/settings`);
    await page.getByRole("tab", { name: "Norish", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Richiede amministratore" })).toBeVisible();
    await expect(page.getByLabel("Chiave API Norish", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Provider AI", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Navigazione mobile" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Esci", exact: true })).toBeVisible();
    const denied = await page.request.put(`${url}/api/v1/settings/norish-url`, { data: { url: "https://example.invalid" } });
    expect(denied.status()).toBe(403);
    await page.goto(`${url}/login`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: "../login-mobile.png", fullPage: true });
    expect(errors).toEqual([]);
  } finally {
    await browser.close(); await new Promise<void>(resolve => server.close(() => resolve()));
    await closeTestDb(); process.env = oldEnv; resetEnvConfigCache();
  }
}, 600_000);
