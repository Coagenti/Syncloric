import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb, closeTestDb, type TestDb } from "./setup";
import { adminAuditLog, users, sessions } from "@/server/db/schema";
let db: TestDb;
vi.mock("@/server/db", () => ({ getDb: () => db }));
let adminHeaders: Headers; let memberHeaders: Headers; let adminId: string; let memberId: string;
beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "postgres://test@localhost:5432/test");
  vi.stubEnv("BETTER_AUTH_SECRET", "test-only-not-a-real-secret-01234567890123456789");
  vi.stubEnv("ENCRYPTION_KEY", "a".repeat(64));
  db = await makeTestDb();
  const { getAuth } = await import("@/server/auth");
  for (const username of ["panel_admin", "panel_member"]) {
    const response = await getAuth().handler(new Request("http://localhost:3000/api/auth/sign-up/email", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3000" }, body: JSON.stringify({ username, name: username, email: `${username}@users.invalid`, password: "test-password-123" }) }));
    expect(response.status).toBe(200);
    const headers = new Headers({ cookie: response.headers.getSetCookie().map(c => c.split(";")[0]).join("; "), origin: "http://localhost:3000", "content-type": "application/json" });
    if (username === "panel_admin") adminHeaders = headers; else memberHeaders = headers;
  }
  const rows = await db.select().from(users);
  adminId = rows.find(u => u.username === "panel_admin")!.id;
  memberId = rows.find(u => u.username === "panel_member")!.id;
}, 600_000);
afterAll(async () => { await closeTestDb(); vi.unstubAllEnvs(); });
it("all settings mutations audit the session actor without environment credentials", async () => {
  const { PUT: ai } = await import("@/app/api/v1/settings/ai/route");
  const { PUT: barcode } = await import("@/app/api/v1/settings/barcode/route");
  const { PUT: norish } = await import("@/app/api/v1/settings/norish-url/route");
  for (const [path, handler, body] of [
    ["ai", ai, { enabled: false, provider: "openai" }],
    ["barcode", barcode, { enabled: false }],
    ["norish-url", norish, { url: "https://fixture.example.invalid" }],
  ] as const) {
    const response = await handler(new Request(`http://localhost:3000/api/v1/settings/${path}`, { method: "PUT", headers: adminHeaders, body: JSON.stringify(body) }));
    expect(response.status).toBe(200);
  }
  const audit = await db.select().from(adminAuditLog);
  expect(audit.filter(e => e.action === "settings.update").map(e => ({ actor: e.actorUserId, target: e.target })))
    .toEqual([{ actor: adminId, target: "ai" }, { actor: adminId, target: "barcode.enabled" }, { actor: adminId, target: "norish.base_url" }]);
});
const request = (headers: Headers, body?: unknown) => new Request("http://localhost:3000/api/v1/admin/users", { method: body ? "POST" : "GET", headers, ...(body ? { body: JSON.stringify(body) } : {}) });
it("custom user API guards members and anonymous before DB access", async () => {
  const { GET, POST } = await import("@/app/api/v1/admin/users/route");
  expect((await GET(request(memberHeaders))).status).toBe(403);
  expect((await GET(request(new Headers()))).status).toBe(401);
  expect((await POST(request(memberHeaders, { userId: adminId, action: "demote" }))).status).toBe(403);
});
it("custom API denies final-admin demotion, audit committed, and allows handover", async () => {
  const { GET, POST } = await import("@/app/api/v1/admin/users/route");
  const denied = await POST(request(adminHeaders, { userId: adminId, action: "demote" }));
  expect(denied.status).toBe(409); expect(await denied.json()).toMatchObject({ code: "LAST_ACTIVE_ADMIN" });
  const [audit] = await db.select().from(adminAuditLog).where(eq(adminAuditLog.target, adminId));
  expect(audit).toMatchObject({ actorUserId: adminId, detail: { outcome: "denied" } });
  expect((await POST(request(adminHeaders, { userId: memberId, action: "promote" }))).status).toBe(200);
  const list = await (await GET(request(adminHeaders))).json();
  expect(list.users).toHaveLength(2);
  expect((await POST(request(adminHeaders, { userId: memberId, action: "demote" }))).status).toBe(200);
}, 600_000);
it("ban and unban require trimmed reasons, revoke sessions and audit", async () => {
  const { POST } = await import("@/app/api/v1/admin/users/route");
  expect((await POST(request(adminHeaders, { userId: memberId, action: "ban", reason: "  " }))).status).toBe(422);
  expect((await POST(request(adminHeaders, { userId: memberId, action: "ban", reason: "  Fixture sospensione  " }))).status).toBe(200);
  const [member] = await db.select().from(users).where(eq(users.id, memberId));
  expect(member).toMatchObject({ banned: true, banReason: "Fixture sospensione" });
  expect(await db.select().from(sessions).where(eq(sessions.userId, memberId))).toHaveLength(0);
  expect((await POST(request(adminHeaders, { userId: memberId, action: "unban", reason: "Fixture riattivazione" }))).status).toBe(200);
  const events = await db.select().from(adminAuditLog).where(eq(adminAuditLog.target, memberId));
  expect(events.map(e => e.action)).toEqual(["promote", "demote", "ban", "unban"]);
});
