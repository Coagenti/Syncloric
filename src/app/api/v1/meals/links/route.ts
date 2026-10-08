import { getAuth } from "@/server/auth";
import { getDb } from "@/server/db";
import { buildMealLinkHandlers } from "@/server/services/households/meals";
export const dynamic = "force-dynamic";
export const { GET, POST, DELETE } = buildMealLinkHandlers({ getDb, getSession: headers => getAuth().api.getSession({ headers }) });
