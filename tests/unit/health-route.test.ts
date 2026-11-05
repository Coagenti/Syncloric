import { afterEach, describe, expect, it } from "vitest";
import pkg from "../../package.json";
import { GET } from "@/app/api/health/route";

afterEach(() => {
  delete process.env.SYNCLORIC_COMMIT;
  delete process.env.SYNCLORIC_DIGEST;
});

describe("GET /api/health", () => {
  it("riporta la versione reale da package.json, non un literal", async () => {
    const body = await GET().json();
    expect(body.status).toBe("ok");
    expect(body.service).toBe("syncloric");
    expect(body.version).toBe(pkg.version);
    expect(body.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("espone il commit iniettato al build e degrada a 'unknown'", async () => {
    expect((await GET().json()).commit).toBe("unknown");

    process.env.SYNCLORIC_COMMIT = "3862a7ef2aba9727912b7e89d40b04e00ade54c8";
    expect((await GET().json()).commit).toBe("3862a7ef2aba9727912b7e89d40b04e00ade54c8");
  });

  it("omette il digest quando il deployment non lo passa, lo espone quando c'è", async () => {
    expect((await GET().json()).digest).toBeUndefined();

    process.env.SYNCLORIC_DIGEST = "sha256:deadbeef";
    expect((await GET().json()).digest).toBe("sha256:deadbeef");
  });

  it("non è cacheabile: chi lo interroga deve vedere lo stato corrente", async () => {
    const res = GET();
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
