import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { makeTestDb, resetTables, closeTestDb, type TestDb } from "./setup";
import { runNorishSync, NorishSyncError } from "@/server/services/norish/runner";
import { NorishClient, NorishApiError, type PlannedRecipe } from "@/server/services/norish/client";
import { markDeletedNorishEntries } from "@/server/services/norish/sync";
import { norishUpstreamTimeZone } from "@/server/config";

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const ITEM = "0f0e6f5e-1111-4aaa-8bbb-000000000001";
const RECIPE = "aaaaaaaa-1111-4111-8111-111111111111";
const planned = (date: string, id = ITEM): PlannedRecipe => ({ id, date, slot: "Lunch", recipeId: RECIPE, calories: 100 });

/** Real HTTP client + mocked transport: no upstream requests or writes. */
function client(options: { week?: PlannedRecipe[]; today?: PlannedRecipe[]; month?: PlannedRecipe[]; todayStatus?: number; weekStatus?: number } = {}) {
  const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
    expect(init?.method).toBe("GET");
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/today")) return Response.json(options.today ?? [], { status: options.todayStatus ?? 200 });
    if (path.endsWith("/week")) return Response.json(options.week ?? [], { status: options.weekStatus ?? 200 });
    if (path.endsWith("/month")) return Response.json(options.month ?? []);
    if (path === `/api/v1/recipes/${RECIPE}`) return Response.json({ id: RECIPE, name: "Fixture", servings: 1, calories: 100 });
    throw new Error("Unexpected mock route");
  });
  return { port: new NorishClient({ baseUrl: "https://norish.example", apiKey: "", fetchImpl }), fetchImpl };
}

function rows(result: unknown): Record<string, unknown>[] {
  return Array.isArray(result) ? result : (result as { rows?: Record<string, unknown>[] }).rows ?? [];
}

