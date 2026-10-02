import { getDb } from "@/server/db";
import { getAuth } from "@/server/auth";
import { buildBarcodeHandlers } from "@/server/services/foods/http";
export const dynamic = "force-dynamic";
const handlers = buildBarcodeHandlers({ getDb, getSession: headers => getAuth().api.getSession({ headers }) });
export const GET = handlers.GET;
export const POST = handlers.POST;
