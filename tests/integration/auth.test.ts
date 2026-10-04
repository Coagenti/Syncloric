import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { makeTestDb, closeTestDb, resetTables, type TestDb } from "./setup";
import * as bootstrap from "@/server/db/repositories/auth";
import { registrationEmail } from "@/lib/auth";
import { users } from "@/server/db/schema";

let db: TestDb;
let pageHeaders = new Headers();
vi.mock("next/headers", () => ({ headers: async () => pageHeaders }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));
vi.mock("@/server/db", () => ({ getDb: () => db }));

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "postgres://test@localhost:5432/test");
  vi.stubEnv("BETTER_AUTH_SECRET", "test-only-not-a-real-secret-01234567890123456789");
  vi.stubEnv("ENCRYPTION_KEY", "a".repeat(64));
  db = await makeTestDb();
}, 600_000);
afterAll(async () => { await closeTestDb(); vi.unstubAllEnvs(); });

it("registers UUID users through Better Auth, makes only the first admin, persists and revokes sessions", async () => {
  const { getAuth } = await import("@/server/auth");
  const auth = getAuth();
  const register = (username: string) => auth.handler(new Request("http://localhost:3000/api/auth/sign-up/email", {
    method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3000" },
    body: JSON.stringify({ username, name: username, email: `${username}@users.invalid`, password: "test-password-123" }),
  }));
  const first = await register("first_user");
  expect(first.status, await first.clone().text()).toBe(200);
  const second = await register("second_user");
  expect(second.status, await second.clone().text()).toBe(200);
  const rows = await db.select().from(users);
  expect(rows.find(u => u.username === "first_user")?.role).toBe("admin");
  expect(rows.find(u => u.username === "second_user")?.role).toBe("user");
  expect(rows.every(u => /^[0-9a-f-]{36}$/.test(u.id))).toBe(true);
  const login = await auth.handler(new Request("http://localhost:3000/api/auth/sign-in/username", {
    method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3000" },
    body: JSON.stringify({ username: "second_user", password: "test-password-123" }),
  }));
  expect(login.status, await login.clone().text()).toBe(200);
  const cookie = login.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
  const headers = new Headers({ cookie, origin: "http://localhost:3000" });
  const { requirePageSession } = await import("@/server/auth/page-session");
  const { settingsPageProps } = await import("@/server/services/settings/page-data");
  await expect(requirePageSession()).rejects.toThrow("redirect:/login");
  expect((await auth.api.getSession({ headers }))?.user.username).toBe("second_user");
  pageHeaders = headers;
  expect((await requirePageSession()).user.id).toBe(rows.find(u => u.username === "second_user")?.id);
  expect(await settingsPageProps(db as never)).toEqual({ access: "requires-admin" });
  const logout = await auth.handler(new Request("http://localhost:3000/api/auth/sign-out", { method: "POST", headers }));
  expect(logout.status).toBe(200);
  expect(await auth.api.getSession({ headers })).toBeNull();
  await expect(requirePageSession()).rejects.toThrow("redirect:/login");
  await expect(settingsPageProps(db as never)).rejects.toThrow("redirect:/login");
}, 600_000);

it("never promotes a second admin when registrations have identical timestamps", async () => {
  await resetTables(db);
  const { bootstrapFirstAdmin } = await import("@/server/db/repositories/auth");
  const timestamp = new Date("2026-01-01T00:00:00Z");
  const first = "bbbbbbbb-1111-4111-8111-111111111111";
  const second = "aaaaaaaa-1111-4111-8111-111111111111";
  await db.insert(users).values({ id: first, username: "first", createdAt: timestamp });
  await bootstrapFirstAdmin(db as never, first);
  await db.insert(users).values({ id: second, username: "second", createdAt: timestamp });
  await bootstrapFirstAdmin(db as never, second);
  const rows = await db.select().from(users);
  expect(rows.filter(user => user.role === "admin").map(user => user.id)).toEqual([first]);
}, 600_000);

it("recovers the original first admin on login after a transient registration hook failure", async () => {
  await resetTables(db);
  const original = bootstrap.bootstrapFirstAdmin;
  const spy = vi.spyOn(bootstrap, "bootstrapFirstAdmin").mockRejectedValue(new Error("Test-only bootstrap failure"));
  try {
    const { getAuth } = await import("@/server/auth");
    const auth = getAuth();
    const headers = { "content-type": "application/json", origin: "http://localhost:3000" };
    const failed = await auth.handler(new Request("http://localhost:3000/api/auth/sign-up/email", {
      method: "POST", headers,
      body: JSON.stringify({ username: "recover_user", name: "recover_user", email: registrationEmail("recover_user"), password: "test-password-123" }),
    }));
    expect(failed.status).toBe(500);
    expect((await db.select().from(users))[0]?.role).toBe("user");
    spy.mockImplementation(original);
    const login = await auth.handler(new Request("http://localhost:3000/api/auth/sign-in/username", {
      method: "POST", headers, body: JSON.stringify({ username: "recover_user", password: "test-password-123" }),
    }));
    expect(login.status, await login.clone().text()).toBe(200);
    const rows = await db.select().from(users);
    expect(rows.filter(user => user.role === "admin").map(user => user.username)).toEqual(["recover_user"]);
  } finally { spy.mockRestore(); }
}, 600_000);
