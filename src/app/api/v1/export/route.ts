import { getAuth } from "@/server/auth";
import { getDb } from "@/server/db";
import { buildExportHandlers } from "@/server/services/export/http";
export const dynamic = "force-dynamic";
export const { GET } = buildExportHandlers({ getDb, getSession: headers => getAuth().api.getSession({ headers }) });
