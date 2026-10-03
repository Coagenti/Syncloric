import { it, expect } from "vitest";
import { chromium, type Page, type Route } from "@playwright/test";
import { build } from "esbuild";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

async function withScanner(test: (page: Page) => Promise<void>) {
  const bundle = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {BarcodeEntry} from './src/components/barcode-entry'; createRoot(document.getElementById('root')).render(<BarcodeEntry date="2026-10-01" onSaved={()=>{}}/>);`, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' } });
  const require = createRequire(path.resolve("package.json"));
  const postcss = createRequire(require.resolve("@tailwindcss/postcss"))("postcss");
  const tailwind = (await import("@tailwindcss/postcss")).default;
  const css = (await postcss([tailwind()]).process(await readFile("src/app/globals.css", "utf8"), { from: path.resolve("src/app/globals.css") })).css;
  const server = createServer((req, res) => {
    if (req.url === "/app.js") { res.setHeader("Content-Type", "application/javascript"); res.end(bundle.outputFiles[0].text); }
    else res.end(`<html lang="it"><meta name="viewport" content="width=device-width"><style>${css}</style><div id="root"></div><script src="/app.js"></script></html>`);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage();
    const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${(server.address() as { port: number }).port}`);
    await test(page);
    expect(errors).toEqual([]);
  } finally {
    try { await browser?.close(); } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  }
}
const focused = (page: Page, selector: string) => expect.poll(() => page.locator(selector).evaluate(el => el === document.activeElement)).toBe(true);
async function open(page: Page) {
  await page.getByRole("button", { name: "Scansiona", exact: true }).click();
  await page.getByLabel("Codice a barre", { exact: true }).fill("8001234567890");
}
async function close(page: Page) {
  await page.keyboard.press("Escape");
  await focused(page, ".primary-cta");
}
async function screenshot(page: Page, name: string) {
  if (!process.env.BARCODE_EVIDENCE_DIR) return;
  await mkdir(process.env.BARCODE_EVIDENCE_DIR, { recursive: true });
  await page.screenshot({ path: `${process.env.BARCODE_EVIDENCE_DIR}/${name}.png` });
}

it("restores meaningful focus after slow Enter lookup without stealing a deliberate focus move", async () => {
  await withScanner(async page => {
    let release!: () => Promise<void>;
    let lookupMode: "unknown" | "service" | "network" = "unknown";
    await page.route("**/api/v1/barcode?*", async route => {
      await new Promise<void>(resolve => { release = async () => {
        if (lookupMode === "network") await route.abort();
        else await route.fulfill(lookupMode === "service" ? { status: 503, body: "Unavailable" } : { json: { origin: "unknown", food: null } });
        resolve();
      }; });
    });
    for (const mode of ["unknown", "service", "network"] as const) {
    lookupMode = mode;
    for (const moved of [false, true]) {
      release = undefined as unknown as typeof release;
      await open(page);
      await page.getByLabel("Codice a barre", { exact: true }).press("Enter");
      await page.getByText("Operazione in corso…", { exact: true }).waitFor();
      await expect.poll(() => !!release).toBe(true);
      if (moved) await page.getByRole("button", { name: "Chiudi scanner" }).focus();
      await release();
      await page.getByLabel("Nome prodotto").waitFor();
      await focused(page, moved ? ".close-editor" : mode === "unknown" ? 'input[name="name"]' : '[role="alert"]');
      await close(page);
    }
    }
  });
}, 600000);

