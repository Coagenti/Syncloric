import { z } from "zod";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { isAllowedRequestOrigin } from "@/server/http/request-origin";
import type { Db } from "@/server/db";
import { profiles } from "@/server/db/schema";
import { weightGoalSchema, macroSettingsSchema, defaultMacroSettings, type MacroSettings, type GoalCalculation } from "@/lib/goal-targets";
import { calculateGoal } from "./goals";
import { HttpError, input as readInput, activeUser } from "@/server/services/households/common";

// Same numeric precision and age clamp as the existing schema/calculation.
function inputSchema() {
  const year = new Date().getFullYear();
  return z.object({
    sex: z.enum(["f", "m"]),
    heightCm: z.number().int().positive().max(2147483647),
    weightKg: z.number().positive().max(999.9).multipleOf(0.1),
    birthYear: z.number().int().min(year - 100).max(year - 10),
    activityLevel: z.enum(["sedentary", "light", "moderate", "active", "very_active"]),
    goal: z.enum(["lose", "maintain", "gain"]),
    targetSource: z.enum(["manual", "calculated"]),
    manualTargetKcal: z.number().int().positive().max(2147483647).nullable().optional(),
    weightGoal: weightGoalSchema.nullable().optional(),
  }).refine(p => p.targetSource !== "manual" || p.manualTargetKcal != null, { path: ["manualTargetKcal"], message: "Inserisci un obiettivo manuale positivo." });
}
export type ProfileInput = z.infer<ReturnType<typeof inputSchema>>;
export type ProfileData = ProfileInput & { calculatedTargetKcal: number | null; macroSettings?: MacroSettings; calculation?: GoalCalculation };
function profileData(row: typeof profiles.$inferSelect): ProfileData {
  const data = { sex: row.sex, heightCm: row.heightCm, weightKg: Number(row.weightKg), birthYear: row.birthYear, activityLevel: row.activityLevel, goal: row.goal, targetSource: row.targetSource, manualTargetKcal: row.manualTargetKcal, weightGoal: row.weightGoal };
  const calculation = calculateGoal(data);
  return { ...data, calculatedTargetKcal: row.weightGoal ? calculation.calculatedTargetKcal : row.calculatedTargetKcal, calculation, macroSettings: row.macroSettings ?? defaultMacroSettings };
}
export async function readProfile(db: Db, userId: string): Promise<ProfileData | null> {
  const [row] = await db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1);
  return row ? profileData(row) : null;
}
/** Session-only UPSERT and server preview; payload userId/calculated kcal are ignored. */
export function buildProfileHandlers(deps: {
  getDb: () => Db;
  getSession: (headers: Headers) => Promise<{ user: { id: string } } | null>;
}) {
  async function write(request: Request, preview: boolean) {
    const session = await deps.getSession(request.headers);
    if (!session?.user) return NextResponse.json({ error: "Autenticazione richiesta." }, { status: 401 });
    // Defense-in-depth for cookie-authenticated writes; JSON only, no form posts.
    if (!isAllowedRequestOrigin(request, { requireOrigin: true })) return NextResponse.json({ error: "Origine non valida." }, { status: 403 });
    if (!request.headers.get("content-type")?.startsWith("application/json")) return NextResponse.json({ error: "JSON atteso." }, { status: 415 });
    let payload: unknown;
    try { payload = await readInput(request, z.unknown()); } catch (error) { if (error instanceof HttpError) throw error; return NextResponse.json({ error: "JSON non valido." }, { status: 400 }); }
    if (preview && typeof payload === "object" && payload !== null && !Array.isArray(payload)) payload = { ...payload, targetSource: "calculated", manualTargetKcal: null };
    const parsed = inputSchema().safeParse(payload);
    if (!parsed.success) {
      const year = new Date().getFullYear();
      const messages: Record<string, string> = {
        sex: "Seleziona Donna o Uomo per il calcolo.",
        heightCm: "Inserisci un’altezza intera tra 1 e 2147483647 cm.",
        weightKg: "Inserisci un peso tra 0,1 e 999,9 kg, con al massimo un decimale.",
        birthYear: `Inserisci un anno di nascita intero tra ${year - 100} e ${year - 10} (età da 10 a 100 anni).`,
        activityLevel: "Seleziona un livello di attività dall’elenco.",
        goal: "Seleziona Perdita peso, Mantenimento o Massa.",
        targetSource: "Seleziona Calcolato o Manuale.",
        manualTargetKcal: "Inserisci un target manuale intero tra 1 e 2147483647 kcal.",
        weightGoal: "Inserisci un peso desiderato positivo con un decimale e una data valida.",
      };
      const fields = Object.fromEntries(Object.keys(z.flattenError(parsed.error).fieldErrors).map(key => [key, [messages[key]]]));
      return NextResponse.json({ error: "Controlla i dati del profilo.", fields }, { status: 422 });
    }
    const input = parsed.data;
    const calculation = calculateGoal(input);
    const calculatedTargetKcal = calculation.calculatedTargetKcal;
    if (!Number.isSafeInteger(calculatedTargetKcal) || calculatedTargetKcal > 2147483647) return NextResponse.json({ error: "Controlla i dati del profilo.", fields: { heightCm: ["I dati producono una stima fuori intervallo."] } }, { status: 422 });
    if (preview) return NextResponse.json({ calculatedTargetKcal, calculation }, { headers: { "Cache-Control": "private, no-store" } });
    if (input.weightGoal && input.goal !== "lose") return NextResponse.json({ error: "La scadenza si applica alla perdita di peso.", fields: { weightGoal: ["Scegli Perdita peso o disattiva l’obiettivo temporale."] } }, { status: 422 });
    if (input.weightGoal && ["limited", "unavailable"].includes(calculation.status)) return NextResponse.json({ error: calculation.message, fields: { weightGoal: [calculation.message] } }, { status: 422 });
    const now = new Date();
    const values = { ...input, manualTargetKcal: input.manualTargetKcal ?? null, calculatedTargetKcal, weightKg: input.weightKg.toFixed(1), recalculatedAt: now, updatedAt: now };
    const db = deps.getDb();
    await activeUser(db, session.user.id);
    if (input.weightGoal && input.weightGoal.targetWeightKg >= input.weightKg) {
      const existing = await readProfile(db, session.user.id);
      if (!existing?.weightGoal || existing.weightGoal.targetWeightKg !== input.weightGoal.targetWeightKg) return NextResponse.json({ error: "Il peso desiderato deve essere inferiore al peso attuale.", fields: { weightGoal: ["Il peso desiderato deve essere inferiore al peso attuale."] } }, { status: 422 });
    }
    const [saved] = await db.insert(profiles).values({ ...values, userId: session.user.id }).onConflictDoUpdate({ target: profiles.userId, set: values }).returning();
    return NextResponse.json({ profile: profileData(saved) }, { headers: { "Cache-Control": "private, no-store" } });
  }
  async function guarded(action: () => Promise<NextResponse>) {
    try {
      const response = await action();
      response.headers.set("Cache-Control", "private, no-store");
      return response;
    } catch (error) {
      if (error instanceof HttpError) return NextResponse.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "private, no-store" } });
      return NextResponse.json({ error: "Servizio temporaneamente non disponibile. Riprova." }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
    }
  }
  return {
    GET: (request: Request) => guarded(async () => {
      const session = await deps.getSession(request.headers);
      if (!session?.user) return NextResponse.json({ error: "Autenticazione richiesta." }, { status: 401 });
      await activeUser(deps.getDb(), session.user.id);
      return NextResponse.json({ profile: await readProfile(deps.getDb(), session.user.id) }, { headers: { "Cache-Control": "private, no-store" } });
    }),
    MACROS: (request: Request) => guarded(async () => {
      const session = await deps.getSession(request.headers);
      if (!session?.user) return NextResponse.json({ error: "Autenticazione richiesta." }, { status: 401 });
      if (!isAllowedRequestOrigin(request, { requireOrigin: true })) return NextResponse.json({ error: "Origine non valida." }, { status: 403 });
      if (!request.headers.get("content-type")?.startsWith("application/json")) return NextResponse.json({ error: "JSON atteso." }, { status: 415 });
      const body = await readInput(request, z.unknown());
      const parsed = macroSettingsSchema.safeParse(body);
      if (!parsed.success) return NextResponse.json({ error: "Le percentuali devono sommare 100: carboidrati 45–60%, proteine 10–35%, grassi 20–35%." }, { status: 422 });
      await activeUser(deps.getDb(), session.user.id);
      const existing = await readProfile(deps.getDb(), session.user.id);
      if (existing && new Date().getUTCFullYear() - existing.birthYear < 18) return NextResponse.json({ error: "I suggerimenti macro dell’app sono previsti per adulti. Per i minori serve un percorso personalizzato." }, { status: 422 });
      const [saved] = await deps.getDb().update(profiles).set({ macroSettings: parsed.data, updatedAt: new Date() }).where(eq(profiles.userId, session.user.id)).returning();
      if (!saved) return NextResponse.json({ error: "Salva prima i dati nella tab Obiettivo." }, { status: 409 });
      return NextResponse.json({ profile: profileData(saved) });
    }),
    PUT: (request: Request) => guarded(() => write(request, false)),
    PREVIEW: (request: Request) => guarded(() => write(request, true)),
  };
}
