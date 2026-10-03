import { expect, it, vi } from "vitest";
import type { Db } from "@/server/db";
import { buildBarcodeSettingsHandlers } from "@/server/services/settings/barcode-http";
const request = (body: string, headers: Record<string, string> = {}) => new Request("http://localhost/api/v1/settings/barcode", { method: "PUT", headers: { "content-type": "application/json", ...headers }, body });
const getDb = vi.fn((): Db => { throw new Error("must not access database"); });
const handlers = (role: string | null) => buildBarcodeSettingsHandlers({ getDb, getSession: async () => role === null ? null : ({ user: { id: "u", role } }) });
it("requires administrator before body, origin and database access", async () => {
  getDb.mockClear();
  for (const method of ["GET", "PUT"] as const) {
    expect((await handlers(null)[method](request("broken", { origin: "https://other.invalid" }))).status).toBe(401);
    expect((await handlers("user")[method](request("broken"))).status).toBe(403);
  }
  expect(getDb).not.toHaveBeenCalled();
});
it("rejects cross-origin and non-JSON writes before persistence", async () => {
  getDb.mockClear();
  expect((await handlers("admin").PUT(request('{"enabled":false}', { origin: "https://other.invalid" }))).status).toBe(403);
  expect((await handlers("admin").PUT(request('{"enabled":false}', { "content-type": "text/plain" }))).status).toBe(400);
  expect(getDb).not.toHaveBeenCalled();
});
it("rejects malformed JSON, coercion, absent boolean and unknown fields", async () => {
  getDb.mockClear();
  for (const body of ["broken", "null", "{}", '{"enabled":"false"}', '{"enabled":false,"key":"secret"}']) {
    expect((await handlers("admin").PUT(request(body))).status).toBe(400);
  }
  expect(getDb).not.toHaveBeenCalled();
});
it("sanitizes session failures", async () => {
  const api = buildBarcodeSettingsHandlers({ getDb, getSession: async () => { throw new Error("secret"); } });
  const response = await api.GET(new Request("http://localhost/api/v1/settings/barcode"));
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("secret");
});
