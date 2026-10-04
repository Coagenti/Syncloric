import { getDb } from "@/server/db";
import { getAuth } from "@/server/auth";
import { buildProfileHandlers } from "@/server/services/profile/http";
export const dynamic = "force-dynamic";
const handlers = buildProfileHandlers({ getDb, getSession: headers => getAuth().api.getSession({ headers }) });
export const GET = handlers.GET;
export const PUT = handlers.PUT;
