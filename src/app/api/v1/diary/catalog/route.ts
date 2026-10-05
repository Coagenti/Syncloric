import { getDb } from "@/server/db";
import { getAuth } from "@/server/auth";
import { buildDiaryCatalogHandlers } from "@/server/services/diary/catalog";

export const dynamic = "force-dynamic";
export const GET = buildDiaryCatalogHandlers({ getDb, getSession: headers => getAuth().api.getSession({ headers }) }).GET;
