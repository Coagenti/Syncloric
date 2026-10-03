import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb, closeTestDb, type TestDb } from "./setup";
import { adminAuditLog, sessions, users } from "@/server/db/schema";

// Contract reconnaissance only: no production change. Synthetic local identities.
let db: TestDb;
vi.mock("@/server/db", () => ({ getDb: () => db }));
let adminHeaders: Headers;
let adminId: string;
let memberId: string;
beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "postgres://test@localhost:5432/test");
  vi.stubEnv("BETTER_AUTH_SECRET", "test-only-not-a-real-secret-01234567890123456789");
  vi.stubEnv("ENCRYPTION_KEY", "a".repeat(64));
  db = await makeTestDb();
  const { getAuth } = await import("@/server/auth");
  const register = async (username: string) => {
    const response = await getAuth().handler(new Request("http://localhost:3000/api/auth/sign-up/email", {
      method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3000" },
      body: JSON.stringify({ username, name: username, email: `${username}@users.invalid`, password: "test-password-123" }),
    }));
    expect(response.status, await response.clone().text()).toBe(200);
    return response;
  };
  const first = await register("recon_admin");
  await register("recon_member");
  adminHeaders = new Headers({
    cookie: first.headers.getSetCookie().map(c => c.split(";")[0]).join("; "),
    origin: "http://localhost:3000", "content-type": "application/json",
  });
  const rows = await db.select().from(users);
  adminId = rows.find(u => u.username === "recon_admin")!.id;
  memberId = rows.find(u => u.username === "recon_member")!.id;
}, 600_000);
afterAll(async () => { await closeTestDb(); vi.unstubAllEnvs(); });

it("contract: native update-user must not demote the sole active admin", async () => {
  const { getAuth } = await import("@/server/auth");
  const response = await getAuth().handler(new Request("http://localhost:3000/api/auth/admin/update-user", {
    method: "POST", headers: adminHeaders,
    body: JSON.stringify({ userId: adminId, data: { role: "user" } }),
  }));
  const payload = await response.json();
  const [row] = await db.select({ role: users.role }).from(users).where(eq(users.id, adminId));
  // Restore the synthetic fixture so the next diagnostic remains independent.
  await db.update(users).set({ role: "admin" }).where(eq(users.id, adminId));
  expect({ status: response.status, code: payload.code, persistedRole: row.role })
    .toEqual({ status: 409, code: "LAST_ACTIVE_ADMIN", persistedRole: "admin" });
}, 600_000);

it("contract: admin plugin must deny impersonation of ordinary users", async () => {
  const { getAuth } = await import("@/server/auth");
  const response = await getAuth().handler(new Request("http://localhost:3000/api/auth/admin/impersonate-user", {
    method: "POST", headers: adminHeaders, body: JSON.stringify({ userId: memberId }),
  }));
  // Consume without logging session payloads/cookies/tokens.
  await response.text();
  expect(response.status).toBe(403);
  expect(response.headers.getSetCookie()).toHaveLength(0);
  expect((await db.select().from(sessions)).filter(s => s.impersonatedBy)).toHaveLength(0);
}, 600_000);

