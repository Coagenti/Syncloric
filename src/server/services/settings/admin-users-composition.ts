import { getDb } from "@/server/db";
import { getAuth } from "@/server/auth";
import { buildAdminUsersHandlers } from "./admin-users-http";
export const adminUsersRuntime = buildAdminUsersHandlers({ getDb, getSession: headers => getAuth().api.getSession({ headers }) });
