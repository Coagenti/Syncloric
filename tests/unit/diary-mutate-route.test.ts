import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/auth", () => ({ getAuth: () => ({ api: { getSession: async () => null } }) }));
vi.mock("@/server/db", () => ({ getDb: () => { throw new Error("Unauthenticated requests must not use DB"); } }));

// Route exports must expose GET/POST/PATCH/DELETE; pure business logic lives in services.
import * as route from "@/app/api/v1/diary/[id]/route";

describe("diary [id] route wiring", () => {
  it("exports session-guarded PATCH and DELETE returning sanitized errors", async () => {
    expect(route).toHaveProperty("PATCH", expect.any(Function));
    expect(route).toHaveProperty("DELETE", expect.any(Function));
    const { PATCH, DELETE } = route as unknown as {
      PATCH: (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response>;
      DELETE: (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response>;
    };
    const context = { params: Promise.resolve({ id: "aaaaaaaa-1111-4111-8111-111111111111" }) };
    const patch = await PATCH(new Request("http://localhost/api/v1/diary/x", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: "{}" }), context);
    expect(patch.status).toBe(401);
    expect(await patch.json()).toEqual({ error: "Autenticazione richiesta." });
    const del = await DELETE(new Request("http://localhost/api/v1/diary/x", { method: "DELETE" }), context);
    expect(del.status).toBe(401);
    expect(await del.json()).toEqual({ error: "Autenticazione richiesta." });
  });
});