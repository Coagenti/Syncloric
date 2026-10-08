import { getAuth } from "@/server/auth";
import { getDb } from "@/server/db";
import { buildHouseholdMealHandlers } from "@/server/services/households/meals";
export const dynamic = "force-dynamic";
export const { GET } = buildHouseholdMealHandlers({ getDb, getSession: headers => getAuth().api.getSession({ headers }) });
