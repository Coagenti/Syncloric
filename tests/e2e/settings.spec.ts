import { it } from "vitest";
import { chromium, expect } from "@playwright/test";
import { build } from "esbuild";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { buildNorishUrlHandlers } from "@/server/services/settings/http";
import type { Db } from "@/server/db";
import { norishBaseUrl, resetEnvConfigCache } from "@/server/config";
import { getAdminSetting } from "@/server/db/repositories/settings";

/** Real component + HTTP handlers + file-backed PostgreSQL WASM.
 * The session boundary is injected as admin; page/API authorization has separate tests.
 * No live Norish calls and no authentication bypass in application code.
 */
it("browser: validation, save, warning, restart persistence, clear and env fallback", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "syncloric-settings-"));
  const oldEnv = { ...process.env };
  Object.assign(process.env, {
    DATABASE_URL: "postgres://test@localhost:5432/test",
    BETTER_AUTH_SECRET: "test-only-not-a-real-secret-01234567890123456789",
    ENCRYPTION_KEY: "a".repeat(64),
    NORISH_BASE_URL: "https://fallback.example.invalid",
  });
  delete process.env.NORISH_API_KEY;
  resetEnvConfigCache();
  let client = new PGlite(dir);
  let db = drizzle(client);
  await migrate(db, { migrationsFolder: "./drizzle" });
  const handlers = buildNorishUrlHandlers({
    getDb: () => db as unknown as Db,
    getSession: async () => ({ user: { id: "test-admin", role: "admin" } }),
  });
  const bundle = await build({
    stdin: {
      contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
        import {SettingsNorishCard} from './src/components/settings/settings-norish-card';
        fetch('/api/v1/settings/norish-url').then(r=>r.json()).then(p=>createRoot(document.getElementById('root')).render(<SettingsNorishCard initialSaved={p.saved} initialStatus={p.status}/>));`,
      resolveDir: process.cwd(), loader: "tsx",
    },
    bundle: true, write: false, platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const server = createServer(async (req, res) => {
    try {
      if (req.url === "/app.js") { res.setHeader("Content-Type", "application/javascript"); res.end(bundle.outputFiles[0].text); return; }
      if (!req.url?.startsWith("/api/")) { res.setHeader("Content-Type", "text/html"); res.end('<html lang="it"><meta name="viewport" content="width=device-width"><div id="root"></div><script src="/app.js"></script></html>'); return; }
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const method = req.method as keyof typeof handlers;
      const response = await handlers[method](new Request("http://localhost" + req.url, {
        method, headers: { "content-type": "application/json" },
        ...(method === "PUT" ? { body: Buffer.concat(chunks).toString() } : {}),
      }));
      res.writeHead(response.status, { "Content-Type": "application/json" }); res.end(await response.text());
    } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: String(e) })); }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing server address");
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${address.port}`);
    const input = page.getByRole("textbox", { name: "Norish URL", exact: true });
    await expect(input).toHaveValue("");
    await expect(input).toHaveAttribute("placeholder", "your norish url");
    await expect(page.getByTestId("norish-source")).toHaveText("Configurato da: .env");
    await input.fill("your norish url"); await page.getByRole("button", { name: "Salva Norish", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("URL non valido");
    await input.fill(" https://gui.example.invalid "); await page.getByRole("button", { name: "Salva Norish", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("URL aggiornato: verifica le tue chiavi Norish");
    await expect(input).toHaveValue("https://gui.example.invalid");
    await client.close(); client = new PGlite(dir); db = drizzle(client); await client.waitReady;
    await page.reload(); await expect(input).toHaveValue("https://gui.example.invalid");
    await expect(page.getByTestId("norish-source")).toHaveText("Configurato da: Impostazioni");
    const persisted = await getAdminSetting<string>(db, "norish.base_url");
    expect(persisted).toBe("https://gui.example.invalid");
    expect(norishBaseUrl({ adminSettings: { "norish.base_url": persisted ?? undefined } })).toBe("https://gui.example.invalid");
    await input.fill("https://gui.example.invalid/path"); await page.getByRole("button", { name: "Salva Norish", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("URL Norish salvato");
    await page.getByRole("button", { name: "Cancella", exact: true }).click();
    await expect(input).toHaveValue(""); await expect(page.getByRole("status")).toContainText("verifica le tue chiavi");
    await expect(page.getByTestId("norish-source")).toHaveText("Configurato da: .env");
    await page.reload(); await expect(input).toHaveValue("");
    await input.fill("https://gui.example.invalid"); await page.getByRole("button", { name: "Salva Norish", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("verifica le tue chiavi");
    await input.fill(""); await page.getByRole("button", { name: "Salva Norish", exact: true }).click();
    await expect(page.getByTestId("norish-source")).toHaveText("Configurato da: .env");
    await expect(input).toHaveValue("");
    delete process.env.NORISH_BASE_URL;
    resetEnvConfigCache();
    await page.reload();
    await expect(input).toHaveValue("");
    await expect(input).toHaveAttribute("placeholder", "your norish url");
    await expect(page.getByTestId("norish-state")).toBeVisible();
    await expect(page.getByTestId("norish-source")).toHaveText("Norish non configurato");
    const unset = await page.request.get(`http://127.0.0.1:${address.port}/api/v1/settings/norish-url`);
    expect(unset.status()).toBe(200);
    expect(await unset.json()).toEqual({ saved: null, status: { enabled: false, source: "unset", urlPresent: false, apiKeyPresent: false } });
    await input.fill("https://gui-only.example.invalid");
    await page.getByRole("button", { name: "Salva Norish", exact: true }).click();
    await expect(page.getByTestId("norish-source")).toHaveText("Configurato da: Impostazioni");
    await page.reload();
    await expect(input).toHaveValue("https://gui-only.example.invalid");
    await page.getByRole("button", { name: "Cancella", exact: true }).click();
    await expect(page.getByTestId("norish-state")).toBeVisible();
    await page.reload();
    await expect(input).toHaveValue("");
    expect(await getAdminSetting(db, "norish.base_url")).toBeNull();
    expect(errors).toEqual([]);
  } finally {
    await browser.close(); await new Promise<void>(resolve => server.close(() => resolve()));
    await client.close(); await rm(dir, { recursive: true, force: true });
    process.env = oldEnv;
    resetEnvConfigCache();
  }
}, 600_000);