it("HTTP native set-role, ban-user, remove-user and update-user enforce last active admin with denied audit", async () => {
  const { getAuth } = await import("@/server/auth");
  for (const [path, body] of [
    ["set-role", { userId: adminId, role: "user" }],
    ["ban-user", { userId: adminId, banReason: "Fixture" }],
    ["remove-user", { userId: adminId }],
    ["update-user", { userId: adminId, data: { banned: true } }],
  ] as const) {
    const response = await getAuth().handler(new Request(`http://localhost:3000/api/auth/admin/${path}`, { method: "POST", headers: adminHeaders, body: JSON.stringify(body) }));
    expect(response.status, path).toBe(409); expect(await response.json()).toMatchObject({ code: "LAST_ACTIVE_ADMIN" });
  }
  const [user] = await db.select().from(users).where(eq(users.id, adminId));
  expect(user).toMatchObject({ role: "admin", banned: false });
  const audit = await db.select().from(adminAuditLog).where(eq(adminAuditLog.target, adminId));
  expect(audit).toHaveLength(5);
  expect(audit.every(e => e.actorUserId === adminId && e.detail.outcome === "denied")).toBe(true);
}, 600_000);
it("auth.api native hooks cannot bypass the invariant", async () => {
  const { getAuth } = await import("@/server/auth");
  for (const call of [
    () => getAuth().api.setRole({ headers: adminHeaders, body: { userId: adminId, role: "user" } }),
    () => getAuth().api.banUser({ headers: adminHeaders, body: { userId: adminId, banReason: "Fixture" } }),
    () => getAuth().api.removeUser({ headers: adminHeaders, body: { userId: adminId } }),
  ]) await expect(call()).rejects.toMatchObject({ statusCode: 409, body: { code: "LAST_ACTIVE_ADMIN" } });
}, 600_000);
it("native update-user audits markers not free-form values and signup/profile pass through", async () => {
  const { getAuth } = await import("@/server/auth");
  const response = await getAuth().handler(new Request("http://localhost:3000/api/auth/admin/update-user", { method: "POST", headers: adminHeaders, body: JSON.stringify({ userId: memberId, data: { name: "Fixture changed", image: "https://sensitive.example.invalid" } }) }));
  expect(response.status).toBe(200);
  const [event] = await db.select().from(adminAuditLog).where(eq(adminAuditLog.target, memberId));
  expect(event).toMatchObject({ actorUserId: adminId, action: "update-user", detail: { nameChanged: true, customFields: 1, outcome: "success" } });
  expect(JSON.stringify(event.detail)).not.toContain("Fixture changed"); expect(JSON.stringify(event.detail)).not.toContain("sensitive");
}, 600_000);
it("native multi-role admin actors audit updates and denied sole-admin demotion", async () => {
  const { getAuth } = await import("@/server/auth");
  const auth = getAuth();
  await auth.api.setRole({ headers: adminHeaders, body: { userId: memberId, role: ["admin", "user"] } });
  try {
    const login = await auth.handler(new Request("http://localhost:3000/api/auth/sign-in/email", {
      method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3000" },
      body: JSON.stringify({ email: "recon_member@users.invalid", password: "test-password-123" }),
    }));
    expect(login.status).toBe(200);
    await login.text();
    const memberHeaders = new Headers({
      cookie: login.headers.getSetCookie().map(c => c.split(";")[0]).join("; "),
      origin: "http://localhost:3000", "content-type": "application/json",
    });
    const update = await auth.handler(new Request("http://localhost:3000/api/auth/admin/update-user", {
      method: "POST", headers: memberHeaders,
      body: JSON.stringify({ userId: memberId, data: { name: "Multi-role fixture" } }),
    }));
    expect(update.status).toBe(200);
    await update.text();
    const [member] = await db.select().from(users).where(eq(users.id, memberId));
    expect(member).toMatchObject({ role: "admin,user", name: "Multi-role fixture" });
    const success = await db.select().from(adminAuditLog).where(eq(adminAuditLog.actorUserId, memberId));
    expect.soft(success).toContainEqual(expect.objectContaining({
      actorUserId: memberId, target: memberId, action: "update-user",
      detail: { nameChanged: true, outcome: "success" },
    }));
    const demote = await auth.handler(new Request("http://localhost:3000/api/auth/admin/set-role", {
      method: "POST", headers: memberHeaders, body: JSON.stringify({ userId: adminId, role: "user" }),
    }));
    expect.soft(demote.status).toBe(409);
    const demoteBody = await demote.text();
    expect.soft(demoteBody ? JSON.parse(demoteBody) : {}).toMatchObject({ code: "LAST_ACTIVE_ADMIN" });
    const [admin] = await db.select().from(users).where(eq(users.id, adminId));
    expect(admin).toMatchObject({ role: "admin", banned: false });
    const denied = await db.select().from(adminAuditLog).where(eq(adminAuditLog.actorUserId, memberId));
    expect(denied).toContainEqual(expect.objectContaining({
      actorUserId: memberId, target: adminId, action: "set-role",
      detail: expect.objectContaining({ outcome: "denied" }),
    }));
  } finally {
    await auth.api.setRole({ headers: adminHeaders, body: { userId: memberId, role: "user" } });
  }
}, 600_000);
it("native update-user array role demotion must return 409 and record denied audit", async () => {
  const { getAuth } = await import("@/server/auth");
  const before = await db.select().from(adminAuditLog).where(eq(adminAuditLog.target, adminId));
  const response = await getAuth().handler(new Request("http://localhost:3000/api/auth/admin/update-user", { method: "POST", headers: adminHeaders, body: JSON.stringify({ userId: adminId, data: { role: ["user"] } }) }));
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ code: "LAST_ACTIVE_ADMIN" });
  const after = await db.select().from(adminAuditLog).where(eq(adminAuditLog.target, adminId));
  expect(after.length).toBe(before.length + 1);
  expect(after.at(-1)).toMatchObject({ actorUserId: adminId, action: "update-user", detail: { role: "user", outcome: "denied", code: "LAST_ACTIVE_ADMIN" } });
  expect((await db.select().from(users).where(eq(users.id, adminId)))[0].role).toBe("admin");
}, 600_000);
it("auth.api adminUpdateUser array role cannot demote the sole active admin", async () => {
  const { getAuth } = await import("@/server/auth");
  const before = await db.select().from(adminAuditLog).where(eq(adminAuditLog.target, adminId));
  await expect(getAuth().api.adminUpdateUser({ headers: adminHeaders, body: { userId: adminId, data: { role: ["user"] } } }))
    .rejects.toMatchObject({ statusCode: 409, body: { code: "LAST_ACTIVE_ADMIN" } });
  const after = await db.select().from(adminAuditLog).where(eq(adminAuditLog.target, adminId));
  expect(after).toHaveLength(before.length + 1);
  expect(after.at(-1)).toMatchObject({ actorUserId: adminId, action: "update-user", detail: { role: "user", outcome: "denied", code: "LAST_ACTIVE_ADMIN" } });
  expect((await db.select().from(users).where(eq(users.id, adminId)))[0].role).toBe("admin");
}, 600_000);
it.each([
  { label: "ordinary promotion", target: "member", initialRole: "user", role: ["admin"], status: 200, persistedRole: "admin", auditRole: "admin" },
  { label: "sole-admin no-op", target: "admin", initialRole: "admin", role: ["admin"], status: 200, persistedRole: "admin", auditRole: "admin" },
  { label: "nonsole demotion", target: "member", initialRole: "admin", role: ["user"], status: 200, persistedRole: "user", auditRole: "user" },
  { label: "sole-admin multi-role denied", target: "admin", initialRole: "admin", role: ["admin", "user"], status: 409, persistedRole: "admin", auditRole: "admin,user" },
  { label: "nonsole multi-role", target: "member", initialRole: "admin", role: ["admin", "user"], status: 200, persistedRole: "admin,user", auditRole: "admin,user" },
  { label: "invalid mixed array", target: "admin", initialRole: "admin", role: ["user", 1], status: 400, persistedRole: "admin", auditRole: undefined },
])("HTTP update-user role-array matrix: $label", async ({ target, initialRole, role, status, persistedRole, auditRole }) => {
  const { getAuth } = await import("@/server/auth");
  const targetId = target === "admin" ? adminId : memberId;
  await db.update(users).set({ role: initialRole }).where(eq(users.id, targetId));
  const [beforeUser] = await db.select().from(users).where(eq(users.id, targetId));
  const beforeAudit = await db.select().from(adminAuditLog);
  try {
    const response = await getAuth().handler(new Request("http://localhost:3000/api/auth/admin/update-user", {
      method: "POST", headers: adminHeaders, body: JSON.stringify({ userId: targetId, data: { role } }),
    }));
    expect(response.status).toBe(status);
    const payload = await response.json();
    if (status === 409) expect(payload).toMatchObject({ code: "LAST_ACTIVE_ADMIN" });
    const [afterUser] = await db.select().from(users).where(eq(users.id, targetId));
    expect(afterUser.role).toBe(persistedRole);
    if (status !== 200) expect(afterUser).toEqual(beforeUser);
    const previousIds = new Set(beforeAudit.map(event => event.id));
    const newEvents = (await db.select().from(adminAuditLog)).filter(event => !previousIds.has(event.id));
    if (status === 400) expect(newEvents).toHaveLength(0);
    else {
      expect(newEvents).toHaveLength(1);
      expect(newEvents[0]).toMatchObject({ actorUserId: adminId, target: targetId, action: "update-user", detail: {
        role: auditRole, outcome: status === 409 ? "denied" : "success",
        ...(status === 409 ? { code: "LAST_ACTIVE_ADMIN" } : {}),
      } });
    }
  } finally {
    await db.update(users).set({ role: "user" }).where(eq(users.id, memberId));
  }
}, 600_000);
it("native create, ban, unban, remove and multi-admin self-demote record successful audits", async () => {
  const { getAuth } = await import("@/server/auth");
  const created = await getAuth().api.createUser({ headers: adminHeaders, body: { email: "new-fixture@users.invalid", name: "New fixture", password: "test-password-123", data: { username: "new_fixture" } } });
  expect(created.user.role).toBe("user");
  await getAuth().api.banUser({ headers: adminHeaders, body: { userId: created.user.id, banReason: "Fixture" } });
  await getAuth().api.unbanUser({ headers: adminHeaders, body: { userId: created.user.id } });
  await getAuth().api.removeUser({ headers: adminHeaders, body: { userId: created.user.id } });
  const events = await db.select().from(adminAuditLog).where(eq(adminAuditLog.target, created.user.id));
  expect(events.map(e => e.action)).toEqual(["create-user", "ban-user", "unban-user", "remove-user"]);
  expect(events.every(e => e.actorUserId === adminId && e.detail.outcome === "success")).toBe(true);
  expect(events[3].detail).toMatchObject({ email: "new-fixture@users.invalid", name: "New fixture" });
  await getAuth().api.setRole({ headers: adminHeaders, body: { userId: memberId, role: "admin" } });
  await getAuth().api.setRole({ headers: adminHeaders, body: { userId: adminId, role: "user" } });
  expect((await db.select().from(users)).filter(u => u.role === "admin" && !u.banned)).toHaveLength(1);
}, 600_000);
