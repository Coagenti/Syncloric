import { getDb } from "@/server/db";
import { getAuth } from "@/server/auth";
import { buildSyncHandlers } from "@/server/services/norish/http";

export const dynamic = "force-dynamic";
export const POST = buildSyncHandlers({
  getDb,
  getSession: (headers) => getAuth().api.getSession({ headers }),
}).POST;
