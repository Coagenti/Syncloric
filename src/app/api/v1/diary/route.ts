import { getDb } from "@/server/db";
import { getAuth } from "@/server/auth";
import { buildDiaryFeedHandlers } from "@/server/services/diary/feed";

export const dynamic = "force-dynamic";
export const GET = buildDiaryFeedHandlers({
  getDb,
  getSession: (headers) => getAuth().api.getSession({ headers }),
}).GET;
