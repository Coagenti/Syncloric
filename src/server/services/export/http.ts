import { createHash, randomBytes } from "node:crypto";
import { and, asc, desc, eq, gt, gte, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/server/db";
import { diaryEntries, exportTokens, foods, profiles, recipes, users } from "@/server/db/schema";
import { isAllowedRequestOrigin } from "@/server/http/request-origin";
import { nutrientSpecs, normalizeNutrition, scaleNutrition } from "@/lib/nutrition";

type Deps = { getDb: () => Db; getSession: (headers: Headers) => Promise<{ user: { id: string } } | null>; now?: () => Date };
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const json = (value: unknown, status = 200) => Response.json(value, { status, headers });
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const tokenShape = { id: exportTokens.id, label: exportTokens.label, createdAt: exportTokens.createdAt, expiresAt: exportTokens.expiresAt, lastUsedAt: exportTokens.lastUsedAt };
const tokenInput = z.object({ label: z.string().trim().min(1).max(64), expiresInDays: z.union([z.literal(30), z.literal(90), z.literal(365)]).default(90) }).strict();
async function owner(deps: Deps, request: Request) {
  const session = await deps.getSession(request.headers);
  if (!session?.user) return null;
  const [user] = await deps.getDb().select({ id: users.id, username: users.username }).from(users).where(and(eq(users.id, session.user.id), eq(users.banned, false))).limit(1);
  return user ?? null;
}
async function boundedJson(request: Request) {
  const reader = request.body?.getReader(); if (!reader) throw new Error("Empty input");
  const chunks: Uint8Array[] = []; let size = 0;
  try { for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > 2048) throw new Error("Input too large"); chunks.push(value); } return JSON.parse(Buffer.concat(chunks).toString()); }
  finally { await reader.cancel(); }
}

