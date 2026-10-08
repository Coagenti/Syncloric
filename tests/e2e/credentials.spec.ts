import { it, expect, vi } from "vitest";
import { chromium, expect as pw } from "@playwright/test";
import { build } from "esbuild";
import { createServer } from "node:http";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { makeTestDb, closeTestDb } from "../integration/setup";
import { sql } from "drizzle-orm";
import { resetEnvConfigCache } from "@/server/config";
import { buildCredentialHandlers } from "@/server/services/settings/credentials-http";
import { buildAiHandlers } from "@/server/services/ai/http";
import { buildNorishUrlHandlers } from "@/server/services/settings/http";
import { buildBarcodeSettingsHandlers } from "@/server/services/settings/barcode-http";
import { buildAdminUsersHandlers } from "@/server/services/settings/admin-users-http";
import { productionCss } from "./helpers/production-css";
import { buildExportTokenHandlers } from "@/server/services/export/http";

it("production settings: member Norish key and admin AI keys persist, rotate and delete without exposing values; mobile reflow", async () => {
  vi.stubEnv("DATABASE_URL", "postgres://test@localhost/test"); vi.stubEnv("BETTER_AUTH_SECRET", "x".repeat(64));
  vi.stubEnv("ENCRYPTION_KEY", "a".repeat(64)); vi.stubEnv("NORISH_BASE_URL", "https://norish.example.invalid"); vi.stubEnv("BETTER_AUTH_URL", undefined); resetEnvConfigCache();
  const db = await makeTestDb();
  const admin = "11111111-1111-4111-8111-111111111111", member = "22222222-2222-4222-8222-222222222222";
  await db.execute(sql`INSERT INTO users(id,username,role) VALUES (${admin}::uuid,'admin','admin'),(${member}::uuid,'member','user')`);
  const deps = { getDb: () => db as never, getSession: async (headers: Headers) => {
    const id = headers.get("x-test-user"); return id ? { user: { id, role: id === admin ? "admin" : "user" } } : null;
  } };
  const endpoints: Record<string, Record<string, (request: Request) => Promise<Response>>> = {
    "/api/v1/settings/export-tokens": buildExportTokenHandlers(deps),
    "/api/v1/settings/norish-key": buildCredentialHandlers(deps, "norish"),
    "/api/v1/settings/ai-key": buildCredentialHandlers({ ...deps, env: () => ({}) }, "ai"),
    "/api/v1/settings/ai": buildAiHandlers({ ...deps, env: () => ({}) }),
    "/api/v1/settings/norish-url": buildNorishUrlHandlers(deps),
    "/api/v1/settings/barcode": buildBarcodeSettingsHandlers(deps),
    "/api/v1/admin/users": buildAdminUsersHandlers(deps),
  };
  const bundle = await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import{SettingsContent}from'./src/components/settings/settings-content';createRoot(document.getElementById('root')).render(location.pathname==='/member'?<SettingsContent access="requires-admin"/>:<SettingsContent initialSaved={null} initialStatus={{enabled:true,source:'env',urlPresent:true,apiKeyPresent:false}}/>);`, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"', "process.env": '{}' } });
  const css = process.env.DIARY_VISUAL_CSS === "1" ? await productionCss() : "";
  const responses: string[] = [], hostErrors: string[] = [];
  const server = createServer(async (req, res) => {
    try {
      if (req.url === "/app.js") { res.setHeader("Content-Type", "application/javascript"); res.end(bundle.outputFiles[0].text); return; }
      if (req.url?.startsWith("/api/")) {
        if (req.url === "/api/v1/household" && req.method === "GET") { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ household: null })); return; }
        const handler = endpoints[req.url]?.[req.method!]; if (!handler) throw new Error("Unexpected API");
        const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
        const request = new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers: req.headers as Record<string,string>, ...(req.method === "GET" ? {} : { body: Buffer.concat(chunks).toString() }) });
        const response = await handler(request); const text = await response.text(); responses.push(text);
        res.writeHead(response.status, { "Content-Type": "application/json" }); res.end(text); return;
      }
      res.setHeader("Content-Type", "text/html"); res.end(`<html lang="it"><meta name="viewport" content="width=device-width"><style>${css}</style><div id="root"></div><script src="/app.js"></script></html>`);
    } catch (error) { hostErrors.push(String(error)); res.writeHead(500); res.end("Test host error"); }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 390, height: 950 } });
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    await page.setExtraHTTPHeaders({ "x-test-user": member }); await page.goto(url + "/member");
    await pw(page.getByText("Chiave Norish non configurata.", { exact: true })).toBeVisible();
    await pw(page.getByLabel("Provider AI")).toHaveCount(0);
    const norish = page.getByLabel("Chiave API Norish", { exact: true });
    await norish.fill("browser-member-secret"); await page.getByRole("button", { name: "Salva chiave Norish", exact: true }).click();
    await pw(page.getByText("Chiave Norish salvata.", { exact: true })).toBeVisible(); await pw(norish).toHaveValue("");
    await page.reload(); await pw(page.getByText("Chiave Norish configurata.", { exact: true })).toBeVisible(); await pw(norish).toHaveValue("");
    await norish.fill("browser-member-rotated"); await page.getByRole("button", { name: "Salva chiave Norish", exact: true }).click();
    await pw(page.getByText("Chiave Norish salvata.", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Rimuovi chiave Norish", exact: true }).click();
    await pw(page.getByText("Chiave Norish non configurata.", { exact: true })).toBeVisible();
    await page.setExtraHTTPHeaders({ "x-test-user": admin }); await page.goto(url + "/admin");
    await pw(page.getByText("Chiave Norish non configurata.", { exact: true })).toBeVisible(); // no cross-user fallback
    await page.getByLabel("Provider AI").selectOption("openai");
    await page.getByLabel("Chiave API OpenAI", { exact: true }).fill("browser-admin-openai");
    await page.getByRole("button", { name: "Salva chiave OpenAI", exact: true }).click();
    await pw(page.getByText("Chiave OpenAI salvata.", { exact: true })).toBeVisible();
    await page.getByLabel("Abilita scansione AI").check(); await page.getByRole("button", { name: "Salva AI", exact: true }).click();
    await pw(page.getByText("Impostazioni AI salvate.", { exact: true })).toBeVisible(); await page.reload();
    await pw(page.getByLabel("Chiave API OpenAI", { exact: true })).toHaveValue("");
    await pw(page.getByText("Chiave OpenAI configurata.", { exact: true })).toBeVisible();
    await page.getByLabel("Provider AI").selectOption("anthropic");
    await page.getByLabel("Chiave API Anthropic", { exact: true }).fill("browser-admin-anthropic");
    await page.getByRole("button", { name: "Salva chiave Anthropic", exact: true }).click();
    await pw(page.getByText("Chiave Anthropic salvata.", { exact: true })).toBeVisible();
    await pw(page.locator(".ai-settings-card > form").getByText("Chiave configurata", { exact: true })).toBeVisible();
    if (process.env.DIARY_VISUAL_CSS === "1") {
      const dir = "test-results/credentials"; await mkdir(dir, { recursive: true });
      for (const width of [320, 390, 1440]) {
        await page.setViewportSize({ width, height: 950 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        await page.evaluate(() => window.scrollTo(0,0)); await page.screenshot({ path: path.join(dir, `settings-${width}.png`), fullPage: true });
      }
    }
    await page.getByRole("button", { name: "Rimuovi chiave Anthropic", exact: true }).click();
    await pw(page.getByText("Chiave Anthropic non configurata.", { exact: true })).toBeVisible();
    for (const secret of ["browser-member-secret", "browser-member-rotated", "browser-admin-openai", "browser-admin-anthropic"]) {
      expect(responses.join("\n")).not.toContain(secret); expect(await page.content()).not.toContain(secret);
      expect(JSON.stringify((await db.execute(sql`SELECT * FROM admin_settings`)).rows)).not.toContain(secret);
    }
    expect(errors).toEqual([]); expect(hostErrors).toEqual([]);
  } finally { await browser?.close(); await new Promise<void>(resolve => server.close(() => resolve())); await closeTestDb(); vi.unstubAllEnvs(); resetEnvConfigCache(); }
}, 120_000);
