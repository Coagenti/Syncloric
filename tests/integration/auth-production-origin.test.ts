import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { users } from "@/server/db/schema";
import { closeTestDb, makeTestDb, resetTables, type TestDb } from "./setup";

let db: TestDb;
vi.mock("@/server/db", () => ({ getDb: () => db }));
const publicOrigin = "https://syncloric.coagenti.it";
const backendOrigin = "http://localhost:3000";
const credentials = {
  username: "origin_regression",
  name: "Origin regression",
  email: "origin_regression@users.invalid",
  password: "test-password-123",
};

beforeAll(async () => { db = await makeTestDb(); });
beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv("BETTER_AUTH_URL", publicOrigin);
  vi.stubEnv("BETTER_AUTH_TRUSTED_ORIGINS", undefined);
  vi.stubEnv("BETTER_AUTH_SECRET", "test-only-not-a-real-secret-01234567890123456789");
  vi.stubEnv("DATABASE_URL", "postgres://test@localhost:5432/test");
  vi.stubEnv("ENCRYPTION_KEY", "a".repeat(64));
  vi.stubEnv("NORISH_BASE_URL", undefined);
  const { resetEnvConfigCache } = await import("@/server/config");
  resetEnvConfigCache();
  await resetTables(db);
});
afterAll(async () => {
  await closeTestDb();
  vi.unstubAllEnvs();
  const { resetEnvConfigCache } = await import("@/server/config");
  resetEnvConfigCache();
});

async function signUp(origin: string) {
  const { getAuth } = await import("@/server/auth");
  const auth = getAuth();
  // Better Auth bypasses origin checks in test mode: exercise the real
  // production middleware, not the test-mode bypass.
  (await auth.$context).skipOriginCheck = false;
  return auth.handler(new Request(`${backendOrigin}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(credentials),
  }));
}

it("registers with the production Origin when BETTER_AUTH_URL matches, even on an HTTP backend", async () => {
  const response = await signUp(publicOrigin);
  const body = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(200);
  expect(body.code).not.toBe("INVALID_ORIGIN");
  expect(body.user.email).toBe(credentials.email);
  expect(response.headers.get("set-cookie")).toContain("Secure");
  const persisted = await db.select().from(users).where(eq(users.email, credentials.email));
  expect(persisted).toHaveLength(1);
  expect(persisted[0].id).toBe(body.user.id);
}, 120_000);

it("reproduces INVALID_ORIGIN when deployment keeps the backend URL instead of the public URL", async () => {
  vi.stubEnv("BETTER_AUTH_URL", backendOrigin);
  const response = await signUp(publicOrigin);
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ code: "INVALID_ORIGIN" });
  expect(await db.select().from(users)).toHaveLength(0);
});

it("rejects a foreign Origin after configuring the public URL without creating a user", async () => {
  const response = await signUp("https://untrusted.example.invalid");
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ code: "INVALID_ORIGIN" });
  expect(await db.select().from(users)).toHaveLength(0);
});
