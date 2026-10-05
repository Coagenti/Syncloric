import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { makeTestDb, closeTestDb, resetTables, type TestDb } from "./setup";
import { resetEnvConfigCache } from "@/server/config";
import { buildCredentialHandlers } from "@/server/services/settings/credentials-http";
import { buildSyncHandlers } from "@/server/services/norish/http";
import { runSchedulerTick } from "@/server/services/scheduler";
import { buildAiHandlers } from "@/server/services/ai/http";
import { aiRuntimeConfig } from "@/server/services/ai/config";
import type { extractLabel } from "@/server/services/ai/extract";
import { norishCredentialKey, aiCredentialKey } from "@/server/services/settings/credentials";
import { decryptSecret } from "@/server/services/norish/crypto";

const admin = "11111111-1111-4111-8111-111111111111";
const member = "22222222-2222-4222-8222-222222222222";
const other = "33333333-3333-4333-8333-333333333333";
let db: TestDb;
let http: ReturnType<typeof vi.fn<typeof fetch>>;
beforeAll(async () => { db = await makeTestDb(); });
afterAll(async () => { await closeTestDb(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); resetEnvConfigCache(); });
beforeEach(async () => {
  await resetTables(db);
  vi.stubEnv("DATABASE_URL", "postgres://test@localhost/test");
  vi.stubEnv("BETTER_AUTH_SECRET", "x".repeat(64)); vi.stubEnv("ENCRYPTION_KEY", "a".repeat(64));
  vi.stubEnv("BETTER_AUTH_URL", undefined); vi.stubEnv("NORISH_BASE_URL", "https://norish.example.invalid");
  vi.stubEnv("NORISH_API_KEY", "legacy-global-must-never-be-used"); resetEnvConfigCache();
  await db.execute(sql`INSERT INTO users (id,username,role) VALUES (${admin}::uuid,'admin','admin'),(${member}::uuid,'member','user'),(${other}::uuid,'other','user')`);
  http = vi.fn<typeof fetch>(async () => Response.json([])); vi.stubGlobal("fetch", http);
});
const deps = (userId = member, role = "user") => ({ getDb: () => db as never, getSession: async () => ({ user: { id: userId, role } }) });
const request = (method: string, body?: unknown, path = "norish-key", origin = "http://localhost") => new Request(`http://localhost/api/v1/settings/${path}`, {
  method, headers: { origin, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const value = async (key: string) => (await db.execute(sql`SELECT value FROM admin_settings WHERE key=${key}`)).rows[0]?.value as { ciphertext: string } | undefined;

it("members create, rotate and delete only their own encrypted Norish key; status and audit expose no secret", async () => {
  const api = buildCredentialHandlers(deps(), "norish");
  expect(await (await api.GET(request("GET"))).json()).toEqual({ configured: false, stored: false, urlConfigured: true });
  const secret = "test-member-norish-secret";
  const saved = await api.PUT(request("PUT", { apiKey: secret }));
  expect(saved.status).toBe(200); expect(await saved.text()).not.toContain(secret);
  const stored = (await value(norishCredentialKey(member)))!;
  expect(JSON.stringify(stored)).not.toContain(secret);
  expect(decryptSecret(stored.ciphertext, "a".repeat(64))).toBe(secret);
  expect(await value(norishCredentialKey(admin))).toBeUndefined();
  expect((await api.PUT(request("PUT", { apiKey: "other-secret", userId: other }))).status).toBe(400);
  const otherApi = buildCredentialHandlers(deps(other), "norish");
  expect(await (await otherApi.GET(request("GET", undefined, `norish-key?userId=${member}`))).json()).toMatchObject({ configured: false });
  await api.PUT(request("PUT", { apiKey: "replacement-member-key" }));
  expect(decryptSecret((await value(norishCredentialKey(member)))!.ciphertext, "a".repeat(64))).toBe("replacement-member-key");
  await otherApi.DELETE(request("DELETE")); expect(await value(norishCredentialKey(member))).toBeDefined();
  await api.DELETE(request("DELETE")); expect(await value(norishCredentialKey(member))).toBeUndefined();
  const audit = JSON.stringify((await db.execute(sql`SELECT * FROM admin_audit_log`)).rows);
  expect(audit).not.toContain(secret); expect(audit).not.toContain("replacement-member-key"); expect(audit).not.toContain(stored.ciphertext);
});

it("credential writes reject unauthenticated, foreign/opaque/missing origins, userId injection, malformed keys and oversized streams", async () => {
  const api = buildCredentialHandlers(deps(), "norish");
  const anonymous = buildCredentialHandlers({ ...deps(), getSession: async () => null }, "norish");
  expect((await anonymous.PUT(request("PUT", { apiKey: "valid" }))).status).toBe(401);
  for (const origin of ["https://evil.example", "null"]) expect((await api.PUT(request("PUT", { apiKey: "valid" }, "norish-key", origin))).status).toBe(403);
  const missing = request("PUT", { apiKey: "valid" }); missing.headers.delete("origin"); expect((await api.PUT(missing)).status).toBe(403);
  for (const apiKey of ["", "bad key", "bad\nkey", "x".repeat(4097)]) expect((await api.PUT(request("PUT", { apiKey }))).status).toBe(400);
  expect((await api.PUT(request("PUT", { apiKey: "valid", userId: other }))).status).toBe(400);
  expect((await api.PUT(request("PUT", { apiKey: "x".repeat(10000) }))).status).toBe(400);
  expect(await value(norishCredentialKey(member))).toBeUndefined(); expect(http).not.toHaveBeenCalled();
});

it("on-demand sync and scheduler use distinct personal keys; the first admin has no global fallback; banned and unconfigured users are skipped", async () => {
  const first = buildSyncHandlers(deps(admin, "admin"));
  const trigger = () => new Request("http://localhost/api/v1/sync", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" }, body: "{}" });
  const absent = await first.POST(trigger()); expect(absent.status).toBe(400); expect(await absent.json()).toMatchObject({ code: "NORISH_KEY_REQUIRED" }); expect(http).not.toHaveBeenCalled();
  await buildCredentialHandlers(deps(), "norish").PUT(request("PUT", { apiKey: "member-only-key" }));
  await buildCredentialHandlers(deps(other), "norish").PUT(request("PUT", { apiKey: "other-only-key" }));
  expect((await buildSyncHandlers(deps()).POST(trigger())).status).toBe(200);
  expect(http).toHaveBeenCalledTimes(2);
  expect(http.mock.calls.every(([, init]) => new Headers(init?.headers).get("x-api-key") === "member-only-key")).toBe(true);
  http.mockClear(); expect((await buildSyncHandlers(deps(other)).POST(trigger())).status).toBe(200);
  expect(http).toHaveBeenCalledTimes(2);
  expect(http.mock.calls.every(([, init]) => new Headers(init?.headers).get("x-api-key") === "other-only-key")).toBe(true);
  http.mockClear(); await runSchedulerTick(new Date(), { db: db as never });
  expect(http).toHaveBeenCalledTimes(4);
  expect(new Set(http.mock.calls.map(([, init]) => new Headers(init?.headers).get("x-api-key")))).toEqual(new Set(["member-only-key", "other-only-key"]));
  expect((await db.execute(sql`SELECT count(*)::int AS n FROM norish_sync_runs WHERE user_id=${admin}::uuid`)).rows[0].n).toBe(0);
  await db.execute(sql`UPDATE users SET banned=true WHERE id=${other}::uuid`);
  http.mockClear(); await runSchedulerTick(new Date(), { db: db as never });
  expect(http).toHaveBeenCalledTimes(2);
  expect(http.mock.calls.every(([, init]) => new Headers(init?.headers).get("x-api-key") === "member-only-key")).toBe(true);
});

it("only admins manage global AI keys; UI keys override env and are used for extraction without leaking in responses or audit", async () => {
  const env = () => ({ OPENAI_API_KEY: "legacy-env-openai" });
  const adminApi = buildCredentialHandlers({ ...deps(admin, "admin"), env }, "ai");
  const userApi = buildCredentialHandlers(deps(), "ai");
  for (const method of ["GET", "PUT", "DELETE"] as const) expect((await userApi[method](request(method, method === "GET" ? undefined : { provider: "openai", apiKey: "stolen" }, "ai-key"))).status).toBe(403);
  const saved = await adminApi.PUT(request("PUT", { provider: "openai", apiKey: "ui-admin-openai-secret" }, "ai-key"));
  expect(saved.status).toBe(200); expect(await saved.json()).toMatchObject({ keys: { openai: true }, keySources: { openai: "ui" } });
  const extract = vi.fn<typeof extractLabel>(async () => ({ name: "Snack", per100g: { kcal: 400, fat: 12, carbs: 60, protein: 8 } }));
  const ai = buildAiHandlers({ ...deps(admin, "admin"), env, extract });
  expect((await ai.PUT(request("PUT", { provider: "openai", enabled: true }, "ai"))).status).toBe(200);
  const response = await ai.POST(new Request("http://localhost/api/v1/label-scan", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify({ expectedProvider: "openai", mime: "image/png", base64: "iVBORw0KGgo=" }) }));
  expect(response.status).toBe(200); expect(extract.mock.calls[0][0]).toMatchObject({ provider: "openai", key: "ui-admin-openai-secret" });
  const publicState = await (await ai.GET(request("GET", undefined, "ai"))).text();
  expect(publicState).not.toContain("ui-admin-openai-secret"); expect(publicState).not.toContain("legacy-env-openai"); expect(publicState).not.toContain("ciphertext");
  const stored = (await value(aiCredentialKey("openai")))!; expect(decryptSecret(stored.ciphertext, "a".repeat(64))).toBe("ui-admin-openai-secret");
  expect(JSON.stringify((await db.execute(sql`SELECT * FROM admin_audit_log`)).rows)).not.toContain(stored.ciphertext);
  expect((await adminApi.DELETE(request("DELETE", { provider: "openai" }, "ai-key"))).status).toBe(200);
  expect((await aiRuntimeConfig(db as never, env())).connection?.key).toBe("legacy-env-openai");
  expect((await adminApi.PUT(request("PUT", { provider: "ollama", apiKey: "invalid-provider" }, "ai-key"))).status).toBe(400);
  expect((await adminApi.PUT(request("PUT", { provider: "openai", apiKey: "valid" }, "ai-key", "https://evil.example"))).status).toBe(403);
  expect(http).not.toHaveBeenCalled();
});

it("a corrupt stored AI key fails closed instead of silently using an env credential", async () => {
  await db.execute(sql`INSERT INTO admin_settings (key,value) VALUES ('ai.provider','"openai"'::jsonb),('ai.enabled','true'::jsonb),('ai.key.openai','{"ciphertext":"corrupt"}'::jsonb)`);
  const state = await aiRuntimeConfig(db as never, { OPENAI_API_KEY: "legacy-env-openai" });
  expect(state.config).toMatchObject({ ready: false, keys: { openai: false }, keySources: { openai: "ui" } });
  expect(state.connection).toBeNull();
});
