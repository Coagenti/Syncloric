import { getDb } from "@/server/db";
import { getAuth } from "@/server/auth";
import { buildNorishUrlHandlers } from "@/server/services/settings/http";

export const dynamic = "force-dynamic";

/** Global admin-only override: TL decision 2026-09-30 16:29 UTC, t_2bd5557f. */
const runtime = buildNorishUrlHandlers({
  getDb,
  getSession: (headers) => getAuth().api.getSession({ headers }),
});

export const GET = runtime.GET;
export const PUT = runtime.PUT;
export const DELETE = runtime.DELETE;
