import { randomBytes } from "node:crypto";
import { and, asc, eq, gt } from "drizzle-orm";
import { z } from "zod";
import { diaryEntries, foods, householdMembers, mealShareLinks, recipes, slotEnum, users } from "@/server/db/schema";
import { normalizeNutrition, nutritionColumns, scaleNutrition } from "@/lib/nutrition";
import type { SharedMeal } from "@/lib/meal-sharing";
import { portionColumns } from "@/lib/food-portions";
import { activeUser, checkOrigin, handle, hash, HttpError, input, json, lockHouseholds, sessionUserId, type Deps, type Tx } from "./common";
import { memberHousehold } from "./http";

const token = z.string().regex(/^syncloric_meal_[A-Za-z0-9_-]{43}$/);
const mealKey = z.object({ date: z.iso.date(), slot: z.enum(slotEnum.enumValues) }).strict();
const copyTarget = { targetDate: z.iso.date(), targetSlot: z.enum(slotEnum.enumValues), entryIds: z.array(z.uuid()).min(1).max(200).refine(ids => new Set(ids).size === ids.length).optional() };
const copySchema = z.discriminatedUnion("via", [
  mealKey.extend({ via: z.literal("household"), memberId: z.uuid(), ...copyTarget }).strict(),
  z.object({ via: z.literal("link"), token, ...copyTarget }).strict(),
]);
const notFound = () => new HttpError("Pasto non disponibile o link scaduto.", 404);
async function householdAccess(tx: Tx, userId: string, memberId: string) {
  const household = await memberHousehold(tx, userId); if (!household) throw notFound();
  const [member] = await tx.select({ id: users.id, username: users.username }).from(householdMembers).innerJoin(users, eq(householdMembers.userId, users.id))
    .where(and(eq(householdMembers.householdId, household.id), eq(householdMembers.userId, memberId), eq(users.banned, false)));
  if (!member) throw notFound();
  return member;
}
async function loadMeal(tx: Tx, userId: string, date: string, slot: typeof slotEnum.enumValues[number]): Promise<SharedMeal> {
  const rows = await tx.select({ entry: diaryEntries, foodName: foods.name, recipeName: recipes.name }).from(diaryEntries)
    .leftJoin(foods, eq(diaryEntries.foodId, foods.id)).leftJoin(recipes, eq(diaryEntries.recipeId, recipes.id))
    .where(and(eq(diaryEntries.userId, userId), eq(diaryEntries.date, date), eq(diaryEntries.slot, slot)))
    .orderBy(asc(diaryEntries.createdAt), asc(diaryEntries.id)).limit(201);
  if (rows.length > 200) throw new HttpError("Questo pasto supera il limite di 200 voci condivisibili.", 413);
  return { date, slot, entries: rows.map(({ entry, foodName, recipeName }) => {
    const factor = entry.entryType === "recipe" && entry.source === "norish_sync" ? Number(entry.servings ?? 1) : 1;
    return { id: entry.id, name: entry.copiedName ?? recipeName ?? foodName ?? "Voce senza nome", entryType: entry.entryType,
      quantityGrams: entry.quantityGrams === null ? null : Number(entry.quantityGrams), servings: entry.servings === null ? null : Number(entry.servings),
      kcal: entry.kcal === null ? null : Math.round(entry.kcal * factor),
      portion: entry.portionLabel && entry.portionGrams && entry.portionQuantity ? { label: entry.portionLabel, grams: Number(entry.portionGrams), quantity: Number(entry.portionQuantity) } : null,
      nutrients: scaleNutrition(normalizeNutrition(entry.nutrients, { protein: entry.protein, fat: entry.fat, carbs: entry.carbs }), factor) };
  }) };
}
async function linkMeal(tx: Tx, secret: string, now: Date) {
  const [link] = await tx.select({ meal: mealShareLinks.meal }).from(mealShareLinks).innerJoin(users, eq(mealShareLinks.userId, users.id))
    .where(and(eq(mealShareLinks.tokenHash, hash(secret)), gt(mealShareLinks.expiresAt, now), eq(users.banned, false)));
  if (!link) throw notFound(); return link.meal;
}
export function buildHouseholdMealHandlers(deps: Deps) {
  return { GET: (request: Request) => handle(async () => {
    const userId = await sessionUserId(deps, request);
    const query = Object.fromEntries(new URL(request.url).searchParams);
    const parsed = z.object({ date: z.iso.date(), memberId: z.uuid() }).strict().safeParse(query);
    if (!parsed.success) throw new HttpError("Indica membro e data del pasto.");
    return deps.getDb().transaction(async tx => {
      await lockHouseholds(tx); await activeUser(tx, userId);
      const member = await householdAccess(tx, userId, parsed.data.memberId);
      const meals = []; for (const slot of slotEnum.enumValues) meals.push(await loadMeal(tx, member.id, parsed.data.date, slot));
      return json({ member, meals });
    });
  }) };
}
export function buildMealLinkHandlers(deps: Deps) {
  const now = deps.now ?? (() => new Date());
  const shape = { id: mealShareLinks.id, date: mealShareLinks.date, slot: mealShareLinks.slot, createdAt: mealShareLinks.createdAt, expiresAt: mealShareLinks.expiresAt };
  return {
    GET: (request: Request) => handle(async () => {
      const userId = await sessionUserId(deps, request); await activeUser(deps.getDb(), userId);
      return json({ links: await deps.getDb().select(shape).from(mealShareLinks).where(and(eq(mealShareLinks.userId, userId), gt(mealShareLinks.expiresAt, now()))) });
    }),
    POST: (request: Request) => handle(async () => {
      const userId = await sessionUserId(deps, request); checkOrigin(request); const key = await input(request, mealKey);
      return deps.getDb().transaction(async tx => {
        await lockHouseholds(tx); await activeUser(tx, userId);
        const meal = await loadMeal(tx, userId, key.date, key.slot); if (!meal.entries.length) throw new HttpError("Questo pasto è vuoto.");
        const secret = `syncloric_meal_${randomBytes(32).toString("base64url")}`;
        const values = { userId, ...key, tokenHash: hash(secret), meal, createdAt: now(), expiresAt: new Date(now().getTime() + 7200000) };
        const [metadata] = await tx.insert(mealShareLinks).values(values).onConflictDoUpdate({ target: [mealShareLinks.userId, mealShareLinks.date, mealShareLinks.slot], set: values }).returning(shape);
        // Fragment is not sent with page requests or Referer; client submits the secret in JSON.
        return json({ path: `/shared-meal#${secret}`, metadata }, 201);
      });
    }),
    DELETE: (request: Request) => handle(async () => {
      const userId = await sessionUserId(deps, request); checkOrigin(request);
      const id = new URL(request.url).searchParams.get("id"); if (!z.uuid().safeParse(id).success) throw notFound();
      return deps.getDb().transaction(async tx => { await lockHouseholds(tx); await activeUser(tx, userId);
        const deleted = await tx.delete(mealShareLinks).where(and(eq(mealShareLinks.id, id!), eq(mealShareLinks.userId, userId))).returning({ id: mealShareLinks.id });
        if (!deleted.length) throw notFound(); return json({ ok: true });
      });
    }),
  };
}
export function buildSharedMealReadHandlers(deps: Deps) {
  return { POST: (request: Request) => handle(async () => {
    checkOrigin(request); const data = await input(request, z.object({ token }).strict());
    return deps.getDb().transaction(async tx => { await lockHouseholds(tx); return json({ meal: await linkMeal(tx, data.token, (deps.now ?? (() => new Date()))()) }); });
  }) };
}
export function buildMealCopyHandlers(deps: Deps) {
  return { POST: (request: Request) => handle(async () => {
    const userId = await sessionUserId(deps, request); checkOrigin(request); const data = await input(request, copySchema);
    return deps.getDb().transaction(async tx => {
      await lockHouseholds(tx); await activeUser(tx, userId);
      let meal: SharedMeal;
      if (data.via === "household") { await householdAccess(tx, userId, data.memberId); meal = await loadMeal(tx, data.memberId, data.date, data.slot); }
      else meal = await linkMeal(tx, data.token, (deps.now ?? (() => new Date()))());
      const selected = data.entryIds ? meal.entries.filter(e => data.entryIds!.includes(e.id)) : meal.entries;
      if (!selected.length || (data.entryIds && selected.length !== data.entryIds.length)) throw new HttpError("Le voci selezionate non sono più disponibili. Aggiorna il pasto.", 409);
      const ids: string[] = [];
      for (const entry of selected) {
        if (entry.kcal !== null && (entry.kcal < 0 || entry.kcal > 2147483647)) throw new HttpError("Kcal fuori dai limiti supportati.");
        // Keep private name and totals snapshots. No catalog duplication or inferred zero kcal.
        const [copy] = await tx.insert(diaryEntries).values({ userId, date: data.targetDate, slot: data.targetSlot, entryType: entry.entryType,
          foodId: null, recipeId: null, copiedName: entry.name, quantityGrams: entry.quantityGrams === null ? null : String(entry.quantityGrams), servings: entry.servings === null ? null : String(entry.servings),
          kcal: entry.kcal, ...portionColumns(entry.portion), ...nutritionColumns(entry.nutrients), source: "manual", copiedMeal: true, norishItemId: null, norishDeleted: false }).returning({ id: diaryEntries.id });
        ids.push(copy.id);
      }
      return json({ ids, count: ids.length, date: data.targetDate }, 201);
    });
  }) };
}
