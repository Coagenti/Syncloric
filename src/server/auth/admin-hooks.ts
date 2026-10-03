import { APIError, createAuthMiddleware, getAuthoritativeSessionFromCtx, isAPIError } from "better-auth/api";
import { getDb } from "@/server/db";
import { adminUpdateDetail, lastAdminMessage, preflightAdminMutation, writeAdminAudit, type AdminMutation } from "@/server/db/repositories/admin-users";

const paths = new Set(["/admin/set-role", "/admin/update-user", "/admin/ban-user", "/admin/unban-user", "/admin/remove-user", "/admin/create-user"]);
type AuditContext = { adminMutation?: AdminMutation };
export const adminHooks = {
  before: createAuthMiddleware(async ctx => {
    if (!ctx.path || !paths.has(ctx.path)) return;
    const session = await getAuthoritativeSessionFromCtx(ctx);
    // Let the native permission middleware produce its own 401/403; no target leakage.
    if (!session || !session.user.role?.split(",").includes("admin") || session.user.banned) return;
    const body = ctx.body as Record<string, unknown>;
    const action = ctx.path.slice("/admin/".length);
    if (action === "create-user") return { context: { context: { adminMutation: { actorUserId: session.user.id, action, target: "new-user", changes: {}, detail: { createdRole: body.role ?? "user" } } } } };
    if (typeof body.userId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.userId)) return;
    const changes: AdminMutation["changes"] = {};
    let detail: Record<string, unknown> = {};
    if (action === "set-role") {
      if (typeof body.role === "string") changes.role = body.role;
      else if (Array.isArray(body.role)) changes.role = body.role.join(",");
      detail = { role: changes.role };
    } else if (action === "update-user") {
      let data = (body.data ?? {}) as Record<string, unknown>;
      // Normalize only the hook view; native validation still receives the original array.
      if (Array.isArray(data.role)) {
        if (!data.role.every(role => typeof role === "string")) return;
        data = { ...data, role: data.role.join(",") };
      }
      if (typeof data.role === "string") changes.role = data.role;
      if (typeof data.banned === "boolean") changes.banned = data.banned;
      detail = adminUpdateDetail(data);
    } else if (action === "ban-user") { changes.banned = true; detail = { banned: true, banReason: body.banReason ?? null }; }
    else if (action === "unban-user") { changes.banned = false; detail = { banned: false }; }
    const mutation: AdminMutation = { actorUserId: session.user.id, target: body.userId, action, changes, remove: action === "remove-user", detail };
    const result = await preflightAdminMutation(getDb(), mutation);
    if (!result.ok && result.code === "LAST_ACTIVE_ADMIN") throw new APIError("CONFLICT", { code: result.code, message: lastAdminMessage });
    if (action === "remove-user" && result.ok) mutation.detail = { email: result.target.email, name: result.target.name };
    return { context: { context: { adminMutation: mutation } } };
  }),
  after: createAuthMiddleware(async ctx => {
    if (!ctx.path || !paths.has(ctx.path) || isAPIError(ctx.context.returned)) return;
    const mutation = (ctx.context as typeof ctx.context & AuditContext).adminMutation;
    if (!mutation) return;
    let target = mutation.target;
    if (mutation.action === "create-user") {
      const returned = ctx.context.returned as { user?: { id?: string } };
      if (!returned?.user?.id) return;
      target = returned.user.id;
    }
    await writeAdminAudit(getDb(), { actorUserId: mutation.actorUserId, action: mutation.action, target, detail: { ...mutation.detail, outcome: "success" } });
  }),
};
