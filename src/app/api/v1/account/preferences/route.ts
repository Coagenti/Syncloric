import { getAuth } from "@/server/auth";
import { getDb } from "@/server/db";
import { buildUiPreferencesHandlers } from "@/server/services/profile/ui-preferences-http";
export const dynamic = "force-dynamic";
const handlers = buildUiPreferencesHandlers({ getDb, getSession: headers => getAuth().api.getSession({ headers }) });
export const GET = handlers.GET;
export const PATCH = handlers.PATCH;
