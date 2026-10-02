import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/auth", () => ({ getAuth: () => ({ api: { getSession: async () => null } }) }));
vi.mock("@/server/db", () => ({ getDb: () => { throw new Error("Unauthenticated requests must not use DB"); } }));

// Route exports must expose both handlers; pure business logic lives in services.
import * as route from "@/app/api/v1/diary/route";

describe("diary route wiring", () => {
  it("exports session-guarded POST alongside GET", async () => {
    expect(route).toHaveProperty("POST", expect.any(Function));
    expect(route).toHaveProperty("GET", expect.any(Function));
    const post = (route as unknown as { POST: (request: Request) => Promise<Response> }).POST;
    const response = await post(new Request("http://localhost/api/v1/diary", { method: "POST", body: "{}" }));
    expect(response.status).toBe(401);
  });
});
