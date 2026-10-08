import { getAuth } from "@/server/auth";
import { getDb } from "@/server/db";
import { buildHouseholdHandlers } from "@/server/services/households/http";
export const dynamic = "force-dynamic";
export const { GET, POST } = buildHouseholdHandlers({ getDb, getSession: headers => getAuth().api.getSession({ headers }) });