describe("Norish v2 authoritative windows — HTTP mocked + PGlite", () => {
  let db: TestDb;
  beforeAll(async () => { db = await makeTestDb(); });
  afterAll(async () => { await resetTables(db); await closeTestDb(); });
  beforeEach(async () => {
    await resetTables(db);
    for (const id of [USER, OTHER]) await db.execute(sql`INSERT INTO users (id, username) VALUES (${id}::uuid, ${id})`);
  });
  async function seed(dates: string[], userId = USER, source = "norish_sync") {
    for (const date of dates) await db.execute(sql`INSERT INTO diary_entries (user_id, date, slot, entry_type, source, norish_item_id)
      VALUES (${userId}::uuid, ${date}::date, 'Lunch', 'recipe', ${source}::diary_source, gen_random_uuid())`);
  }
  async function markedDates(userId = USER) {
    return rows(await db.execute(sql`SELECT date::text AS date FROM diary_entries
      WHERE user_id = ${userId}::uuid AND norish_deleted = true ORDER BY date`)).map((r) => r.date);
  }
  const clock = () => new Date("2026-10-01T23:30:00Z");

  it("gap antico: Monday disappears and Thursday remains", async () => {
    await runNorishSync({ db, userId: USER, client: client({ week: [planned("2026-09-28"), planned("2026-10-01", OTHER)] }).port });
    const result = await runNorishSync({ db, userId: USER, client: client({ week: [planned("2026-10-01", OTHER)] }).port });
    expect(result.marked).toBe(1);
    expect(await markedDates()).toEqual(["2026-09-28"]);
  });
  it("sparse Thursday marks Monday/Tuesday/Sunday but not older or next-week dates", async () => {
    await seed(["2026-09-27", "2026-09-28", "2026-09-29", "2026-10-04", "2026-10-11"]);
    expect((await runNorishSync({ db, userId: USER, client: client({ week: [planned("2026-10-01")] }).port })).marked).toBe(3);
    expect(await markedDates()).toEqual(["2026-09-28", "2026-09-29", "2026-10-04"]);
  });
  it("today payload has priority over an older observed week anchor", async () => {
    await seed(["2026-09-28"]);
    expect((await runNorishSync({ db, userId: USER, client: client({ week: [planned("2026-09-20")], today: [planned("2026-10-01", OTHER)] }).port })).marked).toBe(1);
  });
  it("empty UTC week includes boundaries and is idempotent without timestamp churn", async () => {
    await seed(["2026-09-27", "2026-09-28", "2026-10-04", "2026-10-05"]);
    await seed(["2026-09-28"], OTHER);
    await seed(["2026-09-29"], USER, "manual");
    const options = { db, userId: USER, client: client().port, upstreamTimeZone: "UTC", now: clock };
    expect((await runNorishSync(options)).marked).toBe(2);
    expect(await markedDates()).toEqual(["2026-09-28", "2026-10-04"]);
    expect(await markedDates(OTHER)).toEqual([]);
    const before = rows(await db.execute(sql`SELECT id, updated_at FROM diary_entries ORDER BY id`));
    expect((await runNorishSync(options)).marked).toBe(0);
    expect(rows(await db.execute(sql`SELECT id, updated_at FROM diary_entries ORDER BY id`))).toEqual(before);
  });
  it.each([false, true])("month includes both boundaries and excludes adjacent months; empty=%s", async (empty) => {
    await seed(["2026-08-31", "2026-09-01", "2026-09-30", "2026-10-01"]);
    const mock = client({ month: empty ? [] : [planned("2026-09-15")] });
    const result = await runNorishSync({ db, userId: USER, period: "month", client: mock.port, upstreamTimeZone: "UTC", now: () => new Date("2026-09-30T23:59:00Z") });
    expect(result.marked).toBe(2);
    expect(await markedDates()).toEqual(["2026-09-01", "2026-09-30"]);
    const paths = mock.fetchImpl.mock.calls.map(([url]) => new URL(String(url)).pathname);
    expect(paths).not.toContain("/api/v1/planned-recipes/week");
    expect(paths).not.toContain("/api/v1/planned-recipes/today");
  });
  it("explicit upstream timezone determines empty week across UTC Sunday midnight", async () => {
    await seed(["2026-10-04", "2026-10-05", "2026-10-11", "2026-10-12"]);
    expect((await runNorishSync({ db, userId: USER, client: client().port, upstreamTimeZone: "Pacific/Kiritimati", now: () => new Date("2026-10-04T12:30:00Z") })).marked).toBe(2);
    expect(await markedDates()).toEqual(["2026-10-05", "2026-10-11"]);
  });
  it.each([undefined, "Invalid/Zone"])("empty with unset/invalid TZ=%s never marks existing rows", async (tz) => {
    await seed(["2026-09-28", "2026-10-04"]);
    const warn = vi.fn();
    const upstreamTimeZone = norishUpstreamTimeZone({ NORISH_UPSTREAM_TZ: tz }, warn);
    expect((await runNorishSync({ db, userId: USER, client: client().port, upstreamTimeZone })).marked).toBe(0);
    expect(await markedDates()).toEqual([]);
    if (tz) expect(warn).toHaveBeenCalledOnce();
  });
  it("partial non-auth today failure cannot mark with week anchor and configured TZ", async () => {
    await seed(["2026-09-28"]);
    const result = await runNorishSync({ db, userId: USER, client: client({ week: [planned("2026-10-01")], todayStatus: 400 }).port, upstreamTimeZone: "UTC" });
    expect(result.partial).toBe(true);
    expect(result.marked).toBe(0);
    expect(await markedDates()).toEqual([]);
  });
  it.each([401, 403])("HTTP today %i is auth, never partial, no writes locally", async (todayStatus) => {
    await seed(["2026-09-28"]);
    const error = await runNorishSync({ db, userId: USER, client: client({ week: [planned("2026-10-01")], todayStatus }).port, upstreamTimeZone: "UTC" }).catch((e) => e);
    expect(error).toBeInstanceOf(NorishSyncError);
    expect(error.cause).toBeInstanceOf(NorishApiError);
    expect(error.cause.status).toBe(todayStatus);
    expect(await markedDates()).toEqual([]);
  });
  it("total fetch failure cannot mark even with configured TZ", async () => {
    await seed(["2026-09-28"]);
    await expect(runNorishSync({ db, userId: USER, client: client({ weekStatus: 400 }).port, upstreamTimeZone: "UTC" })).rejects.toBeInstanceOf(NorishSyncError);
    expect(await markedDates()).toEqual([]);
  });
  it("core requires both boundaries for empty and non-empty IDs", async () => {
    await seed(["2026-09-28"]);
    for (const window of [{}, { windowStart: "2026-09-28" }, { windowEnd: "2026-10-04" }]) {
      expect(await markDeletedNorishEntries(db, USER, [ITEM], window)).toBe(0);
      expect(await markDeletedNorishEntries(db, USER, [], window)).toBe(0);
    }
    expect(await markedDates()).toEqual([]);
  });
});
