import { beforeEach, afterAll, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb, resetTables, closeTestDb, type TestDb } from "./setup";
import type { Db } from "@/server/db";
import { diaryEntries, foods, households, householdMembers, mealShareLinks, recipes, users } from "@/server/db/schema";
import { buildHouseholdHandlers } from "@/server/services/households/http";
import { buildHouseholdMealHandlers, buildMealLinkHandlers, buildMealCopyHandlers, buildSharedMealReadHandlers } from "@/server/services/households/meals";
import { buildDiaryMutationHandlers } from "@/server/services/diary/mutate";
import { buildDiaryFeedHandlers } from "@/server/services/diary/feed";
import { buildExportHandlers } from "@/server/services/export/http";
const alice = "11111111-1111-4111-8111-111111111111", bob = "22222222-2222-4222-8222-222222222222", eve = "33333333-3333-4333-8333-333333333333";
const day = "2026-10-08";
let db: TestDb; let clock: Date;
const deps = { getDb: () => db as unknown as Db, getSession: async (headers: Headers) => headers.get("x-user") ? { user: { id: headers.get("x-user")! } } : null, now: () => clock };
const req = (path: string, user: string | null = alice, method = "GET", body?: unknown, extra: Record<string, string> = {}) => new Request(`http://localhost${path}`, { method, headers: { ...(user ? { "x-user": user } : {}), origin: "http://localhost", "content-type": "application/json", ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const household = () => buildHouseholdHandlers(deps);
const action = (data: unknown, user = alice) => household().POST(req("/api/v1/household", user, "POST", data));
async function family() { const created = await action({ action: "create", name: "Famiglia" }); expect(created.status).toBe(201); const data = await created.json(); expect((await action({ action: "join", code: data.code }, bob)).status).toBe(200); return data; }
async function seedMeal() {
  const [food] = await db.insert(foods).values({ name: "Mochi", kcalPer100g: 201, createdBy: alice, nutrientsPer100g: { vitaminC: 999 } }).returning();
  const [recipe] = await db.insert(recipes).values({ name: "Riso", servings: 2, kcalPerServing: 801, snapshot: { privateUpstream: "Never share this" } }).returning();
  const entries = await db.insert(diaryEntries).values([
    { userId: alice, date: day, slot: "Lunch", entryType: "food", foodId: food.id, quantityGrams: "125", kcal: 251, nutrients: { protein: 10.25, vitaminC: 30, fiber: 0 }, source: "barcode" },
    { userId: alice, date: day, slot: "Lunch", entryType: "recipe", recipeId: recipe.id, servings: "0.50", kcal: 801, nutrients: { protein: 20, vitaminD: 4 }, source: "norish_sync", norishItemId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
    { userId: alice, date: day, slot: "Dinner", entryType: "food", foodId: food.id, quantityGrams: "50", kcal: null, nutrients: {}, source: "manual" },
  ]).returning(); return { food, recipe, entries };
}
beforeEach(async () => { db = await makeTestDb(); await resetTables(db); clock = new Date("2026-10-08T10:00:00Z"); await db.insert(users).values([{ id: alice, username: "alice" }, { id: bob, username: "bob" }, { id: eve, username: "eve", role: "admin" }]); });
afterAll(closeTestDb);

it("uses ten-minute invitations, one household per user, owner-only regeneration and invalidation", async () => {
  const create = await action({ action: "create", name: "Casa" }); const data = await create.json(); expect(data.code).toMatch(/^\d{6}$/);
  expect(Date.parse(data.household.joinCodeExpiresAt) - clock.getTime()).toBe(600000);
  const stored = await db.select().from(households); expect(stored[0].joinCodeHash).not.toBe(data.code);
  expect(await (await household().GET(req("/api/v1/household"))).json()).not.toHaveProperty("code");
  expect((await action({ action: "create", name: "Another" })).status).toBe(409);
  expect((await action({ action: "join", code: data.code }, bob)).status).toBe(200);
  expect((await action({ action: "regenerate" }, bob)).status).toBe(403);
  expect((await action({ action: "remove", userId: bob }, eve)).status).toBe(404); // Instance admin has no household privileges.
  const regenerated = await (await action({ action: "regenerate" })).json();
  expect((await action({ action: "join", code: data.code }, eve)).status).toBe(400);
  clock = new Date(clock.getTime() + 600000);
  expect((await action({ action: "join", code: regenerated.code }, eve)).status).toBe(400);
  expect((await db.select().from(householdMembers))).toHaveLength(2);
});

it("persists invitation throttling, enforces CSRF and bans, and serializes concurrent creates", async () => {
  for (let i = 0; i < 5; i++) expect((await action({ action: "join", code: "000000" }, bob)).status).toBe(400);
  expect((await action({ action: "join", code: "000000" }, bob)).status).toBe(429);
  clock = new Date(clock.getTime() + 600000); expect((await action({ action: "join", code: "000000" }, bob)).status).toBe(400);
  expect((await household().POST(req("/api/v1/household", alice, "POST", { action: "create", name: "Casa" }, { origin: "https://evil.example" }))).status).toBe(403);
  expect((await household().POST(req("/api/v1/household", null, "POST", { action: "create", name: "Casa" }))).status).toBe(401);
  await db.update(users).set({ role: "admin" }).where(eq(users.id, alice));
  await db.update(users).set({ banned: true }).where(eq(users.id, eve)); expect((await action({ action: "create", name: "Casa" }, eve)).status).toBe(401);
  const responses = await Promise.all([action({ action: "create", name: "Casa A" }), action({ action: "create", name: "Casa B" })]);
  expect(responses.map(r => r.status).sort()).toEqual([201, 409]); expect(await db.select().from(households)).toHaveLength(1);
});

it("allows every member to read meals, revokes access on removal/leave and supports owner transfer", async () => {
  await family(); await seedMeal(); const reader = buildHouseholdMealHandlers(deps);
  const read = (viewer = bob, member = alice) => reader.GET(req(`/api/v1/household/meals?memberId=${member}&date=${day}`, viewer));
  const response = await read(); expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
  const payload = await response.json(); expect(payload.meals).toHaveLength(4); const text = JSON.stringify(payload); expect(text).not.toContain("Never share this"); expect(text).not.toContain("norishItemId"); expect(text).not.toContain("foodId");
  expect((await read(alice, bob)).status).toBe(200); expect((await read(eve)).status).toBe(404);
  expect((await action({ action: "leave" })).status).toBe(409);
  expect((await action({ action: "transfer", userId: bob })).status).toBe(200);
  expect((await action({ action: "regenerate" })).status).toBe(403);
  expect((await action({ action: "remove", userId: alice }, bob)).status).toBe(200);
  expect((await read(alice, bob)).status).toBe(404);
  expect((await action({ action: "leave" }, bob)).status).toBe(200); expect(await db.select().from(households)).toHaveLength(0);
});

it("copies individual or whole meals with independent editable snapshots, scaling Norish exactly once", async () => {
  await family(); const { entries, food, recipe } = await seedMeal(); const copier = buildMealCopyHandlers(deps);
  const payload = { via: "household", memberId: alice, date: day, slot: "Lunch", targetDate: "2026-10-09", targetSlot: "Snack" };
  expect((await copier.POST(req("/api/v1/meals/copy", eve, "POST", payload))).status).toBe(404);
  const created = await copier.POST(req("/api/v1/meals/copy", bob, "POST", payload)); expect(created.status).toBe(201); const data = await created.json(); expect(data.count).toBe(2);
  let copies = await db.select().from(diaryEntries).where(eq(diaryEntries.userId, bob));
  expect(copies.every(e => e.source === "manual" && e.copiedMeal && e.norishItemId === null && e.slot === "Snack")).toBe(true);
  const copiedFood = copies.find(e => e.entryType === "food")!, copiedRecipe = copies.find(e => e.entryType === "recipe")!;
  expect(copiedFood.foodId).toBeNull(); expect(copiedRecipe.recipeId).toBeNull();
  expect(copiedFood.copiedName).toBe("Mochi"); expect(copiedRecipe.copiedName).toBe("Riso");
  expect(await db.select().from(foods)).toHaveLength(1); expect(await db.select().from(recipes)).toHaveLength(1);
  expect(copiedFood.nutrients).toEqual({ protein: 10.25, vitaminC: 30, fiber: 0 });
  expect(copiedRecipe).toMatchObject({ kcal: 401, nutrients: { protein: 10, vitaminD: 2 } });
  await db.update(foods).set({ kcalPer100g: 900, name: "Changed", nutrientsPer100g: { protein: 999 } }).where(eq(foods.id, food.id));
  await db.update(recipes).set({ name: "Changed recipe", kcalPerServing: 900 }).where(eq(recipes.id, recipe.id));
  const mutation = buildDiaryMutationHandlers(deps);
  expect((await mutation.PATCH(req("/api/v1/diary/id", bob, "PATCH", { servings: 1 }), { params: Promise.resolve({ id: copiedRecipe.id }) })).status).toBe(200);
  expect((await mutation.PATCH(req("/api/v1/diary/id", bob, "PATCH", { quantityGrams: 250 }), { params: Promise.resolve({ id: copiedFood.id }) })).status).toBe(200);
  copies = await db.select().from(diaryEntries).where(eq(diaryEntries.userId, bob));
  expect(copies.find(e => e.id === copiedFood.id)).toMatchObject({ kcal: 502, nutrients: { protein: 20.5, vitaminC: 60, fiber: 0 } });
  expect(copies.find(e => e.id === copiedRecipe.id)).toMatchObject({ kcal: 802, nutrients: { protein: 20, vitaminD: 4 } });
  const feed = await (await buildDiaryFeedHandlers(deps).GET(req("/api/v1/diary?month=2026-10", bob))).json(); expect(feed.entries.map((e: { name: string }) => e.name).sort()).toEqual(["Mochi", "Riso"]);
  const exported = await (await buildExportHandlers(deps).GET(req("/api/v1/export?format=json", bob))).json(); expect(exported.entries.map((e: { name: string }) => e.name).sort()).toEqual(["Mochi", "Riso"]); expect(exported.foods).toEqual([]);
  const partial = await copier.POST(req("/api/v1/meals/copy", bob, "POST", { ...payload, entryIds: [entries[0].id] })); expect((await partial.json()).count).toBe(1);
  const invalid = await copier.POST(req("/api/v1/meals/copy", bob, "POST", { ...payload, entryIds: [entries[2].id] })); expect(invalid.status).toBe(409);
  expect((await mutation.DELETE(req("/api/v1/diary/id", bob, "DELETE"), { params: Promise.resolve({ id: copiedRecipe.id }) })).status).toBe(200);
  expect((await db.select().from(diaryEntries).where(eq(diaryEntries.userId, alice)))).toHaveLength(3);
  await action({ action: "leave" }, bob); expect((await copier.POST(req("/api/v1/meals/copy", bob, "POST", payload))).status).toBe(404);
  // Existing copies survive leaving the family.
  expect((await db.select().from(diaryEntries).where(eq(diaryEntries.userId, bob)))).toHaveLength(2);
});

it("shares only one immutable meal by high-entropy link for two hours and allows external account copies", async () => {
  const { entries } = await seedMeal(); const manager = buildMealLinkHandlers(deps), reader = buildSharedMealReadHandlers(deps), copier = buildMealCopyHandlers(deps);
  const create = () => manager.POST(req("/api/v1/meals/links", alice, "POST", { date: day, slot: "Lunch" }));
  const data = await (await create()).json(); const secret = data.path.split("#")[1]; expect(data.path).toMatch(/^\/shared-meal#syncloric_meal_/);
  expect(Date.parse(data.metadata.expiresAt) - clock.getTime()).toBe(7200000);
  const [stored] = await db.select().from(mealShareLinks); expect(stored.tokenHash).not.toBe(secret);
  expect(await (await manager.GET(req("/api/v1/meals/links"))).text()).not.toContain(secret);
  const read = (token = secret) => reader.POST(req("/api/v1/meals/shared/read", null, "POST", { token }));
  expect((await read()).status).toBe(200); const shared = await (await read()).json(); expect(shared.meal.entries).toHaveLength(2); expect(shared.meal.entries.find((e: { entryType: string }) => e.entryType === "recipe").kcal).toBe(401);
  await db.update(diaryEntries).set({ kcal: 123 }).where(eq(diaryEntries.id, entries[0].id)); expect((await (await read()).json()).meal.entries.find((e: { entryType: string }) => e.entryType === "food").kcal).toBe(251);
  const copied = await copier.POST(req("/api/v1/meals/copy", eve, "POST", { via: "link", token: secret, targetDate: day, targetSlot: "Dinner" })); expect(copied.status).toBe(201);
  expect((await copier.POST(req("/api/v1/meals/copy", null, "POST", { via: "link", token: secret, targetDate: day, targetSlot: "Dinner" }))).status).toBe(401);
  expect((await manager.DELETE(req(`/api/v1/meals/links?id=${data.metadata.id}`, bob, "DELETE"))).status).toBe(404);
  await db.update(users).set({ banned: true }).where(eq(users.id, alice)); expect((await read()).status).toBe(404); await db.update(users).set({ banned: false }).where(eq(users.id, alice));
  clock = new Date(clock.getTime() + 7200000); expect((await read()).status).toBe(404);
  clock = new Date("2026-10-08T10:00:00Z"); const newer = await (await create()).json(); expect((await read()).status).toBe(404); expect((await read(newer.path.split("#")[1])).status).toBe(200);
  expect((await manager.DELETE(req(`/api/v1/meals/links?id=${newer.metadata.id}`, alice, "DELETE"))).status).toBe(200); expect((await read(newer.path.split("#")[1])).status).toBe(404);
});

it("preserves unknown calories, blocks injected recipients and scopes all writes and reads", async () => {
  await family(); await seedMeal(); const copier = buildMealCopyHandlers(deps), reader = buildHouseholdMealHandlers(deps);
  const body = { via: "household", memberId: alice, date: day, slot: "Dinner", targetDate: day, targetSlot: "Breakfast" };
  expect((await copier.POST(req("/api/v1/meals/copy", bob, "POST", { ...body, userId: eve }))).status).toBe(400);
  expect((await copier.POST(req("/api/v1/meals/copy", bob, "POST", body, { origin: "https://evil.example" }))).status).toBe(403);
  const copied = await copier.POST(req("/api/v1/meals/copy", bob, "POST", body)); expect(copied.status).toBe(201);
  const [entry] = await db.select().from(diaryEntries).where(eq(diaryEntries.userId, bob)); expect(entry.kcal).toBeNull(); expect(entry.nutrients).toEqual({});
  const edited = await buildDiaryMutationHandlers(deps).PATCH(req("/api/v1/diary/id", bob, "PATCH", { quantityGrams: 100 }), { params: Promise.resolve({ id: entry.id }) }); expect((await edited.json()).entry.kcal).toBeNull();
  await db.update(users).set({ banned: true }).where(eq(users.id, alice)); expect((await reader.GET(req(`/api/v1/household/meals?memberId=${alice}&date=${day}`, bob))).status).toBe(404);
  await db.update(users).set({ banned: true }).where(eq(users.id, bob)); expect((await copier.POST(req("/api/v1/meals/copy", bob, "POST", body))).status).toBe(401);
});

it("rolls back an entire copy on overflow and rejects duplicate or excessive selections", async () => {
  await family(); const { entries } = await seedMeal();
  await db.update(diaryEntries).set({ createdAt: new Date("2026-10-08T09:00:00Z") }).where(eq(diaryEntries.id, entries[0].id));
  await db.update(diaryEntries).set({ kcal: 2147483647, servings: "2", createdAt: new Date("2026-10-08T09:01:00Z") }).where(eq(diaryEntries.id, entries[1].id));
  const copier = buildMealCopyHandlers(deps), body = { via: "household", memberId: alice, date: day, slot: "Lunch", targetDate: day, targetSlot: "Snack" };
  const foodsBefore = await db.select().from(foods), recipesBefore = await db.select().from(recipes);
  expect((await copier.POST(req("/api/v1/meals/copy", bob, "POST", body))).status).toBe(400);
  expect(await db.select().from(diaryEntries).where(eq(diaryEntries.userId, bob))).toEqual([]);
  expect(await db.select().from(foods)).toEqual(foodsBefore); expect(await db.select().from(recipes)).toEqual(recipesBefore);
  expect((await copier.POST(req("/api/v1/meals/copy", bob, "POST", { ...body, entryIds: [entries[0].id, entries[0].id] }))).status).toBe(400);
  const foreign = req("/api/v1/meals/copy", bob, "POST", body); foreign.headers.delete("origin");
  expect((await copier.POST(foreign)).status).toBe(403);
  const huge = req("/api/v1/meals/copy", bob, "POST", { ...body, padding: "x".repeat(17000) });
  expect((await copier.POST(huge)).status).toBe(413);
});
