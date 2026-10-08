import { getAuth } from "@/server/auth";
import { getDb } from "@/server/db";
import { buildMealCopyHandlers } from "@/server/services/households/meals";
export const dynamic = "force-dynamic";
export const { POST } = buildMealCopyHandlers({ getDb, getSession: headers => getAuth().api.getSession({ headers }) });
