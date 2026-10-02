import { getDb } from "@/server/db";
import { getAuth } from "@/server/auth";
import { buildAiHandlers } from "./http";
export const aiRuntime = buildAiHandlers({ getDb, getSession: headers => getAuth().api.getSession({ headers }) });
