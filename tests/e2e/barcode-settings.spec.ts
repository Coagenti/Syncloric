import { it, expect } from "vitest";
import { chromium, type Browser } from "@playwright/test";
import { build } from "esbuild";
import { createServer } from "node:http";

it("Barcode card preserves pending edits and voluntary focus, exposes dirty status, and requires reload after uncertain writes", async () => {
  const bundle = await build({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {SettingsBarcodeCard} from './src/components/settings/settings-barcode-card';createRoot(document.getElementById('root')).render(<><SettingsBarcodeCard/><label>Altra sezione<input aria-label="Altra sezione"/></label></>);`, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' } });
  let enabled = true; let release: (() => void) | undefined; let uncertain = false; let writes = 0;
  const server = createServer(async (req, res) => {
    if (req.url === "/app.js") { res.setHeader("Content-Type", "application/javascript"); res.end(bundle.outputFiles[0].text); return; }
    if (req.url === "/api/v1/settings/barcode") {
      if (req.method === "PUT") {
        writes++;
        const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
        const body = JSON.parse(Buffer.concat(chunks).toString()) as { enabled: boolean };
        if (uncertain) { enabled = body.enabled; res.destroy(); return; }
        await new Promise<void>(resolve => { release = resolve; }); enabled = body.enabled;
      }
      res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ enabled, ...(req.method === "PUT" ? { saved_ok: true } : {}) })); return;
    }
    res.end('<html lang="it"><meta name="viewport" content="width=device-width"><div id="root"></div><script src="/app.js"></script></html>');
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage({ viewport: { width: 320, height: 844 } });
    await page.goto(`http://127.0.0.1:${(server.address() as { port: number }).port}`);
    const toggle = page.getByRole("checkbox", { name: "Ricerca prodotti su Open Food Facts" });
    const save = page.getByRole("button", { name: "Salva Barcode", exact: true });
    await toggle.waitFor(); expect(await toggle.isChecked()).toBe(true);
    expect(await page.getByText("Se disattivata, la ricerca su Open Food Facts non viene eseguita.", { exact: true }).count()).toBe(1);
    expect(await toggle.evaluate(el => el.closest("label")!.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    await toggle.uncheck(); await page.getByText("Modifiche non salvate", { exact: true }).waitFor();
    await save.click(); await page.getByText("Salvataggio Barcode in corso…", { exact: true }).waitFor();
    await toggle.check(); await page.getByRole("textbox", { name: "Altra sezione" }).fill("conserva testo");
    expect(release).toBeTypeOf("function"); release!();
    await page.getByText("Impostazioni Barcode salvate.", { exact: true }).waitFor();
    expect(await toggle.isChecked()).toBe(true);
    expect(await page.getByText("Modifiche non salvate", { exact: true }).count()).toBe(1);
    expect(await page.getByRole("textbox", { name: "Altra sezione" }).evaluate(el => el === document.activeElement)).toBe(true);
    expect(await page.getByRole("textbox", { name: "Altra sezione" }).inputValue()).toBe("conserva testo");
    uncertain = true; await save.click();
    await page.getByRole("alert").waitFor();
    expect(await page.getByRole("alert").innerText()).toBe("Non è stato possibile verificare il salvataggio. Ricarica lo stato prima di riprovare.");
    expect(await toggle.isChecked()).toBe(true);
    expect(await save.evaluate(el => el === document.activeElement)).toBe(true);
    const writesBeforeRetry = writes; await save.click({ force: true }); expect(writes).toBe(writesBeforeRetry);
    await page.getByRole("button", { name: "Ricarica stato Barcode" }).click();
    await page.getByText("Stato Barcode ricaricato.", { exact: true }).waitFor();
    expect(await page.getByText("Modifiche non salvate", { exact: true }).count()).toBe(0);
    expect(await toggle.isChecked()).toBe(true);
  } finally {
    release?.();
    try { await browser?.close(); } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  }
}, 600000);
