import { it, expect } from "vitest";
import { chromium, expect as pw } from "@playwright/test";
import { build } from "esbuild";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { makeTestDb, closeTestDb } from "../integration/setup";
import type { Db } from "@/server/db";
import { diaryEntries, foods, recipes, users } from "@/server/db/schema";
import { buildHouseholdHandlers } from "@/server/services/households/http";
import { buildHouseholdMealHandlers, buildMealLinkHandlers, buildMealCopyHandlers, buildSharedMealReadHandlers } from "@/server/services/households/meals";
import { buildDiaryFeedHandlers } from "@/server/services/diary/feed";
import { buildDiaryMutationHandlers } from "@/server/services/diary/mutate";
import { buildDiaryCatalogHandlers } from "@/server/services/diary/catalog";
import { productionCss } from "./helpers/production-css";

it("household UI joins two accounts, copies selected editable entries, shares publicly and revokes links", async () => {
  const db = await makeTestDb(); const alice = "11111111-1111-4111-8111-111111111111", bob = "22222222-2222-4222-8222-222222222222", eve = "33333333-3333-4333-8333-333333333333";
  await db.insert(users).values([{ id: alice, username: "alice" }, { id: bob, username: "bob" }, { id: eve, username: "eve" }]);
  const [food] = await db.insert(foods).values({ name: "Mochi", kcalPer100g: 200, createdBy: alice }).returning();
  const [recipe] = await db.insert(recipes).values({ name: "Riso e verdure", servings: 1, kcalPerServing: 400, snapshot: { upstreamSecret: "excluded" } }).returning();
  await db.insert(diaryEntries).values([{ userId: alice, date: "2026-10-08", slot: "Lunch", entryType: "food", foodId: food.id, quantityGrams: "100", kcal: 200, nutrients: { protein: 5, vitaminC: 20 } }, { userId: alice, date: "2026-10-08", slot: "Lunch", entryType: "recipe", recipeId: recipe.id, servings: "1", kcal: 400, nutrients: { protein: 10 }, source: "norish_sync" }]);
  const deps = { getDb: () => db as unknown as Db, now: () => new Date("2026-10-08T12:00:00"), getSession: async (headers: Headers) => { const id = /test-user=([a-f0-9-]+)/.exec(headers.get("cookie") ?? "")?.[1]; return id ? { user: { id } } : null; } };
  const family = buildHouseholdHandlers(deps), meals = buildHouseholdMealHandlers(deps), links = buildMealLinkHandlers(deps), copy = buildMealCopyHandlers(deps), shared = buildSharedMealReadHandlers(deps), feed = buildDiaryFeedHandlers(deps), mutate = buildDiaryMutationHandlers(deps), catalog = buildDiaryCatalogHandlers(deps);
  const bundle = await build({ stdin: { contents: `import React from'react';import{createRoot}from'react-dom/client';import{CalorieApp}from'./src/components/calorie-app';import{SettingsContent}from'./src/components/settings/settings-content';import{SharedMealPage}from'./src/components/meal-sharing/shared-meal-page';createRoot(document.getElementById('root')).render(location.pathname==='/settings'?<SettingsContent access='requires-admin'/>:location.pathname==='/shared-meal'?<SharedMealPage/>:<CalorieApp view='diary'/>);`, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"', "process.env": '{}' } });
  const css = process.env.DIARY_VISUAL_CSS === "1" ? await productionCss() : ""; const errors: string[] = [];
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url!, `http://${req.headers.host}`), path = url.pathname;
      if (path === "/app.js") { res.setHeader("Content-Type", "application/javascript"); res.end(bundle.outputFiles[0].text); return; }
      if (path === "/brand/syncloric-mark.png") { res.setHeader("Content-Type", "image/png"); res.end(await readFile("public/brand/syncloric-mark.png")); return; }
      if (path.startsWith("/api/")) {
        const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
        const request = new Request(url, { method: req.method, headers: req.headers as Record<string, string>, ...(req.method === "GET" ? {} : { body: Buffer.concat(chunks).toString() }) });
        let response: Response;
        if (path === "/api/v1/household") response = await family[req.method as "GET" | "POST"](request);
        else if (path === "/api/v1/household/meals") response = await meals.GET(request);
        else if (path === "/api/v1/meals/links") response = await links[req.method as "GET" | "POST" | "DELETE"](request);
        else if (path === "/api/v1/meals/shared/read") response = await shared.POST(request);
        else if (path === "/api/v1/meals/copy") response = await copy.POST(request);
        else if (path === "/api/v1/diary") response = await feed.GET(request);
        else if (path === "/api/v1/diary/catalog") response = await catalog.GET(request);
        else if (path.startsWith("/api/v1/diary/")) response = await mutate[req.method as "PATCH" | "DELETE"](request, { params: Promise.resolve({ id: path.split("/").at(-1)! }) });
        else response = Response.json({ configured: false, tokens: [], ready: false });
        res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(await response.text()); return;
      }
      res.setHeader("Content-Type", "text/html"); res.end(`<html lang="it"><meta name="viewport" content="width=device-width"><meta name="referrer" content="no-referrer"><style>${css}</style><div id="root"></div><script src="/app.js"></script></html>`);
    } catch (error) { errors.push(String(error)); res.writeHead(500); res.end("Test host error"); }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve)); const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  try {
    const contexts = await Promise.all([alice, bob, eve].map(async id => { const context = await browser.newContext({ viewport: { width: 390, height: 844 } }); await context.addCookies([{ name: "test-user", value: id, url: base }]); return context; }));
    const [a, b, e] = await Promise.all(contexts.map(c => c.newPage())); for (const page of [a, b, e]) await page.clock.setFixedTime(new Date("2026-10-08T12:00:00"));
    await a.goto(`${base}/settings`); const card = a.getByRole("region", { name: "Nucleo familiare" });
    await a.getByRole("tab", { name: "Nucleo", exact: true }).click();
    await card.getByLabel("Nome del nucleo", { exact: true }).fill("Casa neon"); await card.getByRole("button", { name: "Crea nucleo", exact: true }).click();
    await pw(card.getByLabel("Codice da condividere")).toBeVisible(); const code = await card.getByLabel("Codice da condividere").inputValue();
    await b.goto(`${base}/settings`); const bobCard = b.getByRole("region", { name: "Nucleo familiare" });
    await b.getByRole("tab", { name: "Nucleo", exact: true }).click();
    await bobCard.getByLabel("Codice di invito").fill(code); await bobCard.getByRole("button", { name: "Unisciti al nucleo" }).click(); await pw(bobCard.getByText("Casa neon", { exact: true })).toBeVisible();
    await b.goto(`${base}/diary`); const familyButton = b.getByRole("button", { name: "Pasti del nucleo", exact: true }); await familyButton.click();
    const familyDialog = b.getByRole("dialog", { name: "Pasti del nucleo" }); await pw(familyDialog.getByText("Mochi", { exact: true })).toBeVisible();
    await familyDialog.getByRole("checkbox", { name: /Riso e verdure/ }).uncheck(); await familyDialog.getByLabel("Pasto di destinazione").selectOption("Snack"); await familyDialog.getByRole("button", { name: "Copia 1 voce nel mio diario" }).click();
    await pw(familyDialog).not.toBeVisible(); const snack = b.getByRole("region", { name: "Spuntino", exact: true }); await pw(snack.getByText("Mochi", { exact: true })).toBeVisible();
    await snack.getByRole("button", { name: "Modifica", exact: true }).click(); const editor = b.getByRole("dialog", { name: "Modifica voce" }); await editor.getByLabel("Quantità in grammi").fill("200"); await editor.getByLabel("Kcal totali", { exact: true }).fill("400"); await editor.getByRole("button", { name: "Salva voce" }).click(); await pw(editor).not.toBeVisible(); await pw(snack.getByText("400", { exact: true })).toBeVisible();
    await a.goto(`${base}/diary`); const shareButton = a.getByRole("button", { name: "Condividi Pranzo tramite link" }); await shareButton.click();
    const shareDialog = a.getByRole("dialog", { name: "Condividi Pranzo", exact: true }); await shareDialog.getByRole("button", { name: "Genera link · 2 ore" }).click(); await pw(shareDialog.getByLabel("URL del pasto")).toBeVisible();
    const url = await shareDialog.getByLabel("URL del pasto").inputValue();
    const guest = await browser.newPage({ viewport: { width: 320, height: 800 } }); await guest.clock.setFixedTime(new Date("2026-10-08T12:00:00")); await guest.goto(url);
    await pw(guest.getByText("Mochi", { exact: true })).toBeVisible(); await guest.getByRole("button", { name: "Copia 2 voci nel mio diario" }).click(); await pw(guest.getByRole("alert")).toContainText("Accedi per continuare.");
    await e.goto(url); await e.getByRole("button", { name: "Copia 2 voci nel mio diario" }).click(); await pw(e.getByText("Pasto copiato.", { exact: false })).toBeVisible();
    await e.goto(`${base}/diary`);
    const copiedRecipe = e.getByRole("region", { name: "Pranzo", exact: true }).locator(".entry-row").filter({ hasText: "Riso e verdure" });
    await copiedRecipe.getByRole("button", { name: "Modifica", exact: true }).click();
    const recipeEditor = e.getByRole("dialog", { name: "Modifica voce" }); await recipeEditor.getByLabel("Numero di porzioni").fill("0.5");
    await pw(recipeEditor.getByText("Kcal totali: 200", { exact: true })).toBeVisible(); await recipeEditor.getByRole("button", { name: "Salva voce" }).click();
    await pw(recipeEditor).not.toBeVisible(); await pw(copiedRecipe.getByText("200", { exact: true })).toBeVisible();
    if (css) {
      await mkdir("test-results/households", { recursive: true });
      for (const [page, name] of [[a, "share"], [b, "diary"], [guest, "external-320"]] as const) { expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.screenshot({ path: `test-results/households/${name}.png`, fullPage: true }); }
    }
    await shareDialog.getByRole("button", { name: "Revoca link" }).click(); await pw(shareDialog.getByRole("button", { name: "Revoca link" })).not.toBeVisible(); await shareDialog.getByRole("button", { name: "Chiudi" }).click(); await pw(shareButton).toBeFocused();
    await guest.reload(); await pw(guest.getByRole("alert")).toContainText("Pasto non disponibile"); await pw(guest.getByText("Mochi", { exact: true })).not.toBeVisible();
    await snack.getByRole("button", { name: "Elimina", exact: true }).click(); await b.getByRole("button", { name: "Elimina voce", exact: true }).click(); await pw(snack.getByText("Mochi", { exact: true })).not.toBeVisible();
    expect(errors).toEqual([]);
  } finally { await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())); await closeTestDb(); }
}, 60000);