it("distinguishes failed lookup from absence, focuses visible feedback, and preserves manual fallback", async () => {
  await withScanner(async page => {
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      for (const mode of ["service", "network", "unknown"] as const) {
        await page.unrouteAll();
        await page.route("**/api/v1/barcode?*", async route => {
          if (mode === "network") await route.abort();
          else await route.fulfill(mode === "service" ? { status: 503, contentType: "text/html", body: "Unavailable" } : { json: { origin: "unknown", food: null } });
        });
        await open(page);
        await page.getByRole("button", { name: "Cerca prodotto" }).focus();
        await page.keyboard.press("Enter");
        await page.getByLabel("Nome prodotto").waitFor();
        if (mode === "unknown") {
          await page.getByText("Prodotto non trovato: registra come nuovo.", { exact: true }).waitFor();
          await focused(page, 'input[name="name"]');
        } else {
          const alert = page.getByRole("alert"); await alert.waitFor();
          expect(await page.getByText("Prodotto non trovato: registra come nuovo.", { exact: true }).count()).toBe(0);
          expect(await alert.textContent()).toContain(mode === "network" ? "Connessione" : "Ricerca non disponibile");
          await focused(page, '[role="alert"]');
          expect(await alert.evaluate(el => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; })).toBe(true);
          await screenshot(page, `lookup-${mode}-${width}`);
          await page.keyboard.press("Tab");
          expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe("BODY");
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await close(page);
      }
    }
  });
}, 600000);

it("keeps valid values on failed saves and restores visible feedback only when focus is still owned", async () => {
  await withScanner(async page => {
    let pending: Route | undefined;
    await page.route("**/api/v1/barcode?*", route => route.fulfill({ json: { origin: "unknown", food: null } }));
    await page.route("**/api/v1/barcode", route => { pending = route; });
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      for (const mode of ["service", "network", "validation", "success"] as const) {
        for (const moved of [false, true]) {
          pending = undefined;
          await open(page); await page.getByRole("button", { name: "Cerca prodotto" }).click();
          await page.getByLabel("Nome prodotto").fill("Snack fixture");
          await page.getByLabel("Kcal per 100 g").fill("400");
          await page.getByLabel("Grammi registrati").fill("25");
          const submit = page.getByRole("button", { name: "Registra nel diario" });
          await submit.scrollIntoViewIfNeeded(); await submit.focus(); await page.keyboard.press("Enter");
          await page.getByText("Operazione in corso…", { exact: true }).waitFor(); await expect.poll(() => !!pending).toBe(true);
          if (moved) await page.getByRole("button", { name: "Chiudi scanner" }).focus();
          if (mode === "network") await pending!.abort();
          else await pending!.fulfill(mode === "success" ? { status: 201, json: { id: "fixture" } } : { status: mode === "service" ? 503 : 400, contentType: "text/html", body: "fixture" });
          if (mode === "success") { await page.waitForFunction(() => !document.querySelector("dialog")?.open); await focused(page, ".primary-cta"); continue; }
          const alert = page.getByRole("alert"); await alert.waitFor();
          const text = await alert.textContent();
          expect(text).toContain(mode === "validation" ? "Controlla" : mode === "network" ? "Connessione" : "Servizio");
          if (mode !== "validation") expect(text).not.toContain("Controlla");
          await focused(page, moved ? ".close-editor" : '[role="alert"]');
          if (!moved) {
            expect(await alert.evaluate(el => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; })).toBe(true);
            await screenshot(page, `save-${mode}-${width}`);
            await page.keyboard.press("Tab"); expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe("BODY");
          }
          expect(await page.getByLabel("Nome prodotto").inputValue()).toBe("Snack fixture");
          expect(await page.getByLabel("Grammi registrati").inputValue()).toBe("25");
          // Retry the same values, including submit via Enter in a field.
          pending = undefined;
          await page.getByLabel("Grammi registrati").press("Enter");
          await expect.poll(() => !!pending).toBe(true);
          await pending!.fulfill({ status: 201, json: { id: "fixture" } });
          await page.waitForFunction(() => !document.querySelector("dialog")?.open);
          await focused(page, ".primary-cta");
        }
      }
      // Native required/range validation keeps focus on the first invalid field.
      await open(page); await page.getByRole("button", { name: "Cerca prodotto" }).click();
      await page.getByRole("button", { name: "Registra nel diario" }).click();
      await focused(page, 'input[name="name"]');
      await close(page);
    }
  });
}, 600000);
