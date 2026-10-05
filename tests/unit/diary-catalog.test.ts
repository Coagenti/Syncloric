import { describe, expect, it, vi } from "vitest";
import { buildDiaryCatalogHandlers } from "@/server/services/diary/catalog";
vi.mock("@/server/auth", () => ({ getAuth: () => ({ api: { getSession: async () => null } }) }));
vi.mock("@/server/db", () => ({ getDb: () => { throw new Error("DB must not be accessed"); } }));

describe("diary catalog guards", () => {
  it("authenticates before validation and database access", async () => {
    const getDb = vi.fn();
    const response = await buildDiaryCatalogHandlers({ getDb, getSession: async () => null }).GET(new Request("http://localhost/api/v1/diary/catalog?limit=oops"));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Autenticazione richiesta." });
    expect(getDb).not.toHaveBeenCalled();
  });
  it("sanitizes unexpected failures", async () => {
    const response = await buildDiaryCatalogHandlers({ getDb: () => { throw new Error("postgres password secret"); }, getSession: async () => ({ user: { id: "a" } }) }).GET(new Request("http://localhost/api/v1/diary/catalog"));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Non è stato possibile caricare il catalogo. Riprova." });
  });
  it("wires the dynamic authenticated GET route", async () => {
    const route = await import("@/app/api/v1/diary/catalog/route");
    expect(route.dynamic).toBe("force-dynamic");
    expect((await route.GET(new Request("http://localhost/api/v1/diary/catalog"))).status).toBe(401);
  });
});