/** Session-only token management. The secret is returned exactly once, never stored. */
export function buildExportTokenHandlers(deps: Deps) {
  const now = deps.now ?? (() => new Date());
  async function run(request: Request, operation: "GET" | "POST" | "DELETE") {
    try {
      const user = await owner(deps, request); if (!user) return json({ error: "Autenticazione richiesta." }, 401);
      const db = deps.getDb();
      if (operation === "GET") return json({ tokens: await db.select(tokenShape).from(exportTokens).where(eq(exportTokens.userId, user.id)).orderBy(desc(exportTokens.createdAt), desc(exportTokens.id)) });
      if (!isAllowedRequestOrigin(request, { requireOrigin: true })) return json({ error: "Origine non consentita." }, 403);
      if (operation === "DELETE") {
        const id = new URL(request.url).searchParams.get("id"); if (!z.uuid().safeParse(id).success) return json({ error: "Token non trovato." }, 404);
        const deleted = await db.delete(exportTokens).where(and(eq(exportTokens.id, id!), eq(exportTokens.userId, user.id))).returning({ id: exportTokens.id });
        return deleted.length ? json({ ok: true }) : json({ error: "Token non trovato." }, 404);
      }
      if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return json({ error: "Invia dati JSON." }, 400);
      let body: unknown; try { body = await boundedJson(request); } catch { return json({ error: "Dati non validi." }, 400); }
      const input = tokenInput.safeParse(body); if (!input.success) return json({ error: "Indica nome e durata del token (30, 90 o 365 giorni)." }, 400);
      return await db.transaction(async tx => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`export-token:${user.id}`}))`);
        const existing = await tx.select({ id: exportTokens.id }).from(exportTokens).where(eq(exportTokens.userId, user.id)).limit(20);
        if (existing.length >= 20) return json({ error: "Limite di 20 token raggiunto. Revoca un token prima di crearne un altro." }, 429);
        const token = `syncloric_export_${randomBytes(32).toString("base64url")}`;
        const [metadata] = await tx.insert(exportTokens).values({ userId: user.id, label: input.data.label, tokenHash: hash(token), expiresAt: new Date(now().getTime() + input.data.expiresInDays * 86400000) }).returning(tokenShape);
        return json({ token, metadata }, 201);
      });
    } catch { return json({ error: "Gestione token temporaneamente non disponibile." }, 503); }
  }
  return { GET: (request: Request) => run(request, "GET"), POST: (request: Request) => run(request, "POST"), DELETE: (request: Request) => run(request, "DELETE") };
}

const querySchema = z.object({ format: z.enum(["json", "csv"]).default("json"), from: z.iso.date().optional(), to: z.iso.date().optional() }).strict().refine(v => !v.from || !v.to || v.from <= v.to);
function csvCell(value: unknown) {
  let text = value == null ? "" : String(value);
  if (typeof value === "string" && /^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
function stream(iterator: AsyncGenerator<string>, signal: AbortSignal) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try { if (signal.aborted) { await iterator.return(""); controller.close(); return; } const next = await iterator.next(); if (next.done) controller.close(); else controller.enqueue(encoder.encode(next.value)); }
      catch (error) { controller.error(error); }
    },
    async cancel() { await iterator.return(""); },
  });
}
/** Read-only export. Owner always comes from the session or this endpoint's bearer. */
export function buildExportHandlers(deps: Deps) {
  const now = deps.now ?? (() => new Date());
  return { async GET(request: Request) {
    try {
      const db = deps.getDb(); let user: { id: string; username: string | null } | null;
      const authorization = request.headers.get("authorization");
      if (authorization !== null) {
        const match = /^Bearer (syncloric_export_[A-Za-z0-9_-]{43})$/.exec(authorization);
        if (!match) return json({ error: "Token non valido o scaduto." }, 401);
        const [access] = await db.select({ tokenId: exportTokens.id, id: users.id, username: users.username }).from(exportTokens).innerJoin(users, eq(exportTokens.userId, users.id))
          .where(and(eq(exportTokens.tokenHash, hash(match[1])), gt(exportTokens.expiresAt, now()), eq(users.banned, false))).limit(1);
        if (!access) return json({ error: "Token non valido o scaduto." }, 401);
        await db.update(exportTokens).set({ lastUsedAt: now() }).where(eq(exportTokens.id, access.tokenId)); user = access;
      } else user = await owner(deps, request);
      if (!user) return json({ error: "Autenticazione richiesta." }, 401);
      const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
      if (!parsed.success) return json({ error: "Usa format=json o csv e un intervallo from/to valido (YYYY-MM-DD)." }, 400);
      const { format, from, to } = parsed.data;
      const userId = user.id;
      const predicate = and(eq(diaryEntries.userId, userId), from ? gte(diaryEntries.date, from) : undefined, to ? lte(diaryEntries.date, to) : undefined);
      const [profile] = await db.select({ sex: profiles.sex, heightCm: profiles.heightCm, weightKg: profiles.weightKg, birthYear: profiles.birthYear, activityLevel: profiles.activityLevel, goal: profiles.goal, targetSource: profiles.targetSource, manualTargetKcal: profiles.manualTargetKcal, calculatedTargetKcal: profiles.calculatedTargetKcal }).from(profiles).where(eq(profiles.userId, userId));
      async function* entries() {
        let cursor: { date: string; id: string } | null = null;
        for (;;) {
          if (request.signal.aborted) return;
          const rows: { entry: typeof diaryEntries.$inferSelect; foodName: string | null; recipeName: string | null }[] = await db.select({ entry: diaryEntries, foodName: foods.name, recipeName: recipes.name }).from(diaryEntries).leftJoin(foods, eq(diaryEntries.foodId, foods.id)).leftJoin(recipes, eq(diaryEntries.recipeId, recipes.id))
            .where(and(predicate, cursor ? or(gt(diaryEntries.date, cursor.date), and(eq(diaryEntries.date, cursor.date), gt(diaryEntries.id, cursor.id))) : undefined))
            .orderBy(asc(diaryEntries.date), asc(diaryEntries.id)).limit(500);
          for (const { entry, foodName, recipeName } of rows) {
            const factor = entry.source === "norish_sync" && entry.entryType === "recipe" ? Number(entry.servings ?? 1) : 1;
            yield { id: entry.id, date: entry.date, slot: entry.slot, entryType: entry.entryType, name: recipeName ?? foodName ?? "Voce senza nome", foodId: entry.foodId, recipeId: entry.recipeId, quantityGrams: entry.quantityGrams === null ? null : Number(entry.quantityGrams), servings: entry.servings === null ? null : Number(entry.servings), kcal: entry.kcal === null ? null : Math.round(entry.kcal * factor), nutrients: scaleNutrition(normalizeNutrition(entry.nutrients, { protein: entry.protein, fat: entry.fat, carbs: entry.carbs }), factor), source: entry.source, norishDeleted: entry.norishDeleted, createdAt: entry.createdAt, updatedAt: entry.updatedAt };
          }
          if (rows.length < 500) return;
          const last = rows.at(-1)!.entry; cursor = { date: last.date, id: last.id };
        }
      }
      async function* chunks() {
        if (format === "csv") {
          yield "\uFEFF" + ["id", "date", "slot", "entryType", "name", "source", "quantityGrams", "servings", "kcal", ...nutrientSpecs.map(s => `${s.key}_${s.unit === "µg" ? "ug" : s.unit}`), "norishDeleted"].map(csvCell).join(",") + "\r\n";
          for await (const entry of entries()) yield [entry.id, entry.date, entry.slot, entry.entryType, entry.name, entry.source, entry.quantityGrams, entry.servings, entry.kcal, ...nutrientSpecs.map(s => entry.nutrients[s.key]), entry.norishDeleted].map(csvCell).join(",") + "\r\n";
        } else {
          const metadata = { version: 1, generatedAt: now().toISOString(), user: { id: userId, username: user!.username }, range: { from: from ?? null, to: to ?? null }, units: Object.fromEntries(nutrientSpecs.map(s => [s.key, s.unit])), profile: profile ?? null };
          yield JSON.stringify(metadata).slice(0, -1) + ',"foods":[';
          let foodCursor: string | null = null; let comma = "";
          for (;;) {
            if (request.signal.aborted) return;
            const rows = await db.select({ id: foods.id, name: foods.name, brand: foods.brand, barcode: foods.barcode, kcalPer100g: foods.kcalPer100g, nutrientsPer100g: foods.nutrientsPer100g, protein: foods.proteinPer100g, fat: foods.fatPer100g, carbs: foods.carbsPer100g }).from(foods).where(and(eq(foods.createdBy, userId), foodCursor ? gt(foods.id, foodCursor) : undefined)).orderBy(asc(foods.id)).limit(500);
            for (const { protein, fat, carbs, ...food } of rows) { yield comma + JSON.stringify({ ...food, nutrientsPer100g: normalizeNutrition(food.nutrientsPer100g, { protein, fat, carbs }) }); comma = ","; }
            if (rows.length < 500) break; foodCursor = rows.at(-1)!.id;
          }
          yield '],"entries":['; comma = "";
          for await (const entry of entries()) { yield comma + JSON.stringify(entry); comma = ","; }
          yield "]}";
        }
      }
      return new Response(stream(chunks(), request.signal), { headers: { ...headers, "Content-Type": format === "csv" ? "text/csv; charset=utf-8" : "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="syncloric-export.${format}"` } });
    } catch { return json({ error: "Export temporaneamente non disponibile." }, 503); }
  } };
}
