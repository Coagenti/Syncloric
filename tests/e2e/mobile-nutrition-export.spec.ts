import { it, expect } from "vitest";
import { chromium, expect as pw } from "@playwright/test";
import { build } from "esbuild";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { makeTestDb, closeTestDb } from "../integration/setup";
import type { Db } from "@/server/db";
import { users } from "@/server/db/schema";
import { buildDiaryCreateHandlers } from "@/server/services/diary/create";
import { buildDiaryMutationHandlers } from "@/server/services/diary/mutate";
import { buildDiaryFeedHandlers } from "@/server/services/diary/feed";
import { buildDiaryCatalogHandlers } from "@/server/services/diary/catalog";
import { buildExportHandlers, buildExportTokenHandlers } from "@/server/services/export/http";
import { productionCss } from "./helpers/production-css";

it("production mobile flows: nutrients, downloads, token lifecycle, PWA privacy and genuine ZXing fallback", async () => {
  const db = await makeTestDb(); const userId = "11111111-1111-4111-8111-111111111111";
  await db.insert(users).values({ id: userId, username: "mobile" });
  const deps = { getDb: () => db as unknown as Db, getSession: async () => ({ user: { id: userId } }) };
  const feed = buildDiaryFeedHandlers(deps), create = buildDiaryCreateHandlers(deps), mutation = buildDiaryMutationHandlers(deps), catalog = buildDiaryCatalogHandlers(deps), tokens = buildExportTokenHandlers(deps), exporter = buildExportHandlers(deps);
  const bundle = await build({ stdin: { contents: `import React from'react';import{createRoot}from'react-dom/client';import{CalorieApp}from'./src/components/calorie-app';import{SettingsContent}from'./src/components/settings/settings-content';import{createBarcodeReader}from'./src/lib/barcode-reader';window.decodeTestCanvas=async data=>{const canvas=document.createElement('canvas');canvas.width=data.width;canvas.height=data.height;canvas.videoWidth=data.width;canvas.videoHeight=data.height;const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,data.width,data.height);ctx.fillStyle='black';data.black.forEach(([x,y])=>ctx.fillRect(x,y,1,1));return(await(await createBarcodeReader()).detect(canvas))[0]?.rawValue};createRoot(document.getElementById('root')).render(location.pathname==='/settings'?<SettingsContent access='requires-admin'/>:<CalorieApp view='diary'/>);`, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"', "process.env": '{}' } });
  const css = process.env.DIARY_VISUAL_CSS === "1" ? await productionCss() : "";
  const errors: string[] = [];
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url!, `http://${req.headers.host}`); const path = url.pathname;
      if (path === "/app.js") { res.setHeader("Content-Type", "application/javascript"); res.end(bundle.outputFiles[0].text); return; }
      const files: Record<string, [string, string]> = { "/sw.js": ["public/sw.js", "application/javascript"], "/offline.html": ["public/offline.html", "text/html"], "/manifest.webmanifest": ["public/manifest.webmanifest", "application/manifest+json"], "/brand/syncloric-mark.png": ["public/brand/syncloric-mark.png", "image/png"], "/brand/icon-192.png": ["public/brand/icon-192.png", "image/png"], "/brand/icon-512.png": ["public/brand/icon-512.png", "image/png"], "/brand/icon-maskable-512.png": ["public/brand/icon-maskable-512.png", "image/png"] };
      if (files[path]) { res.setHeader("Content-Type", files[path][1]); res.end(await readFile(files[path][0])); return; }
      if (path.startsWith("/api/")) {
        const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
        const request = new Request(url, { method: req.method, headers: req.headers as Record<string, string>, ...(req.method === "GET" ? {} : { body: Buffer.concat(chunks).toString() }) });
        let response: Response;
        if (path === "/api/v1/diary") response = req.method === "POST" ? await create.POST(request) : await feed.GET(request);
        else if (path === "/api/v1/diary/catalog") response = await catalog.GET(request);
        else if (path.startsWith("/api/v1/diary/")) response = await mutation.PATCH(request, { params: Promise.resolve({ id: path.split("/").at(-1)! }) });
        else if (path === "/api/v1/settings/export-tokens") response = await tokens[req.method as "GET" | "POST" | "DELETE"](request);
        else if (path === "/api/v1/export") response = await exporter.GET(request);
        else response = Response.json({ configured: false, stored: false, urlConfigured: false, ready: false, provider: null });
        res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(await response.text()); return;
      }
      res.end(`<html lang="it"><meta name="viewport" content="width=device-width"><link rel="manifest" href="/manifest.webmanifest"><style>${css}</style><div id="root"></div><script src="/app.js"></script></html>`);
    } catch (error) { errors.push(String(error)); res.writeHead(500); res.end("Test host error"); }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve)); const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } }); await page.clock.setFixedTime(new Date("2026-10-07T12:00:00"));
    await page.goto(`${base}/diary`);
    await page.getByRole("button", { name: "Aggiungi alimento a Colazione" }).click();
    const dialog = page.getByRole("dialog", { name: "Aggiungi voce" });
    await dialog.getByLabel("Nome alimento").fill("Latte"); await dialog.getByLabel("Quantità in grammi").fill("200"); await dialog.getByLabel("Kcal totali", { exact: true }).fill("100");
    await dialog.getByLabel("Proteine totali").fill("6"); await dialog.getByText("Fibre, zuccheri, vitamine e minerali", { exact: true }).click();
    await dialog.getByLabel("Vitamina D (µg) totali", { exact: true }).fill("2.5");
    await dialog.getByRole("button", { name: "Salva voce", exact: true }).click(); await pw(dialog).not.toBeVisible();
    await pw(page.locator(".macro-protein")).toContainText("6"); await page.locator(".nutrition-summary summary").click(); await pw(page.locator(".nutrition-summary")).toContainText("2,5 µg");
    await page.getByRole("button", { name: "Modifica", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "Modifica voce" });
    await editor.getByLabel("Quantità in grammi").fill(""); await editor.getByLabel("Quantità in grammi").fill("300");
    await pw(editor.getByLabel("Proteine totali")).toHaveValue("9");
    await editor.getByLabel("Kcal totali", { exact: true }).fill("150"); await editor.getByRole("button", { name: "Salva voce", exact: true }).click();
    await pw(editor).not.toBeVisible(); await pw(page.locator(".macro-protein")).toContainText("9");
    if (css) {
      await page.locator(".nutrition-summary summary").click();
      for (const width of [320, 390, 1440]) {
        await page.setViewportSize({ width, height: 950 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        if (process.env.MOBILE_VISUAL_DIR) { await mkdir(process.env.MOBILE_VISUAL_DIR, { recursive: true }); await page.screenshot({ path: `${process.env.MOBILE_VISUAL_DIR}/diary-${width}.png`, fullPage: true }); }
      }
      await page.setViewportSize({ width: 390, height: 844 });
    }
    // Fixed EAN-13 fixture (4006381333931): independently encoded L/G/R modules.
    const bits = ["101", "0001101", "0100111", "0101111", "0111101", "0001001", "0110011", "01010", "1000010", "1000010", "1000010", "1110100", "1000010", "1100110", "101"].join("");
    const black: [number, number][] = [];
    for (let y = 20; y < 140; y++) for (let bit = 0; bit < bits.length; bit++) if (bits[bit] === "1") for (let dx = 0; dx < 4; dx++) black.push([50 + bit * 4 + dx, y]);
    expect(await page.evaluate(data => (window as unknown as { decodeTestCanvas: (d: unknown) => Promise<string> }).decodeTestCanvas(data), { width: 480, height: 160, black })).toBe("4006381333931");
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    expect((await (await page.context().newCDPSession(page)).send("Page.getInstallabilityErrors")).installabilityErrors).toEqual([]);
    await page.goto(`${base}/settings`);
    await page.getByRole("tab", { name: "I miei dati", exact: true }).click();
    const exportCard = page.locator('[aria-labelledby="export-settings-title"]');
    await exportCard.getByLabel("Nome token", { exact: true }).fill("My script"); await exportCard.getByRole("button", { name: "Genera token export" }).click();
    const generated = exportCard.getByLabel("Token appena creato", { exact: true }); await pw(generated).toBeVisible(); const secret = await generated.inputValue();
    const request = await page.request.get(`${base}/api/v1/export?format=json`, { headers: { authorization: `Bearer ${secret}` } }); expect((await request.json()).entries[0].nutrients.vitaminD).toBe(3.75);
    const downloaded = page.waitForEvent("download"); await exportCard.getByRole("link", { name: "Esporta JSON" }).click(); const download = await downloaded; expect(download.suggestedFilename()).toBe("syncloric-export.json"); const data = JSON.parse(await readFile((await download.path())!, "utf8")); expect(data.entries).toHaveLength(1); expect(JSON.stringify(data).includes(secret)).toBe(false);
    await page.reload(); await pw(generated).toHaveCount(0); await exportCard.getByRole("button", { name: "Revoca token My script" }).click(); await exportCard.getByRole("button", { name: "Conferma revoca" }).click(); await pw(exportCard.getByText("Token revocato.", { exact: true })).toBeVisible();
    expect((await page.request.get(`${base}/api/v1/export`, { headers: { authorization: `Bearer ${secret}` } })).status()).toBe(401);
    const cached = await page.evaluate(async () => (await Promise.all((await caches.keys()).map(async key => (await caches.open(key)).keys()))).flat().map(request => new URL(request.url).pathname)); expect(cached).toEqual(["/offline.html"]);
    await page.context().setOffline(true); await page.goto(`${base}/diary`); await pw(page.getByRole("heading", { name: "Connessione assente" })).toBeVisible(); await page.context().setOffline(false);
    expect(errors).toEqual([]);
  } finally { await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())); await closeTestDb(); }
}, 90_000);
