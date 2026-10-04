import { it, expect } from "vitest";
import { chromium } from "@playwright/test";
import { build } from "esbuild";
import { createServer } from "node:http";
it("label photo preview, explicit extraction, prefill without save, edit confirmation and manual fallback", async () => {
  let extractions = 0; let saves = 0; let invalid = false; let last: Record<string,unknown> = {};
  let provider = "openai"; const asserted: unknown[] = [];
  const bundle = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {BarcodeEntry} from './src/components/barcode-entry'; createRoot(document.getElementById('root')).render(<BarcodeEntry date="2026-10-01" onSaved={()=>{}}/>);`, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' } });
  const server = createServer(async (req,res) => {
    if (req.url === "/app.js") { res.setHeader("Content-Type","application/javascript"); res.end(bundle.outputFiles[0].text); return; }
    if (req.url?.startsWith("/api/")) {
      const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
      res.setHeader("Content-Type","application/json");
      if (req.url === "/api/v1/label-scan" && req.method === "GET") res.end(JSON.stringify({ enabled: true, ready: true, provider, cloud: true }));
      else if (req.url === "/api/v1/label-scan") { const body = JSON.parse(Buffer.concat(chunks).toString()); asserted.push(body.expectedProvider); if (body.expectedProvider !== provider) { res.statusCode = 409; res.end(JSON.stringify({ code: "AI_PROVIDER_CHANGED" })); return; } extractions++; if (invalid) { res.statusCode = 502; res.end(JSON.stringify({ error: "Compila manualmente." })); } else res.end(JSON.stringify({ label: { name: "AI Snack", brand: "Brand", per100g: { kcal: 400.4, fat: 12.345, carbs: 60.678, protein: 8.333 }, servingSize: 30 } })); }
      else if (req.method === "POST") { saves++; last = JSON.parse(Buffer.concat(chunks).toString()); res.statusCode = 201; res.end('{}'); }
      else res.end(JSON.stringify({ origin: "unknown", food: null })); return;
    }
    res.end('<html lang="it"><meta name="viewport" content="width=device-width"><div id="root"></div><script src="/app.js"></script></html>');
  });
  await new Promise<void>(resolve => server.listen(0,"127.0.0.1",resolve));
  const browser = await chromium.launch({ args:["--no-sandbox"] });
  try {
    const page = await browser.newPage({ viewport:{width:390,height:844} });
    await page.goto(`http://127.0.0.1:${(server.address() as {port:number}).port}`);
    await page.getByRole("button",{name:"Scansiona",exact:true}).click();
    await page.getByLabel("Codice a barre",{exact:true}).fill("8001234567890"); await page.getByRole("button",{name:"Cerca prodotto"}).click();
    const input = page.getByLabel("Foto etichetta");
    await input.waitFor(); expect(await input.getAttribute("capture")).toBe("environment");
    await input.setInputFiles({ name:"label.png", mimeType:"image/png", buffer:Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=","base64") });
    await page.getByRole("img",{name:"Anteprima etichetta"}).waitFor(); expect(extractions).toBe(0);
    await page.getByText(/La foto sarà inviata a OpenAI/).waitFor();
    await page.getByLabel("Nome prodotto").fill("Consenso mantenuto");
    await page.getByLabel("Grammi registrati").fill("25"); await page.locator('select[name="slot"]').selectOption("Dinner"); provider = "anthropic";
    await page.getByRole("button",{name:"Scansiona etichetta",exact:true}).click();
    await page.getByRole("alert").waitFor();
    expect(asserted).toEqual(["openai"]); expect(extractions).toBe(0); expect(saves).toBe(0);
    expect(await page.getByLabel("Nome prodotto").inputValue()).toBe("Consenso mantenuto");
    await page.getByText(/La foto sarà inviata a Anthropic/).waitFor();
    await page.getByRole("button",{name:"Scansiona etichetta",exact:true}).click();
    await page.waitForFunction(() => (document.querySelector('input[name="name"]') as HTMLInputElement)?.value === "AI Snack");
    expect(saves).toBe(0); expect(extractions).toBe(1);
    const confirmation = page.getByRole("checkbox", { name: "Ho verificato i valori proposti dall’AI" });
    const saveButton = page.getByRole("button", { name: "Registra nel diario" });
    expect(await saveButton.isDisabled()).toBe(true);
    expect(await confirmation.isChecked()).toBe(false);
    await page.getByLabel("Nome prodotto").press("Enter");
    await page.locator('form:has(input[name="name"])').evaluate(form => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(saves).toBe(0);
    await confirmation.check();
    expect(await saveButton.isEnabled()).toBe(true);
    await input.setInputFiles({ name: "label2.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgo=", "base64") });
    await page.getByRole("button", { name: "Scansiona etichetta", exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('input[type="file"]')?.hasAttribute('disabled') && !document.querySelector('img[alt="Anteprima etichetta"]'));
    expect(extractions).toBe(2);
    expect(await confirmation.isChecked()).toBe(false);
    expect(await saveButton.isDisabled()).toBe(true);
    await confirmation.check();
    expect(await page.getByLabel("Kcal per 100 g").inputValue()).toBe("400");
    expect(await page.getByLabel("Proteine per 100 g").inputValue()).toBe("8.33");
    expect(await page.getByLabel("Grassi per 100 g").inputValue()).toBe("12.35");
    expect(await page.getByLabel("Carboidrati per 100 g").inputValue()).toBe("60.68");
    expect(await page.getByLabel("Grammi registrati").inputValue()).toBe("25");
    expect(await page.locator('select[name="slot"]').inputValue()).toBe("Dinner");
    await page.getByLabel("Nome prodotto").fill("Snack confermato"); await page.getByLabel("Grammi registrati").fill("25");
    await page.getByRole("button",{name:"Registra nel diario"}).click(); await page.waitForFunction(() => !document.querySelector('dialog[open]'));
    expect(saves).toBe(1); expect(last).toMatchObject({name:"Snack confermato",grams:25,slot:"Dinner",kcalPer100g:400,proteinPer100g:8.33,fatPer100g:12.35,carbsPer100g:60.68});
    await page.getByRole("button",{name:"Scansiona",exact:true}).click(); await page.getByLabel("Codice a barre",{exact:true}).fill("8001234567899"); await page.getByRole("button",{name:"Cerca prodotto"}).click();
    await page.getByLabel("Nome prodotto").fill("Manuale mantenuto"); invalid = true;
    await page.getByLabel("Foto etichetta").setInputFiles({name:"label.png",mimeType:"image/png",buffer:Buffer.from("iVBORw0KGgo=","base64")});
    await page.getByRole("button",{name:"Scansiona etichetta",exact:true}).click(); await page.getByRole("alert").waitFor();
    expect(await page.getByLabel("Nome prodotto").inputValue()).toBe("Manuale mantenuto"); expect(saves).toBe(1);
    expect(await confirmation.count()).toBe(0);
    await page.getByLabel("Kcal per 100 g").fill("100");
    expect(await saveButton.isEnabled()).toBe(true);
    await saveButton.click(); await page.waitForFunction(() => !document.querySelector('dialog[open]'));
    expect(saves).toBe(2); expect(last).toMatchObject({ name: "Manuale mantenuto", kcalPer100g: 100 });
  } finally { await browser.close(); await new Promise<void>(resolve => server.close(()=>resolve())); }
},600000);
