import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { makeTestDb, closeTestDb, type TestDb } from "./setup";
import { resetEnvConfigCache } from "@/server/config";
import { buildDiaryCreateHandlers } from "@/server/services/diary/create";
import { buildDiaryMutationHandlers } from "@/server/services/diary/mutate";
import { buildNorishUrlHandlers } from "@/server/services/settings/http";
import { buildBarcodeHandlers } from "@/server/services/foods/http";
import { buildBarcodeSettingsHandlers } from "@/server/services/settings/barcode-http";
import { buildProfileHandlers } from "@/server/services/profile/http";
import { buildAiHandlers } from "@/server/services/ai/http";
import { buildSyncHandlers } from "@/server/services/norish/http";
import { buildAdminUsersHandlers } from "@/server/services/settings/admin-users-http";

let db: TestDb;
vi.mock("@/server/db", () => ({ getDb: () => db }));
const publicOrigin = "https://calorie.example.com";

beforeAll(async () => {
  vi.stubEnv("BETTER_AUTH_URL", publicOrigin);
  vi.stubEnv("BETTER_AUTH_SECRET", "test-only-not-a-real-secret-01234567890123456789");
  vi.stubEnv("DATABASE_URL", "postgres://test@localhost:5432/test");
  vi.stubEnv("ENCRYPTION_KEY", "a".repeat(64));
  vi.stubEnv("NORISH_BASE_URL", "");
  resetEnvConfigCache();
  db = await makeTestDb();
}, 120_000);
afterAll(async () => { await closeTestDb(); vi.unstubAllEnvs(); resetEnvConfigCache(); });

