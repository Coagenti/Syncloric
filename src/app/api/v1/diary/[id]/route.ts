import { getDb } from "@/server/db";
import { getAuth } from "@/server/auth";
import { buildDiaryMutationHandlers } from "@/server/services/diary/mutate";

export const dynamic = "force-dynamic";

const deps = {
  getDb,
  getSession: (headers: Headers) => getAuth().api.getSession({ headers }),
};

export const PATCH = buildDiaryMutationHandlers(deps).PATCH;
export const DELETE = buildDiaryMutationHandlers(deps).DELETE;