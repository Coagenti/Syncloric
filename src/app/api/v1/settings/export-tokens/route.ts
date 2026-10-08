import { getAuth } from "@/server/auth";
import { getDb } from "@/server/db";
import { buildExportTokenHandlers } from "@/server/services/export/http";
export const dynamic = "force-dynamic";
export const { GET, POST, DELETE } = buildExportTokenHandlers({ getDb, getSession: headers => getAuth().api.getSession({ headers }) });
