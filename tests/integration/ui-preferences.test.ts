import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import type { Db } from "@/server/db";
import { buildUiPreferencesHandlers } from "@/server/services/profile/ui-preferences-http";
import { closeTestDb, makeTestDb, resetTables, type TestDb } from "./setup";
const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222";
describe("personal UI preferences", () => {
  let db: TestDb;
  beforeAll(async () => { db = await makeTestDb(); }); afterAll(closeTestDb);
  beforeEach(async () => { await resetTables(db); await db.execute(sql`INSERT INTO users(id,username) VALUES(${A}::uuid,'a'),(${B}::uuid,'b')`); });
  const handlers = (id: string | null = A) => buildUiPreferencesHandlers({ getDb: () => db as unknown as Db, getSession: async () => id ? { user: { id } } : null });
  const get = (id = A) => handlers(id).GET(new Request(`http://localhost/api/v1/account/preferences?userId=${B}`));
  const patch = (value: unknown, id: string | null = A, origin = "http://localhost") => handlers(id).PATCH(new Request("http://localhost/api/v1/account/preferences", { method: "PATCH", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(value) }));
  it("returns defaults and stores only the authenticated user's choices", async () => {
    expect((await (await get()).json()).preferences).toEqual({ locale: "it", theme: "cyberpunk" });
    expect((await patch({ theme: "synthwave" })).status).toBe(200);
    expect((await patch({ locale: "en" })).status).toBe(200);
    await patch({ theme: "terminal" }, B);
    const result = await get(); expect(result.headers.get("Cache-Control")).toContain("no-store");
    expect((await result.json()).preferences).toEqual({ locale: "en", theme: "synthwave" });
    expect((await (await get(B)).json()).preferences).toEqual({ locale: "it", theme: "terminal" });
    expect((await patch({ theme: "arasaka-red" })).status).toBe(200);
    expect((await (await get()).json()).preferences).toEqual({ locale: "en", theme: "arasaka-red" });
    expect((await (await get(B)).json()).preferences.theme).toBe("terminal");
  });
  it.each([{}, { locale: "xx" }, { theme: "light" }, { userId: B, locale: "en" }, { locale: null }])("rejects unsupported or forged preference writes", async value => {
    expect((await patch(value)).status).toBe(400);
    expect((await get()).status).toBe(200);
  });
  it("rejects missing/banned sessions and cross-origin changes", async () => {
    expect((await patch({ locale: "en" }, null)).status).toBe(401);
    expect((await patch({ locale: "en" }, A, "https://other.invalid")).status).toBe(403);
    await db.execute(sql`UPDATE users SET banned=true WHERE id=${A}::uuid`);
    expect((await patch({ theme: "terminal" })).status).toBe(401);
  });
  it("removes preferences with the account while preserving other users", async () => {
    await patch({ locale: "en" }); await patch({ theme: "terminal" }, B);
    await db.execute(sql`DELETE FROM users WHERE id=${A}::uuid`);
    const rows = (await db.execute(sql`SELECT user_id FROM user_ui_preferences`)).rows;
    expect(rows).toEqual([{ user_id: B }]);
  });
});
