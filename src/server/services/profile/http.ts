import { z } from "zod";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import type { Db } from "@/server/db";
import { profiles } from "@/server/db/schema";
import { calculateCalorieTarget } from "@/server/services/norish/sync";

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
  }).refine(p => p.targetSource !== "manual" || p.manualTargetKcal != null, { path: ["manualTargetKcal"], message: "Inserisci un obiettivo manuale positivo." });
}
export type ProfileInput = z.infer<ReturnType<typeof inputSchema>>;
export type ProfileData = ProfileInput & { calculatedTargetKcal: number | null };
function profileData(row: typeof profiles.$inferSelect): ProfileData {
  return { sex: row.sex, heightCm: row.heightCm, weightKg: Number(row.weightKg), birthYear: row.birthYear, activityLevel: row.activityLevel, goal: row.goal, targetSource: row.targetSource, manualTargetKcal: row.manualTargetKcal, calculatedTargetKcal: row.calculatedTargetKcal };
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
    if (request.headers.get("origin") !== new URL(request.url).origin) return NextResponse.json({ error: "Origine non valida." }, { status: 403 });
    if (!request.headers.get("content-type")?.startsWith("application/json")) return NextResponse.json({ error: "JSON atteso." }, { status: 415 });
    let payload: unknown;
    try { payload = await request.json(); } catch { return NextResponse.json({ error: "JSON non valido." }, { status: 400 }); }
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
      };
      const fields = Object.fromEntries(Object.keys(z.flattenError(parsed.error).fieldErrors).map(key => [key, [messages[key]]]));
      return NextResponse.json({ error: "Controlla i dati del profilo.", fields }, { status: 422 });
    }
    const input = parsed.data;
    const calculatedTargetKcal = calculateCalorieTarget(input);
    if (!Number.isSafeInteger(calculatedTargetKcal) || calculatedTargetKcal > 2147483647) return NextResponse.json({ error: "Controlla i dati del profilo.", fields: { heightCm: ["I dati producono una stima fuori intervallo."] } }, { status: 422 });
    if (preview) return NextResponse.json({ calculatedTargetKcal }, { headers: { "Cache-Control": "private, no-store" } });
    const now = new Date();
    const values = { ...input, manualTargetKcal: input.manualTargetKcal ?? null, calculatedTargetKcal, weightKg: input.weightKg.toFixed(1), recalculatedAt: now, updatedAt: now };
    const db = deps.getDb();
    const [saved] = await db.insert(profiles).values({ ...values, userId: session.user.id }).onConflictDoUpdate({ target: profiles.userId, set: values }).returning();
    return NextResponse.json({ profile: profileData(saved) }, { headers: { "Cache-Control": "private, no-store" } });
  }
  async function guarded(action: () => Promise<NextResponse>) {
    try {
      const response = await action();
      response.headers.set("Cache-Control", "private, no-store");
      return response;
    } catch {
      return NextResponse.json({ error: "Servizio temporaneamente non disponibile. Riprova." }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
    }
  }
  return {
    GET: (request: Request) => guarded(async () => {
      const session = await deps.getSession(request.headers);
      if (!session?.user) return NextResponse.json({ error: "Autenticazione richiesta." }, { status: 401 });
      return NextResponse.json({ profile: await readProfile(deps.getDb(), session.user.id) }, { headers: { "Cache-Control": "private, no-store" } });
    }),
    PUT: (request: Request) => guarded(() => write(request, false)),
    PREVIEW: (request: Request) => guarded(() => write(request, true)),
  };
}
