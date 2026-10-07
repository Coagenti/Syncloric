import { getAuth } from "@/server/auth";
import { getDb } from "@/server/db";
import { buildCredentialHandlers } from "@/server/services/settings/credentials-http";

export const dynamic = "force-dynamic";
const handlers = buildCredentialHandlers({ getDb, getSession: headers => getAuth().api.getSession({ headers }) }, "norish");
export const { GET, PUT, DELETE } = handlers;
