import { it, expect } from "vitest";
import { chromium } from "@playwright/test";
import { build } from "esbuild";
import { createServer } from "node:http";
const admin = { id: "11111111-1111-4111-8111-111111111111", username: "fixture_admin", role: "admin", banned: false, banReason: null, createdAt: "2026-01-01T00:00:00Z" };
const member = { ...admin, id: "22222222-2222-4222-8222-222222222222", username: "fixture_member", role: "user" };
it("users confirmation, required reason, final-admin protection, keyboard focus and independent async mutations", async () => {
  let rows = [admin, member]; let mode = "normal"; let writes = 0; let release: (() => void) | undefined;
  const bundle = await build({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {SettingsUsersCard} from './src/components/settings/settings-users-card';createRoot(document.getElementById('root')).render(<><SettingsUsersCard onAccessLost={()=>{}}/><label>Altra sezione<input aria-label="Altra sezione"/></label></>);`, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' } });
  const server = createServer(async (req, res) => {
    if (req.url === "/app.js") { res.setHeader("Content-Type", "application/javascript"); res.end(bundle.outputFiles[0].text); return; }
    if (req.url === "/api/v1/admin/users") {
      res.setHeader("Content-Type", "application/json");
      if (req.method === "GET") {
        if (mode === "error") { res.statusCode = 503; res.end(JSON.stringify({ error: "Non disponibile" })); return; }
        res.end(JSON.stringify({ users: mode === "empty" ? [] : rows, currentUserId: admin.id })); return;
      }
      const chunks: Buffer[] = []; for await (const c of req) chunks.push(Buffer.from(c));
      const body = JSON.parse(Buffer.concat(chunks).toString()); writes++;
      if (mode === "uncertain") { res.statusCode = 503; res.end('{}'); return; }
      if (mode === "held") await new Promise<void>(resolve => { release = resolve; });
      if (mode === "denied") { res.statusCode = 409; res.end(JSON.stringify({ code: "LAST_ACTIVE_ADMIN", error: "Deve restare almeno un amministratore attivo." })); return; }
      rows = rows.map(row => row.id === body.userId ? { ...row, ...(body.action === "promote" ? { role: "admin" } : body.action === "demote" ? { role: "user" } : { banned: body.action === "ban", banReason: body.reason }) } : row);
      res.end(JSON.stringify({ saved_ok: true, accessLost: false })); return;
    }
    res.end('<html lang="it"><meta name="viewport" content="width=device-width"><div id="root"></div><script src="/app.js"></script></html>');
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    await page.goto(url);
    const first = page.getByRole("listitem").filter({ hasText: "fixture_admin" });
    const second = page.getByRole("listitem").filter({ hasText: "fixture_member" });
    await second.waitFor(); expect(await first.getByRole("button", { name: "Rimuovi ruolo amministratore", exact: true }).isDisabled()).toBe(true);
    await second.getByRole("button", { name: "Promuovi ad amministratore", exact: true }).click();
    await page.getByRole("button", { name: "Conferma promozione" }).waitFor();
    expect(await page.getByRole("button", { name: "Conferma promozione" }).evaluate(e => e === document.activeElement)).toBe(true);
    await second.getByRole("button", { name: "Annulla" }).click();
    expect(await second.getByRole("button", { name: "Promuovi ad amministratore", exact: true }).evaluate(e => e === document.activeElement)).toBe(true);
    await second.getByRole("button", { name: "Sospendi utente", exact: true }).click();
    await second.getByRole("button", { name: "Conferma sospensione" }).click();
    await second.getByRole("alert").waitFor(); expect(writes).toBe(0);
    await second.getByRole("textbox", { name: "Motivo" }).fill("Fixture motivo sintetico");
    mode = "held";
    await second.getByRole("button", { name: "Conferma sospensione" }).click();
    await second.getByText("Operazione in corso…").waitFor();
    const reason = second.getByRole("textbox", { name: "Motivo" });
    expect(await reason.evaluate(e => (e as HTMLTextAreaElement).readOnly)).toBe(true);
    expect(await reason.isDisabled()).toBe(false);
    await reason.focus();
    await reason.press("End"); await reason.press("X");
    expect(await reason.inputValue()).toBe("Fixture motivo sintetico");
    expect(await reason.evaluate(e => e === document.activeElement)).toBe(true);
    await second.getByRole("button", { name: "Conferma sospensione" }).dispatchEvent("click");
    await page.getByRole("textbox", { name: "Altra sezione" }).fill("Bozza indipendente");
    expect(writes).toBe(1); release?.();
    await second.getByText("Sospeso", { exact: true }).waitFor();
    await second.getByText("Motivo: Fixture motivo sintetico", { exact: true }).waitFor();
    expect(await page.getByRole("textbox", { name: "Altra sezione" }).inputValue()).toBe("Bozza indipendente");
    expect(await page.getByRole("textbox", { name: "Altra sezione" }).evaluate(e => e === document.activeElement)).toBe(true);
    mode = "denied";
    await second.getByRole("button", { name: "Riattiva utente", exact: true }).click();
    await second.getByRole("textbox", { name: "Motivo" }).fill("Fixture riattivazione");
    await second.getByRole("button", { name: "Conferma riattivazione" }).click();
    await second.getByRole("alert").waitFor();
    expect(await second.getByText("Sospeso", { exact: true }).count()).toBe(1);
    mode = "uncertain";
    await second.getByRole("button", { name: "Conferma riattivazione" }).click();
    await second.getByText(/Non è stato possibile verificare/).waitFor();
    const attempted = writes;
    await second.getByRole("button", { name: "Conferma riattivazione" }).dispatchEvent("click");
    expect(writes).toBe(attempted);
    await second.getByRole("button", { name: "Ricarica lista" }).waitFor();
    mode = "normal";
    await second.getByRole("button", { name: "Ricarica lista" }).click();
    await second.getByRole("button", { name: "Riattiva utente", exact: true }).waitFor();
    mode = "empty"; await page.reload(); await page.getByText("Nessun utente disponibile.").waitFor();
    mode = "error"; await page.reload(); await page.getByRole("alert").waitFor();
    mode = "normal"; await page.getByRole("button", { name: "Riprova" }).click(); await second.waitFor();
  } finally { release?.(); await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
}, 600000);
