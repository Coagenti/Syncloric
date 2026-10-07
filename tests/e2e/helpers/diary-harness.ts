import { chromium, type Page } from "@playwright/test";
import { build } from "esbuild";
import { createServer } from "node:http";
import { productionCss } from "./production-css";
import { readFile } from "node:fs/promises";

/** Real client bundle + real Chromium; all API traffic must be intercepted by the caller. */
export async function withDiaryBrowser(run: (page: Page) => Promise<void>, view = "diary") {
  const bundle = await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import{CalorieApp}from'./src/components/calorie-app';const view=['dashboard','diary','calendar'].find(view=>location.pathname==='/'+view)||'${view}';createRoot(document.getElementById('root')).render(<CalorieApp view={view}/>);`, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"', "process.env": '{}' } });
  let css = "";
  if (process.env.DIARY_VISUAL_CSS === "1") {
    css = await productionCss();
  }
  const server = createServer(async (req, res) => {
    const assets: Record<string, [string, string]> = { "/brand/syncloric-mark.png": ["public/brand/syncloric-mark.png", "image/png"], "/favicon.ico": ["public/favicon.ico", "image/x-icon"] };
    if (req.url && assets[req.url]) { const [file, type] = assets[req.url]; res.setHeader("Content-Type", type); res.end(await readFile(file)); return; }
    if (req.url?.startsWith("/api/")) { res.writeHead(500); res.end("Unmocked API"); return; }
    res.setHeader("Content-Type", req.url === "/app.js" ? "application/javascript" : "text/html");
    res.end(req.url === "/app.js" ? bundle.outputFiles[0].text : `<html lang="it"><meta name="viewport" content="width=device-width"><style>${css}</style><div id="root"></div><script src="/app.js"></script></html>`);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.clock.setFixedTime(new Date("2026-09-29T12:00:00"));
    // Caller installs routes before navigating.
    await page.route("**/api/v1/**", route => route.abort("failed"));
    await run(Object.assign(page, { diaryUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}` }));
  } finally { await browser?.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
}
export const diaryUrl = (page: Page) => (page as Page & { diaryUrl: string }).diaryUrl;
