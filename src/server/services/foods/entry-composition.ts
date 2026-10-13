import { getDb } from "@/server/db";
import { getAuth } from "@/server/auth";
import { buildFoodEntryHandlers } from "./entry-http";
export const foodEntryHandlers = buildFoodEntryHandlers({ getDb, getSession: headers => getAuth().api.getSession({ headers }) });
