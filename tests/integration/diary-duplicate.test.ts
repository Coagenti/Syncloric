import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "@/server/db";
import { diaryEntries, foods, recipes, users } from "@/server/db/schema";
import { buildDiaryDuplicateHandlers } from "@/server/services/diary/duplicate";
import { buildDiaryMutationHandlers } from "@/server/services/diary/mutate";
import { buildDiaryFeedHandlers } from "@/server/services/diary/feed";
import { makeTestDb, resetTables, closeTestDb, type TestDb } from "./setup";

const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222";
const target = { date: "2026-11-04", slot: "Snack" };
describe("owned diary entry duplication", () => {
  let db: TestDb;
  beforeAll(async () => { db = await makeTestDb(); });
  afterAll(closeTestDb);
  beforeEach(async () => { await resetTables(db); await db.insert(users).values([{ id: A, username: "a" }, { id: B, username: "b" }]); });
  const deps = (user: string | null = A) => ({ getDb: () => db as unknown as Db, getSession: async () => user ? { user: { id: user } } : null });
  const duplicate = (id: string, body: unknown = target, user: string | null = A, origin: string | null = "http://localhost") => buildDiaryDuplicateHandlers(deps(user)).POST(new Request(`http://localhost/api/v1/diary/${id}/duplicate`, { method: "POST", headers: { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });
  const feed = async () => (await buildDiaryFeedHandlers(deps()).GET(new Request("http://localhost/api/v1/diary?month=2026-11"))).json();
  const create = async (extra: Partial<typeof diaryEntries.$inferInsert> = {}) => (await db.insert(diaryEntries).values({ userId: A, date: "2026-11-03", slot: "Lunch", entryType: "food", copiedName: "Biscotti", copiedMeal: true, quantityGrams: "9", kcal: 42, nutrients: { protein: 0, vitaminC: 3 }, portionLabel: "Biscotto", portionGrams: "6", portionQuantity: "1.5", ...extra }).returning())[0];

  it("copies all totals, portions and name independently of the original and catalog", async () => {
    const [food] = await db.insert(foods).values({ name: "Biscotti", kcalPer100g: 400 }).returning();
    const original = await create({ foodId: food.id, copiedName: null, copiedMeal: false });
    const response = await duplicate(original.id); expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const { id } = await response.json(); expect(id).not.toBe(original.id);
    const [copy] = await db.select().from(diaryEntries).where(eq(diaryEntries.id, id));
    expect(copy).toMatchObject({ userId: A, ...target, source: "manual", copiedMeal: true, copiedName: "Biscotti", foodId: null, recipeId: null, norishItemId: null, norishDeleted: false, quantityGrams: "9.00", portionLabel: "Biscotto", portionGrams: "6.00", portionQuantity: "1.50", kcal: 42, nutrients: { protein: 0, vitaminC: 3 } });
    await db.update(foods).set({ name: "Nome nuovo", kcalPer100g: 999 }).where(eq(foods.id, food.id));
    await db.update(diaryEntries).set({ kcal: 99, nutrients: {} }).where(eq(diaryEntries.id, original.id));
    expect((await feed()).entries.find((e: { id: string }) => e.id === id)).toMatchObject({ name: "Biscotti", kcal: 42, nutrients: { protein: 0, vitaminC: 3 } });
    const patched = await buildDiaryMutationHandlers(deps()).PATCH(new Request(`http://localhost/api/v1/diary/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json", Origin: "http://localhost" }, body: JSON.stringify({ quantityGrams: 18 }) }), { params: Promise.resolve({ id }) });
    expect(patched.status).toBe(200); expect((await patched.json()).entry).toMatchObject({ kcal: 84, nutrients: { protein: 0, vitaminC: 6 } });
  });
  it("scales imported recipe totals once and makes the copy editable", async () => {
    const [recipe] = await db.insert(recipes).values({ name: "Ricetta Norish", servings: 4, kcalPerServing: 250, snapshot: {} }).returning();
    const original = await create({ entryType: "recipe", recipeId: recipe.id, copiedMeal: false, copiedName: null, source: "norish_sync", quantityGrams: null, servings: "2.5", kcal: 250, nutrients: { protein: 5, vitaminC: 3 }, portionLabel: null, portionGrams: null, portionQuantity: null });
    const response = await duplicate(original.id); expect(response.status).toBe(201); const { id } = await response.json();
    expect((await feed()).entries.find((e: { id: string }) => e.id === id)).toMatchObject({ entryType: "recipe", servings: 2.5, kcal: 625, nutrients: { protein: 12.5, vitaminC: 7.5 }, copiedMeal: true, source: "manual", name: "Ricetta Norish" });
    const patched = await buildDiaryMutationHandlers(deps()).PATCH(new Request(`http://localhost/api/v1/diary/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json", Origin: "http://localhost" }, body: JSON.stringify({ servings: 1.25 }) }), { params: Promise.resolve({ id }) });
    expect(patched.status).toBe(200); expect((await patched.json()).entry).toMatchObject({ kcal: 313, nutrients: { protein: 6.25, vitaminC: 3.75 } });
    const [stored] = await db.select().from(diaryEntries).where(eq(diaryEntries.id, original.id)); expect(stored).toMatchObject({ source: "norish_sync", kcal: 250, servings: "2.50" });
  });
  it("does not multiply an already-totalled manual recipe when copying it again", async () => {
    const original = await create({ entryType: "recipe", quantityGrams: null, servings: "2", kcal: 800, nutrients: { protein: 40 } });
    const first = await (await duplicate(original.id)).json(); const second = await (await duplicate(first.id)).json();
    expect((await feed()).entries.find((e: { id: string }) => e.id === second.id)).toMatchObject({ kcal: 800, nutrients: { protein: 40 }, servings: 2 });
  });
  it("preserves missing calories and nutrients, including known zeros", async () => {
    const original = await create({ kcal: null, nutrients: { protein: 0 }, protein: "0", fat: null, carbs: null });
    const { id } = await (await duplicate(original.id)).json();
    expect((await feed()).entries.find((e: { id: string }) => e.id === id)).toMatchObject({ kcal: null, protein: 0, carbs: null, fat: null, nutrients: { protein: 0 } });
  });
  it.each([null, B])("denies missing session or another user's entry (%s)", async user => {
    const original = await create(); expect((await duplicate(original.id, target, user)).status).toBe(user ? 404 : 401);
    expect(await db.select().from(diaryEntries)).toHaveLength(1);
  });
  it.each([null, "https://evil.example"])("requires a same-origin request (%s)", async origin => {
    const original = await create(); expect((await duplicate(original.id, target, A, origin)).status).toBe(403);
    expect(await db.select().from(diaryEntries)).toHaveLength(1);
  });
  it("denies banned users", async () => {
    const original = await create(); await db.update(users).set({ banned: true }).where(eq(users.id, A));
    expect((await duplicate(original.id)).status).toBe(401); expect(await db.select().from(diaryEntries)).toHaveLength(1);
  });
  it.each([{ ...target, date: "2026-02-30" }, { ...target, slot: "Brunch" }, { ...target, userId: B }, { ...target, kcal: 999 }])("rejects invalid or forged destinations: %j", async body => {
    const original = await create(); expect((await duplicate(original.id, body)).status).toBe(400);
    expect(await db.select().from(diaryEntries)).toHaveLength(1);
  });
  it("returns 404 for malformed or missing IDs", async () => {
    expect((await duplicate("invalid")).status).toBe(404);
    expect((await duplicate("aaaaaaaa-1111-4111-8111-111111111111")).status).toBe(404);
  });
});