it("public HTTPS origin works for real auth/cookies and API writes through an HTTP backend; foreign origins stay blocked", async () => {
  const { getAuth } = await import("@/server/auth");
  const auth = getAuth();
  // Better Auth bypasses origin checks in test mode by default. Exercise its
  // production middleware against the real configured auth instance.
  (await auth.$context).skipOriginCheck = false;
  let cookie = "";
  const request = (path: string, method: string, body?: unknown, origin = publicOrigin) => new Request(`http://localhost:3000/api/${path}`, {
    method, headers: { origin, cookie, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const credentials = { username: "proxy_user", name: "Proxy user", email: "proxy_user@users.invalid", password: "test-password-123" };
  const signup = await auth.handler(request("auth/sign-up/email", "POST", credentials));
  expect(signup.status, await signup.clone().text()).toBe(200);
  expect(signup.headers.get("set-cookie")).toContain("Secure");
  cookie = signup.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  expect((await auth.api.getSession({ headers: new Headers({ cookie }) }))?.user.username).toBe("proxy_user");
  const deps = { getDb: () => db as never, getSession: (headers: Headers) => auth.api.getSession({ headers }) };
  const diary = buildDiaryCreateHandlers(deps), mutations = buildDiaryMutationHandlers(deps);
  const settings = buildNorishUrlHandlers(deps), barcode = buildBarcodeHandlers(deps);
  const barcodeSettings = buildBarcodeSettingsHandlers(deps), profile = buildProfileHandlers(deps);
  const ai = buildAiHandlers(deps), sync = buildSyncHandlers(deps), admin = buildAdminUsersHandlers(deps);
  const food = { date: "2026-10-05", slot: "Breakfast", entryType: "food", name: "Pane", quantityGrams: 50, kcal: 130 };
  const created = await diary.POST(request("v1/diary", "POST", food));
  expect(created.status, await created.clone().text()).toBe(201);
  const { entry } = await created.json();
  const context = { params: Promise.resolve({ id: entry.id }) };
  expect((await mutations.PATCH(request(`v1/diary/${entry.id}`, "PATCH", { kcal: 150 }), context)).status).toBe(200);
  expect((await settings.PUT(request("v1/settings/norish-url", "PUT", { url: "https://recipes.example.com" }))).status).toBe(200);
  expect((await settings.DELETE(request("v1/settings/norish-url", "DELETE"))).status).toBe(200);
  expect((await barcodeSettings.PUT(request("v1/settings/barcode", "PUT", { enabled: false }))).status).toBe(200);
  expect((await ai.PUT(request("v1/settings/ai", "PUT", { provider: "ollama", enabled: false }))).status).toBe(200);
  const profileInput = { sex: "f", heightCm: 165, weightKg: 60, birthYear: 1990, activityLevel: "sedentary", goal: "maintain", targetSource: "manual", manualTargetKcal: 2000 };
  expect((await profile.PUT(request("v1/profile", "PUT", profileInput))).status).toBe(200);
  expect((await profile.PREVIEW(request("v1/profile/preview", "POST", profileInput))).status).toBe(200);
  expect((await barcode.POST(request("v1/barcode", "POST", { barcode: "8001234567890", name: "Snack", kcalPer100g: 400, grams: 25, date: "2026-10-05", slot: "Snack" }))).status).toBe(201);
  expect((await sync.POST(request("v1/sync", "POST", {}))).status).toBe(503); // no upstream configured, origin accepted
  expect((await ai.POST(request("v1/label-scan", "POST", {}))).status).toBe(409); // AI disabled, origin accepted
  expect((await admin.POST(request("v1/admin/users", "POST", {}))).status).toBe(422); // invalid action, origin accepted
  for (const origin of ["https://evil.example", "http://localhost:3000", "null"]) {
    expect((await diary.POST(request("v1/diary", "POST", food, origin))).status).toBe(403);
    expect((await mutations.PATCH(request(`v1/diary/${entry.id}`, "PATCH", { kcal: 900 }, origin), context)).status).toBe(403);
    expect((await mutations.DELETE(request(`v1/diary/${entry.id}`, "DELETE", undefined, origin), context)).status).toBe(403);
    expect((await settings.PUT(request("v1/settings/norish-url", "PUT", { url: "" }, origin))).status).toBe(403);
    expect((await settings.DELETE(request("v1/settings/norish-url", "DELETE", undefined, origin))).status).toBe(403);
    expect((await barcode.POST(request("v1/barcode", "POST", {}, origin))).status).toBe(403);
    expect((await barcodeSettings.PUT(request("v1/settings/barcode", "PUT", {}, origin))).status).toBe(403);
    expect((await profile.PUT(request("v1/profile", "PUT", profileInput, origin))).status).toBe(403);
    expect((await profile.PREVIEW(request("v1/profile/preview", "POST", profileInput, origin))).status).toBe(403);
    expect((await ai.PUT(request("v1/settings/ai", "PUT", {}, origin))).status).toBe(403);
    expect((await ai.POST(request("v1/label-scan", "POST", {}, origin))).status).toBe(403);
    expect((await sync.POST(request("v1/sync", "POST", {}, origin))).status).toBe(403);
    expect((await admin.POST(request("v1/admin/users", "POST", {}, origin))).status).toBe(403);
    expect((await auth.handler(request("auth/sign-out", "POST", {}, origin))).status).toBe(403);
  }
  expect((await mutations.DELETE(request(`v1/diary/${entry.id}`, "DELETE"), context)).status).toBe(200);
  expect((await auth.handler(request("auth/sign-out", "POST", {}))).status).toBe(200);
  cookie = "";
  expect((await auth.handler(request("auth/sign-in/username", "POST", { username: credentials.username, password: credentials.password }))).status).toBe(200);
}, 120_000);

it("blank public URL preserves direct-access registration instead of reaching Better Auth as an invalid URL", async () => {
  vi.stubEnv("BETTER_AUTH_URL", "   ");
  vi.resetModules();
  const { getAuth } = await import("@/server/auth");
  const auth = getAuth();
  (await auth.$context).skipOriginCheck = false;
  const response = await auth.handler(new Request("http://localhost:3000/api/auth/sign-up/email", {
    method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json" },
    body: JSON.stringify({ username: "direct_user", name: "Direct user", email: "direct_user@users.invalid", password: "test-password-123" }),
  }));
  expect(response.status, await response.clone().text()).toBe(200);
  expect(response.headers.get("set-cookie")).toContain("better-auth.session_token");
});
