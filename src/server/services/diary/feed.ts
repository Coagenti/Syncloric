import { and, desc, eq, gte, lt } from "drizzle-orm";
import { NextResponse } from "next/server";
import type { Db } from "@/server/db";
import { diaryEntries, foods, norishSyncRuns, profiles, recipes } from "@/server/db/schema";
import { NORISH_SETTINGS_KEY, norishBaseUrl } from "@/server/config";
import { getAdminSetting } from "@/server/db/repositories/settings";
import { buildAdminSettingsOverride } from "@/server/services/settings/norish-url";

/** Read-only, session-scoped projection: never return raw upstream errors or keys. */
export function buildDiaryFeedHandlers(deps: {
  getDb: () => Db;
  getSession: (headers: Headers) => Promise<{ user: { id: string } } | null>;
}) {
  return {
    async GET(request: Request) {
      const session = await deps.getSession(request.headers);
      if (!session?.user) return NextResponse.json({ error: "Autenticazione richiesta." }, { status: 401 });
      const month = new URL(request.url).searchParams.get("month");
      if (!month || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return NextResponse.json({ error: "Mese non valido." }, { status: 400 });
      const [year, m] = month.split("-").map(Number);
      const end = `${year + (m === 12 ? 1 : 0)}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`;
      const db = deps.getDb();
      const userId = session.user.id;
      const [rows, runs, targets] = await Promise.all([
        db.select({ entry: diaryEntries, recipeName: recipes.name, foodName: foods.name })
          .from(diaryEntries).leftJoin(recipes, eq(diaryEntries.recipeId, recipes.id))
          .leftJoin(foods, eq(diaryEntries.foodId, foods.id))
          .where(and(eq(diaryEntries.userId, userId), gte(diaryEntries.date, `${month}-01`), lt(diaryEntries.date, end)))
          .orderBy(diaryEntries.date, diaryEntries.createdAt),
        db.select({ status: norishSyncRuns.status, reason: norishSyncRuns.reason, finishedAt: norishSyncRuns.finishedAt })
          .from(norishSyncRuns).where(eq(norishSyncRuns.userId, userId))
          .orderBy(desc(norishSyncRuns.startedAt), desc(norishSyncRuns.id)).limit(1),
        db.select({ targetSource: profiles.targetSource, manual: profiles.manualTargetKcal, calculated: profiles.calculatedTargetKcal })
          .from(profiles).where(eq(profiles.userId, userId)).limit(1),
      ]);
      const last = runs[0];
      let origin: string | null = null;
      if (last?.status === "error" && last.reason === "auth") {
        const saved = await getAdminSetting<string>(db, NORISH_SETTINGS_KEY);
        const url = norishBaseUrl(buildAdminSettingsOverride(saved ?? undefined));
        if (url) origin = new URL(url).origin;
      }
      return NextResponse.json({
        entries: rows.map(({ entry, recipeName, foodName }) => ({
          id: entry.id, date: entry.date, slot: entry.slot, entryType: entry.entryType,
          name: recipeName ?? foodName ?? "Voce senza nome", quantityGrams: entry.quantityGrams === null ? null : Number(entry.quantityGrams),
          servings: entry.servings === null ? null : Number(entry.servings),
          kcal: entry.kcal === null ? null : entry.entryType === "recipe" && entry.source === "norish_sync" ? Math.round(entry.kcal * Number(entry.servings ?? 1)) : entry.kcal,
          protein: entry.protein === null ? null : Number(entry.protein), fat: entry.fat === null ? null : Number(entry.fat),
          carbs: entry.carbs === null ? null : Number(entry.carbs), source: entry.source, norishDeleted: entry.norishDeleted,
        })),
        sync: last ? { status: last.status, reason: last.reason === "auth" ? "auth" : null, origin, finishedAt: last.finishedAt?.toISOString() ?? null } : null,
        target: targets[0] ? (targets[0].targetSource === "manual" ? targets[0].manual : targets[0].calculated) : null,
      }, { headers: { "Cache-Control": "private, no-store" } });
    },
  };
}
