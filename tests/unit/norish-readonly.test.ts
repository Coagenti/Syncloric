import { describe, expect, it, vi } from "vitest";
import { NorishClient } from "@/server/services/norish/client";

function setup() {
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response("[]"));
  const client = new NorishClient({ baseUrl: "https://upstream.invalid", apiKey: "", fetchImpl });
  return { client, fetchImpl };
}

describe("Norish read-only boundary", () => {
  it.each(["POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "TRACE", "CONNECT", "CUSTOM", "get", " GET", ""])("rejects method %s without network", async (method) => {
    const { client, fetchImpl } = setup();
    await expect(client.request(method, "/api/v1/health")).rejects.toThrow(/read-only.*GET/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends GET to the injected origin and full API path", async () => {
    const { client, fetchImpl } = setup();
    await client.request("GET", "/api/v1/recipes?limit=2");
    expect(fetchImpl).toHaveBeenCalledWith("https://upstream.invalid/api/v1/recipes?limit=2", expect.objectContaining({ method: "GET" }));
  });

  it.each(["/health", "/api/v1", "/api/v10/health", "https://other.invalid/api/v1/health", "//other.invalid/api/v1/health", "/api/v1/../../admin", "/api/v1/%2e%2e/admin", "/api/v1/%252e%252e/admin", "/api/v1/..\\admin", "/api/v1/%2fadmin", "/api/v1/%5cadmin", "/api/v1/health#fragment", "/api/v1/hea\nlth"])("rejects unsafe path %s before transport", async (path) => {
    const { client, fetchImpl } = setup();
    await expect(client.request("GET", path)).rejects.toThrow(/path/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("disables automatic redirects, including credential forwarding", async () => {
    const { client, fetchImpl } = setup();
    fetchImpl.mockResolvedValue(new Response(null, { status: 302, headers: { Location: "https://other.invalid/admin" } }));
    const response = await client.request("GET", "/api/v1/health");
    expect(response.status).toBe(302);
    expect(fetchImpl).toHaveBeenCalledExactlyOnceWith("https://upstream.invalid/api/v1/health", expect.objectContaining({ redirect: "manual" }));
  });

  it.each(["ftp://upstream.invalid", "https://upstream.invalid?query=1", "https://upstream.invalid#fragment", "https://user:pass@upstream.invalid"])("rejects unsafe base URL %s", (baseUrl) => {
    const fetchImpl = vi.fn<typeof fetch>();
    expect(() => new NorishClient({ baseUrl, apiKey: "", fetchImpl })).toThrow(/base.*URL/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects recipe ID traversal without network", async () => {
    const { client, fetchImpl } = setup();
    await expect(client.getRecipe("../../../admin")).rejects.toThrow(/path/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects even the legacy search POST before transport", async () => {
    const { client, fetchImpl } = setup();
    await expect(client.searchRecipes()).rejects.toThrow(/read-only.*GET/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
