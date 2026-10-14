import { getAuth } from "@/server/auth";
import { getDb } from "@/server/db";
import { buildAccountHandlers } from "./account-http";
export const accountHandlers = buildAccountHandlers({ getDb, getSession: headers => getAuth().api.getSession({ headers }) });
