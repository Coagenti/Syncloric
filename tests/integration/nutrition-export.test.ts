import { beforeEach, afterAll, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb, resetTables, closeTestDb, type TestDb } from "./setup";
import type { Db } from "@/server/db";
import { users, foods, diaryEntries, exportTokens } from "@/server/db/schema";
import { buildDiaryCreateHandlers } from "@/server/services/diary/create";
import { buildDiaryMutationHandlers } from "@/server/services/diary/mutate";
import { buildDiaryFeedHandlers } from "@/server/services/diary/feed";
import { buildBarcodeHandlers } from "@/server/services/foods/http";
import { buildExportHandlers, buildExportTokenHandlers } from "@/server/services/export/http";
import { upsertDiaryEntry } from "@/server/services/norish/sync";
const alice = "11111111-1111-4111-8111-111111111111", bob = "22222222-2222-4222-8222-222222222222";
let db: TestDb; let clock: Date;
const deps = { getDb: () => db as unknown as Db, getSession: async (headers: Headers) => headers.get("x-user") ? { user: { id: headers.get("x-user")! } } : null, now: () => clock };
const req = (path: string, user: string | null = alice, method = "GET", body?: unknown, extra: Record<string, string> = {}) => new Request(`http://localhost${path}`, { method, headers: { ...(user ? { "x-user": user } : {}), origin: "http://localhost", "content-type": "application/json", ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
beforeEach(async () => { db = await makeTestDb(); await resetTables(db); clock = new Date("2026-10-07T10:00:00Z"); await db.insert(users).values([{ id: alice, username: "alice" }, { id: bob, username: "bob" }]); });
afterAll(closeTestDb);

it("manual and barcode nutrients are snapshotted, preserve micronutrient units, and scale on quantity edits", async () => {
  const created = await buildDiaryCreateHandlers(deps).POST(req("/api/v1/diary", alice, "POST", { date: "2026-10-07", slot: "Lunch", entryType: "food", name: "Alimento", quantityGrams: 150, kcal: 300, nutrients: { protein: 20, fiber: 0, vitaminC: 25, vitaminD: 3 } }));
  expect(created.status).toBe(201); const { entry } = await created.json();
  expect(entry.nutrients).toEqual({ protein: 20, fiber: 0, vitaminC: 25, vitaminD: 3 });
  await db.update(foods).set({ nutrientsPer100g: { protein: 1 } }).where(eq(foods.id, entry.foodId));
  const edited = await buildDiaryMutationHandlers(deps).PATCH(req(`/api/v1/diary/${entry.id}`, alice, "PATCH", { quantityGrams: 225 }), { params: Promise.resolve({ id: entry.id }) });
  expect(edited.status).toBe(200); expect((await edited.json()).entry.nutrients).toEqual({ protein: 30, fiber: 0, vitaminC: 37.5, vitaminD: 4.5 });
  const feed = await buildDiaryFeedHandlers(deps).GET(req("/api/v1/diary?month=2026-10"));
  expect((await feed.json()).entries[0]).toMatchObject({ protein: 30, fat: null, nutrients: { vitaminD: 4.5 } });
  const barcode = await buildBarcodeHandlers({ ...deps, lookup: async () => null }).POST(req("/api/v1/barcode", alice, "POST", { barcode: "4006381333931", name: "Latte", kcalPer100g: 50, proteinPer100g: 3, grams: 250, date: "2026-10-07", slot: "Breakfast", nutrientsPer100g: { protein: 3, calcium: 120, vitaminD: 2.5 } }));
  expect(barcode.status).toBe(201);
  const rows = await db.select().from(diaryEntries).where(eq(diaryEntries.id, (await barcode.json()).id));
  expect(rows[0].nutrients).toEqual({ protein: 7.5, calcium: 300, vitaminD: 6.25 });
  const invalid = await buildDiaryCreateHandlers(deps).POST(req("/api/v1/diary", alice, "POST", { date: "2026-10-07", slot: "Lunch", entryType: "food", name: "Invalid", quantityGrams: 100, kcal: 300, nutrients: { protein: 200 } }));
  expect(invalid.status).toBe(400); expect((await db.select().from(foods)).some(f => f.name === "Invalid")).toBe(false);
});

it("Norish stores per-serving nutrients, multiplies local servings once, and remains idempotent", async () => {
  const item = { user_id: alice, norish_item_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", date: "2026-10-07", slot: "Lunch" as const, servings: 1, kcal: 400, nutrients: { protein: 27.4, fat: 6, carbs: 30 } };
  await upsertDiaryEntry(db, item);
  await db.update(diaryEntries).set({ servings: "0.5" });
  const [before] = await db.select().from(diaryEntries); await upsertDiaryEntry(db, item); const [after] = await db.select().from(diaryEntries);
  expect(after.updatedAt).toEqual(before.updatedAt); expect(after.servings).toBe("0.50");
  const feed = await buildDiaryFeedHandlers(deps).GET(req("/api/v1/diary?month=2026-10"));
  expect((await feed.json()).entries[0]).toMatchObject({ kcal: 200, protein: 13.7, nutrients: { protein: 13.7, fat: 3, carbs: 15 } });
});

it("exports only the authenticated user's rows; one-time hashed tokens expire, revoke and stop on ban", async () => {
  const create = buildDiaryCreateHandlers(deps);
  for (const [user, name] of [[alice, "Alice food"], [bob, "Bob private food"]]) expect((await create.POST(req("/api/v1/diary", user, "POST", { date: "2026-10-07", slot: "Lunch", entryType: "food", name, quantityGrams: 100, kcal: 200, nutrients: { protein: 10 } }))).status).toBe(201);
  const manager = buildExportTokenHandlers(deps), exporter = buildExportHandlers(deps);
  const response = await manager.POST(req("/api/v1/settings/export-tokens", alice, "POST", { label: "script", expiresInDays: 30 }));
  expect(response.status).toBe(201); const { token, metadata } = await response.json();
  const stored = await db.select().from(exportTokens); expect(stored[0].tokenHash === token).toBe(false);
  const listed = await manager.GET(req("/api/v1/settings/export-tokens")); expect((await listed.text()).includes(token)).toBe(false);
  expect((await manager.DELETE(req(`/api/v1/settings/export-tokens?id=${metadata.id}`, bob, "DELETE"))).status).toBe(404);
  const download = () => exporter.GET(req("/api/v1/export?format=json", null, "GET", undefined, { authorization: `Bearer ${token}` }));
  const exported = await download(); expect(exported.headers.get("cache-control")).toBe("private, no-store"); const text = await exported.text();
  expect(text.includes("Alice food")).toBe(true); expect(text.includes("Bob private food")).toBe(false); expect(text.includes(token)).toBe(false); expect(text.includes("tokenHash")).toBe(false);
  expect((await create.POST(req("/api/v1/diary", null, "POST", { date: "2026-10-07", slot: "Lunch", entryType: "food", name: "Denied", quantityGrams: 100, kcal: 1 }, { authorization: `Bearer ${token}` }))).status).toBe(401);
  expect((await exporter.GET(req(`/api/v1/export?userId=${bob}`))).status).toBe(400);
  await db.update(users).set({ banned: true }).where(eq(users.id, alice)); expect((await download()).status).toBe(401);
  await db.update(users).set({ banned: false }).where(eq(users.id, alice)); clock = new Date("2026-11-08T10:00:00Z"); expect((await download()).status).toBe(401);
  clock = new Date("2026-10-07T10:00:00Z"); expect((await manager.DELETE(req(`/api/v1/settings/export-tokens?id=${metadata.id}`, alice, "DELETE"))).status).toBe(200); expect((await download()).status).toBe(401);
});

it("streams more than one batch without losing rows, keeps CSV units and neutralizes spreadsheet formulas", async () => {
  const [food] = await db.insert(foods).values({ name: '=HYPERLINK("x")', kcalPer100g: 100, createdBy: alice }).returning();
  await db.insert(diaryEntries).values(Array.from({ length: 503 }, () => ({ userId: alice, date: "2026-10-07", slot: "Snack" as const, entryType: "food" as const, foodId: food.id, quantityGrams: "100", kcal: 100, nutrients: { protein: 0, vitaminC: 12 } })));
  const exporter = buildExportHandlers(deps);
  const data = await (await exporter.GET(req("/api/v1/export?format=json"))).json(); expect(data.entries).toHaveLength(503); expect(new Set(data.entries.map((e: { id: string }) => e.id)).size).toBe(503); expect(data.units.vitaminD).toBe("µg");
  const csv = await (await exporter.GET(req("/api/v1/export?format=csv"))).text(); expect(csv.includes("vitaminC_mg")).toBe(true); expect(csv.includes("vitaminD_ug")).toBe(true); expect(csv.includes("'\u003dHYPERLINK")).toBe(true);
  expect(csv.trim().split("\r\n")).toHaveLength(504);
  const empty = await (await exporter.GET(req("/api/v1/export?from=2026-10-08&to=2026-10-08"))).json(); expect(empty.entries).toEqual([]);
});
