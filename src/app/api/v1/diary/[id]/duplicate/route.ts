import { getDb } from "@/server/db";
import { getAuth } from "@/server/auth";
import { buildDiaryDuplicateHandlers } from "@/server/services/diary/duplicate";

export const dynamic = "force-dynamic";
export const POST = buildDiaryDuplicateHandlers({ getDb, getSession: headers => getAuth().api.getSession({ headers }) }).POST;
