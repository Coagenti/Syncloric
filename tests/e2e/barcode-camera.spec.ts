import { it, expect } from "vitest";
import { chromium } from "@playwright/test";
import { build } from "esbuild";
import { createServer } from "node:http";

it("stops a pending camera detection before starting the diary POST", async () => {
  const bundle = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {BarcodeEntry} from './src/components/barcode-entry'; createRoot(document.getElementById('root')).render(<BarcodeEntry date="2026-10-01" onSaved={()=>{}}/>);`, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' } });
  const server = createServer((req, res) => {
    if (req.url === "/app.js") { res.setHeader("Content-Type", "application/javascript"); res.end(bundle.outputFiles[0].text); }
    else res.end('<div id="root"></div><script src="/app.js"></script>');
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.addInitScript(() => {
      const state = window as unknown as { track: MediaStreamTrack; postStarted: boolean; releasePost: () => void; releaseDetection: () => void };
      HTMLMediaElement.prototype.play = async () => {};
      Object.defineProperty(window, "BarcodeDetector", { value: class { detect() { return new Promise(resolve => { state.releaseDetection = () => resolve([{ rawValue: "8001234567890" }]); }); } } });
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", { value: async () => {
        const canvas = document.createElement("canvas"); canvas.width = 100; canvas.height = 100;
        const media = canvas.captureStream(10); state.track = media.getVideoTracks()[0]; return media;
      } });
      window.fetch = async (_url, init) => {
        if (init?.method === "POST") {
          state.postStarted = true;
          return new Promise<Response>(resolve => { state.releasePost = () => resolve(Response.json({ id: "fixture" }, { status: 201 })); });
        }
        return state.postStarted ? Response.json({ origin: "local", food: { name: "Snack OFF", brand: null, kcalPer100g: 400, proteinPer100g: null, fatPer100g: null, carbsPer100g: null, source: "barcode_off" } }) : Response.json({ origin: "unknown", food: null });
      };
    });
    await page.goto(`http://127.0.0.1:${(server.address() as {port:number}).port}`);
    await page.getByRole("button", { name: "Scansiona", exact: true }).click();
    await page.getByLabel("Codice a barre", { exact: true }).fill("8001234567890");
    await page.getByRole("button", { name: "Cerca prodotto" }).click();
    await page.getByLabel("Nome prodotto").fill("Snack"); await page.getByLabel("Kcal per 100 g").fill("400");
    await page.getByRole("button", { name: "Usa fotocamera" }).click();
    await page.waitForFunction(() => !!(window as unknown as {releaseDetection?:unknown}).releaseDetection);
    await page.getByRole("button", { name: "Registra nel diario" }).click();
    await page.waitForFunction(() => (window as unknown as {postStarted:boolean}).postStarted);
    expect(await page.evaluate(() => (window as unknown as {track:MediaStreamTrack}).track.readyState)).toBe("ended");
    await page.evaluate(() => { const state = window as unknown as {releaseDetection:()=>void;releasePost:()=>void}; state.releaseDetection(); state.releasePost(); });
    await page.waitForFunction(() => !document.querySelector("dialog")?.open);
    await page.getByRole("button", { name: "Scansiona", exact: true }).click();
    await page.getByLabel("Codice a barre", { exact: true }).fill("8001234567890");
    await page.getByRole("button", { name: "Cerca prodotto" }).click();
    await page.getByRole("link", { name: "Open Food Facts · ODbL / DbCL" }).waitFor();
    // Optional visual run uses actual CSS from the successful production build.
    if (process.env.BARCODE_CSS && process.env.BARCODE_EVIDENCE_DIR) {
      await page.addStyleTag({ path: process.env.BARCODE_CSS });
      for (const width of [320, 390, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        const box = await page.getByRole("dialog").boundingBox();
        expect(Math.abs((box?.x ?? 0) + (box?.width ?? 0) / 2 - width / 2)).toBeLessThan(2);
        await page.screenshot({ path: `${process.env.BARCODE_EVIDENCE_DIR}/barcode-${width}.png` });
        if (width === 390) {
          await page.getByRole("button", { name: "Registra nel diario" }).scrollIntoViewIfNeeded();
          await page.screenshot({ path: `${process.env.BARCODE_EVIDENCE_DIR}/barcode-390-bottom.png` });
          await page.getByRole("dialog").evaluate(element => { element.scrollTop = 0; });
        }
      }
    }
  } finally { await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
}, 600000);
