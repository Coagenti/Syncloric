import { getDb } from "@/server/db";
import { buildSharedMealReadHandlers } from "@/server/services/households/meals";
export const dynamic = "force-dynamic";
export const { POST } = buildSharedMealReadHandlers({ getDb, getSession: async () => null });
