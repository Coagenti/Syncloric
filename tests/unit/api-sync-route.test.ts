import { expect, it, vi } from "vitest";

const wiring = vi.hoisted(() => ({ getDb: vi.fn(), getSession: vi.fn(async () => null), POST: vi.fn() }));
vi.mock("@/server/db", () => ({ getDb: wiring.getDb }));
vi.mock("@/server/auth", () => ({ getAuth: () => ({ api: { getSession: wiring.getSession } }) }));
vi.mock("@/server/services/norish/http", () => ({ buildSyncHandlers: vi.fn(() => ({ POST: wiring.POST })) }));

it("wires the force-dynamic POST route to DB and Better Auth session headers", async () => {
  const route = await import("@/app/api/v1/sync/route");
  const { buildSyncHandlers } = await import("@/server/services/norish/http");
  expect(route.dynamic).toBe("force-dynamic");
  expect(route.POST).toBe(wiring.POST);
  const deps = vi.mocked(buildSyncHandlers).mock.calls[0][0];
  expect(deps.getDb).toBe(wiring.getDb);
  const headers = new Headers({ cookie: "test-only-cookie" });
  await deps.getSession(headers);
  expect(wiring.getSession).toHaveBeenCalledWith({ headers });
});
