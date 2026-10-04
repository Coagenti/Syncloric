import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { makeTestDb, closeTestDb, resetTables, type TestDb } from "./setup";
import type { Db } from "@/server/db";
import { buildAiHandlers } from "@/server/services/ai/http";
import { extractLabel } from "@/server/services/ai/extract";
import { aiConfig } from "@/server/services/ai/config";
it("reads provider and enabled in one settings SELECT snapshot", async () => {
  const handlers = api();
  await handlers.PUT(request({ enabled: true, provider: "ollama" }, "settings/ai", "PUT"));
  const select = vi.spyOn(db, "select");
  try {
    expect(await aiConfig(db as unknown as Db, {})).toMatchObject({ enabled: true, provider: "ollama", ready: true });
    expect(select).toHaveBeenCalledTimes(1);
  } finally { select.mockRestore(); }
});
const id = "11111111-1111-4111-8111-111111111111";
let db: TestDb;
beforeAll(async () => { db = await makeTestDb(); }); afterAll(closeTestDb);
beforeEach(async () => { await resetTables(db); await db.execute(sql`INSERT INTO users(id,username) VALUES (${id}::uuid,'label-user')`); });
const label = { name: "Snack", per100g: { kcal: 400, fat: 12, carbs: 60, protein: 8 } };
const image = { mime: "image/png", base64: "iVBORw0KGgo=", expectedProvider: "ollama" };
it("rejects stale provider consent before extraction and requires an assertion", async () => {
  const extract = vi.fn<typeof extractLabel>(async () => label);
  const handlers = buildAiHandlers({ getDb: () => db as unknown as Db, getSession: async () => ({ user: { id, role: "admin" } }), env: () => ({ OPENAI_API_KEY: "test" }), extract });
  await handlers.PUT(request({ enabled: true, provider: "openai" }, "settings/ai", "PUT"));
  const stale = await handlers.POST(request(image));
  expect(stale.status).toBe(409);
  expect(await stale.json()).toMatchObject({ code: "AI_PROVIDER_CHANGED" });
  expect(extract).not.toHaveBeenCalled();
  expect((await handlers.POST(request({ mime: image.mime, base64: image.base64 }))).status).toBe(400);
  expect(extract).not.toHaveBeenCalled();
  expect((await handlers.POST(request({ ...image, expectedProvider: "openai" }))).status).toBe(200);
  expect(extract.mock.calls[0][0]).toMatchObject({ provider: "openai" });
});
const request = (body: unknown, path = "label-scan", method = "POST") => new Request(`http://localhost/api/v1/${path}`, { method, headers: { "content-type": "application/json", origin: "http://localhost" }, body: JSON.stringify(body) });
const api = (role = "admin", env: Record<string,string|undefined> = {}) => buildAiHandlers({ getDb: () => db as unknown as Db, getSession: async () => ({ user: { id, role } }), env: () => env });
it("persists only global nonsecret settings atomically, disabled until provider chosen", async () => {
  const handlers = api("admin", { OPENAI_API_KEY: "test-only-secret" });
  expect(await (await handlers.status(new Request("http://localhost/api/v1/label-scan"))).json()).toMatchObject({ enabled: false, provider: null });
  expect((await handlers.PUT(request({ enabled: true, provider: "openai" }, "settings/ai", "PUT"))).status).toBe(200);
  const rows = await db.execute(sql`SELECT key,value FROM admin_settings ORDER BY key`);
  expect(rows.rows).toEqual([{ key: "ai.enabled", value: true }, { key: "ai.provider", value: "openai" }]);
  const text = await (await handlers.GET(new Request("http://localhost/api/v1/settings/ai"))).text();
  expect(text).not.toContain("test-only-secret"); expect(text).toContain('"ready":true');
  expect((await handlers.PUT(request({ enabled: true, provider: "anthropic", key: "secret" }, "settings/ai", "PUT"))).status).toBe(400);
  expect((await api("user").GET(new Request("http://localhost/api/v1/settings/ai"))).status).toBe(403);
  expect((await api("user").PUT(request({ enabled: false, provider: "openai" }, "settings/ai", "PUT"))).status).toBe(403);
});
it.each(["openai", "anthropic", "ollama"] as const)("settings to extraction %s uses mocked HTTP and never saves food/diary", async provider => {
  const text = JSON.stringify(label);
  const http = vi.fn(async () => Response.json(provider === "openai" ? { choices: [{ message: { content: text } }] } : provider === "anthropic" ? { content: [{ type: "text", text }] } : { message: { content: text } }));
  const handlers = buildAiHandlers({ getDb: () => db as unknown as Db, getSession: async () => ({ user: { id, role: "admin" } }), env: () => ({ OPENAI_API_KEY: "test", ANTHROPIC_API_KEY: "test" }), extract: (config, input) => extractLabel(config, input, http) });
  await handlers.PUT(request({ enabled: true, provider }, "settings/ai", "PUT"));
  expect(await (await handlers.POST(request({ ...image, expectedProvider: provider }))).json()).toEqual({ label }); expect(http).toHaveBeenCalledTimes(1);
  expect((await db.execute(sql`SELECT count(*)::int AS n FROM foods`)).rows[0].n).toBe(0);
  expect((await db.execute(sql`SELECT count(*)::int AS n FROM diary_entries`)).rows[0].n).toBe(0);
});
it("fail closed: disabled, missing key, invalid image, origin, auth, provider failure sanitized", async () => {
  const handlers = api();
  expect((await handlers.POST(request(image))).status).toBe(409);
  await handlers.PUT(request({ enabled: true, provider: "openai" }, "settings/ai", "PUT"));
  expect((await handlers.POST(request(image))).status).toBe(409);
  await handlers.PUT(request({ enabled: true, provider: "ollama" }, "settings/ai", "PUT"));
  expect((await handlers.POST(request({ ...image, mime: "image/svg+xml" }))).status).toBe(400);
  expect((await handlers.POST(request({ ...image, base64: "bm90LWFuLWltYWdl" }))).status).toBe(400);
  const cross = request(image); cross.headers.set("origin", "https://evil.invalid"); expect((await handlers.POST(cross)).status).toBe(403);
  const plain = request(image); plain.headers.set("content-type", "text/plain"); expect((await handlers.POST(plain)).status).toBe(400);
  const anonymous = buildAiHandlers({ getDb: () => db as unknown as Db, getSession: async () => null });
  expect((await anonymous.POST(plain)).status).toBe(401);
  const failed = buildAiHandlers({ getDb: () => db as unknown as Db, getSession: async () => ({ user: { id } }), extract: async () => { throw new Error("secret photo raw response"); } });
  const response = await failed.POST(request(image)); expect(response.status).toBe(502);
  expect(await response.text()).not.toContain("secret photo raw response");
  expect(response.headers.get("cache-control")).toContain("no-store");
});
