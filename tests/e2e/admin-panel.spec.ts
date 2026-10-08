import { it, expect, vi } from "vitest";
import { chromium } from "@playwright/test";
import { build } from "esbuild";
import { createServer } from "node:http";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { productionCss } from "./helpers/production-css";
import { join } from "node:path";
import { buildAdminUsersHandlers } from "@/server/services/settings/admin-users-http";
import { buildBarcodeSettingsHandlers } from "@/server/services/settings/barcode-http";
import { buildAiHandlers } from "@/server/services/ai/http";
import { buildNorishUrlHandlers } from "@/server/services/settings/http";
import { buildCredentialHandlers } from "@/server/services/settings/credentials-http";
import { buildExportTokenHandlers } from "@/server/services/export/http";
import { resetEnvConfigCache } from "@/server/config";
import { users } from "@/server/db/schema";
import type { Db } from "@/server/db";
it("four admin sections: independent persistence, non-admin notice, mobile reflow, dirty and asynchronous states", async () => {
  vi.stubEnv("DATABASE_URL", "postgres://test@localhost:5432/test"); vi.stubEnv("BETTER_AUTH_SECRET", "test-only-value-012345678901234567890123456789"); vi.stubEnv("ENCRYPTION_KEY", "a".repeat(64)); vi.stubEnv("NORISH_BASE_URL", ""); vi.stubEnv("NORISH_API_KEY", undefined); resetEnvConfigCache();
  const client = new PGlite(); const db = drizzle(client) as unknown as Db;
  await migrate(db as never, { migrationsFolder: "./drizzle" });
  const adminId = "11111111-1111-4111-8111-111111111111";
  await db.insert(users).values([{ id: adminId, username: "fixture_admin", role: "admin" }, { id: "22222222-2222-4222-8222-222222222222", username: "fixture_" + "username_lungo_".repeat(8), role: "user", banned: true, banReason: "Fixture sintetica con motivo lungo. ".repeat(12) }, { id: "33333333-3333-4333-8333-333333333333", username: "fixture_other_admin", role: "admin" }]);
  const deps = { getDb: () => db, getSession: async () => ({ user: { id: adminId, role: "admin" } }) };
  const handlers = { users: buildAdminUsersHandlers(deps), ai: buildAiHandlers({ ...deps, env: () => ({}) }), barcode: buildBarcodeSettingsHandlers(deps), norish: buildNorishUrlHandlers(deps), norishKey: buildCredentialHandlers(deps, "norish"), aiKey: buildCredentialHandlers({ ...deps, env: () => ({}) }, "ai") };
  const exportHandlers = buildExportTokenHandlers(deps);
  const bundle = await build({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {SettingsContent} from './src/components/settings/settings-content';const member=location.search.includes('member');createRoot(document.getElementById('root')).render(<SettingsContent {...(member?{access:'requires-admin'}:{initialSaved:null,initialStatus:{enabled:false,source:'unset',urlPresent:false,apiKeyPresent:false}})}/>);`, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"', "process.env": '{}' } });
  let hold = false; let release: (() => void) | undefined; let aiWrites = 0; let fail = false;
  let holdDelete = false; let releaseDelete: (() => void) | undefined;
  let css = "";
  if (process.env.ADMIN_VISUAL_DIR) {
    css = await productionCss();
    mkdirSync(process.env.ADMIN_VISUAL_DIR, { recursive: true });
  }
  const server = createServer(async (req, res) => {
    if (req.url === "/app.js") { res.setHeader("Content-Type", "application/javascript"); res.end(bundle.outputFiles[0].text); return; }
    if (req.url === "/brand/syncloric-mark.png") { res.setHeader("Content-Type", "image/png"); res.end(await readFile("public/brand/syncloric-mark.png")); return; }
    if (req.url?.startsWith("/api/")) {
      const chunks: Buffer[] = []; for await (const c of req) chunks.push(Buffer.from(c));
      const request = new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers: req.headers as Record<string, string>, ...(req.method !== "GET" ? { body: Buffer.concat(chunks).toString() } : {}) });
      const chosen = req.url.endsWith("/export-tokens") ? exportHandlers : req.url.endsWith("/norish-key") ? handlers.norishKey : req.url.endsWith("/ai-key") ? handlers.aiKey : req.url.includes("/admin/users") ? handlers.users : req.url.endsWith("/ai") ? handlers.ai : req.url.endsWith("/barcode") ? handlers.barcode : handlers.norish;
      if (req.url.endsWith("/ai") && req.method === "PUT") { aiWrites++; if (hold) await new Promise<void>(resolve => { release = resolve; }); }
      if (req.url.endsWith("/norish-url") && req.method === "DELETE" && holdDelete) await new Promise<void>(resolve => { releaseDelete = resolve; });
      if (fail && req.method === "PUT") { res.writeHead(503, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Fixture server unavailable" })); return; }
      const response = await (chosen as Record<string, (r: Request) => Promise<Response>>)[req.method!](request);
      res.writeHead(response.status, { "Content-Type": "application/json" }); res.end(await response.text()); return;
    }
    res.end(`<html lang="it"><meta name="viewport" content="width=device-width"><style>${css}</style><div id="root"></div><script src="/app.js"></script></html>`);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } }); const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    page.on("pageerror", error => console.error("ADMIN_PAGE_ERROR", error.message));
    page.on("response", response => { if (response.url().includes("/api/") && !response.ok()) console.error("ADMIN_HTTP", response.status(), response.url()); });
    await page.goto(url + "/settings"); await page.getByRole("tabpanel", { name: "Generali", exact: true }).waitFor();
    expect(await page.getByRole("tab").allTextContents()).toEqual(["Generali", "Nucleo", "Norish", "I miei dati", "ScansioneADMIN", "UtentiADMIN"]);
    expect(await page.getByLabel("Provider AI").count()).toBe(0);
    await page.getByRole("tab", { name: "Utenti", exact: true }).click(); await page.getByRole("listitem").first().waitFor();
    await page.getByRole("tab", { name: "Norish", exact: true }).click();
    await page.getByRole("button", { name: "Salva Norish", exact: true }).waitFor();
    await page.getByRole("tab", { name: "Scansione", exact: true }).click();
    const norish = page.locator('[aria-labelledby="norish-url-heading"]'); const ai = page.locator('[aria-labelledby="ai-settings-title"]');
    await page.getByLabel("Provider AI").selectOption("ollama"); await ai.getByText("Modifiche non salvate", { exact: true }).waitFor();
    await page.getByLabel("Abilita scansione AI").check(); hold = true;
    await page.getByRole("button", { name: "Salva AI", exact: true }).click();
    await ai.getByText("Salvataggio AI in corso…").waitFor();
    await page.getByRole("button", { name: "Salva AI", exact: true }).dispatchEvent("click");
    await page.getByRole("tab", { name: "Norish", exact: true }).click();
    await page.getByRole("textbox", { name: "Norish URL" }).fill("https://fixture.example.invalid");
    await page.getByRole("textbox", { name: "Norish URL" }).focus(); expect(aiWrites).toBe(1); release?.(); hold = false;
    await page.getByText("Impostazioni AI salvate.", { exact: true }).waitFor({ state: "attached" });
    expect(await page.getByRole("textbox", { name: "Norish URL" }).evaluate(e => e === document.activeElement)).toBe(true);
    await norish.getByText("Modifiche non salvate", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Salva Norish", exact: true }).click();
    await page.getByText("URL aggiornato: verifica le tue chiavi Norish", { exact: true }).waitFor();
    const norishInput = page.getByRole("textbox", { name: "Norish URL" });
    const submittedUrl = await norishInput.inputValue();
    holdDelete = true;
    await norish.getByRole("button", { name: "Cancella", exact: true }).click();
    await vi.waitFor(() => expect(releaseDelete).toBeTypeOf("function"));
    await norishInput.fill("https://newer-draft.example.invalid");
    // An edit away and back is still a newer draft (ABA), not the deleted baseline.
    await norishInput.fill(submittedUrl);
    await norishInput.focus();
    releaseDelete?.(); holdDelete = false;
    await norish.getByTestId("norish-source").filter({ hasText: "Norish non configurato" }).waitFor();
    expect(await norishInput.inputValue()).toBe(submittedUrl);
    expect(await norishInput.evaluate(e => e === document.activeElement)).toBe(true);
    await norish.getByText("Modifiche non salvate", { exact: true }).waitFor();
    const deleted = await page.request.get(url + "/api/v1/settings/norish-url");
    expect((await deleted.json()).saved).toBeNull();
    await norish.getByRole("button", { name: "Salva Norish", exact: true }).click();
    await norish.getByText("URL aggiornato: verifica le tue chiavi Norish", { exact: true }).waitFor();
    expect(await norish.getByText("Modifiche non salvate", { exact: true }).count()).toBe(0);
    await page.getByRole("tab", { name: "Scansione", exact: true }).click();
    await page.getByLabel("Ricerca prodotti su Open Food Facts").uncheck(); await page.getByRole("button", { name: "Salva Barcode" }).click(); await page.getByText("Impostazioni Barcode salvate.", { exact: true }).waitFor();
    await page.reload(); await page.getByLabel("Provider AI").waitFor(); expect(await page.getByLabel("Provider AI").inputValue()).toBe("ollama"); expect(await page.getByLabel("Ricerca prodotti su Open Food Facts").isChecked()).toBe(false);
    await page.getByLabel("Provider AI").selectOption("anthropic"); fail = true; await page.getByRole("button", { name: "Salva AI", exact: true }).click();
    await ai.getByRole("alert").waitFor(); expect(await ai.getByRole("alert").innerText()).toContain("Non è stato possibile verificare il salvataggio."); expect(await page.getByLabel("Provider AI").inputValue()).toBe("anthropic"); fail = false;
    // Arrow/Home/End navigation uses one focusable tab and keeps the unsaved draft mounted.
    const scanTab = page.getByRole("tab", { name: "Scansione", exact: true });
    await scanTab.focus(); await scanTab.press("Home"); await page.getByRole("tabpanel", { name: "Generali", exact: true }).waitFor();
    expect(await page.getByRole("tab", { name: "Generali", exact: true }).evaluate(el => el === document.activeElement)).toBe(true);
    await page.keyboard.press("End"); await page.getByRole("tabpanel", { name: "Utenti", exact: true }).waitFor();
    await page.keyboard.press("ArrowLeft"); await page.getByRole("tabpanel", { name: "Scansione", exact: true }).waitFor();
    expect(await page.getByLabel("Provider AI").inputValue()).toBe("anthropic");
    expect(await page.getByRole("tablist").locator('[tabindex="0"]').count()).toBe(1);
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 900 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (process.env.ADMIN_VISUAL_DIR) await page.screenshot({ path: join(process.env.ADMIN_VISUAL_DIR, `admin-${width}.png`), fullPage: true });
      await page.getByRole("tab", { name: "Generali", exact: true }).click();
      await page.mouse.move(0, 0);
      if (process.env.ADMIN_VISUAL_DIR) await page.screenshot({ path: join(process.env.ADMIN_VISUAL_DIR, `generali-${width}.png`), fullPage: true });
      await page.getByRole("tab", { name: "Scansione", exact: true }).click();
    }
    // Losing the admin role removes previously visited privileged panels as well as their tabs.
    await page.getByRole("tab", { name: "Utenti", exact: true }).click();
    const self = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: "fixture_admin", exact: true }) });
    await self.getByRole("button", { name: "Rimuovi ruolo amministratore", exact: true }).click();
    await self.getByRole("button", { name: "Conferma rimozione ruolo", exact: true }).click();
    await page.getByRole("heading", { name: "Richiede amministratore", exact: true }).waitFor();
    expect(await page.getByRole("tab", { name: "Utenti", exact: true }).count()).toBe(0);
    expect(await page.getByRole("tab", { name: "Scansione", exact: true }).count()).toBe(0);
    expect(await page.getByLabel("Provider AI", { exact: true }).count()).toBe(0);
    expect(await page.getByRole("tab", { name: "Generali", exact: true }).getAttribute("aria-selected")).toBe("true");
    expect(await page.locator('.settings-page > [tabindex="-1"]').evaluate(el => el === document.activeElement)).toBe(true);
    await page.goto(url + "?member");
    expect(await page.getByRole("tab", { name: "Utenti", exact: true }).count()).toBe(0);
    expect(await page.getByRole("tab", { name: "Scansione", exact: true }).count()).toBe(0);
    await page.getByRole("tab", { name: "Norish", exact: true }).click(); await page.getByText("Richiede amministratore", { exact: true }).waitFor(); expect(await page.getByLabel("Chiave API Norish", { exact: true }).count()).toBe(1);
    expect(await page.getByLabel("Provider AI", { exact: true }).count()).toBe(0);
    await page.getByRole("tab", { name: "Generali", exact: true }).click();
    expect(await page.getByRole("switch", { name: "Riduci animazioni" }).count()).toBe(1);
    expect(await page.getByRole("switch", { name: "Abilita scansione AI" }).count()).toBe(0);
  } finally { release?.(); releaseDelete?.(); await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())); await client.close(); vi.unstubAllEnvs(); resetEnvConfigCache(); }
}, 600000);
