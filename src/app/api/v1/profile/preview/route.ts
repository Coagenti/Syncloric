import { getDb } from "@/server/db";
import { getAuth } from "@/server/auth";
import { buildProfileHandlers } from "@/server/services/profile/http";
export const dynamic = "force-dynamic";
export const POST = buildProfileHandlers({ getDb, getSession: headers => getAuth().api.getSession({ headers }) }).PREVIEW;
