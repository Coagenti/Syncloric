import { expect, it, vi } from "vitest";
import { buildSyncHandlers } from "@/server/services/norish/http";

const request = (headers: Record<string, string> = { "content-type": "application/json" }) =>
  new Request("https://syncloric.example/api/v1/sync", { method: "POST", headers, body: "{}" });

it("returns 401 before touching DB or request guards when no session exists", async () => {
  const getDb = vi.fn(() => { throw new Error("DB must not be touched"); });
  const response = await buildSyncHandlers({ getDb, getSession: async () => null }).POST(request({}));
  expect(response.status).toBe(401);
  expect(getDb).not.toHaveBeenCalled();
});

it.each([
  [{ "content-type": "text/plain" }, 400],
  [{ "content-type": "application/json", origin: "https://sibling.example" }, 403],
  [{ "content-type": "application/json", origin: "null" }, 403],
] as const)("rejects unsafe authenticated request %j with %i before DB", async (headers, status) => {
  const getDb = vi.fn(() => { throw new Error("DB must not be touched"); });
  const response = await buildSyncHandlers({ getDb, getSession: async () => ({ user: { id: "u1" } }) }).POST(request(headers));
  expect(response.status).toBe(status);
  expect(getDb).not.toHaveBeenCalled();
});

it("sanitizes DB failure and releases the local user flag on every retry", async () => {
  const getDb = vi.fn(() => { throw new Error("raw-db-diagnostic"); });
  const handlers = buildSyncHandlers({ getDb, getSession: async () => ({ user: { id: "db-failure-user" } }) });
  for (let i = 0; i < 2; i++) {
    const response = await handlers.POST(request());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toMatch(/raw-db-diagnostic|già in corso/);
  }
  expect(getDb).toHaveBeenCalledTimes(2);
});
