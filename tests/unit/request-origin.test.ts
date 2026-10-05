import { afterEach, expect, it, vi } from "vitest";
import { appOriginSchema, isAllowedRequestOrigin } from "@/server/http/request-origin";

afterEach(() => vi.unstubAllEnvs());
const request = (origin?: string, extra: Record<string, string> = {}) => new Request("http://localhost:3000/api/v1/diary", {
  method: "POST", headers: { ...(origin === undefined ? {} : { origin }), ...extra },
});

it("accepts the configured HTTPS public origin even when the backend URL is HTTP", () => {
  vi.stubEnv("BETTER_AUTH_URL", " https://calorie.example.com/ ");
  expect(isAllowedRequestOrigin(request("https://calorie.example.com"))).toBe(true);
  expect(isAllowedRequestOrigin(request("http://localhost:3000"))).toBe(false);
});

it.each(["https://evil.example", "https://calorie.example.com.evil.example", "http://calorie.example.com", "https://calorie.example.com:8443", "null", ""])("rejects a foreign or opaque origin %s despite spoofed proxy headers", origin => {
  vi.stubEnv("BETTER_AUTH_URL", "https://calorie.example.com");
  expect(isAllowedRequestOrigin(request(origin, { host: "evil.example", "x-forwarded-host": "evil.example", "x-forwarded-proto": "https", forwarded: "host=evil.example;proto=https" }))).toBe(false);
});

it.each([undefined, "", "   "])("preserves direct access when the public URL is %j", value => {
  vi.stubEnv("BETTER_AUTH_URL", value);
  expect(isAllowedRequestOrigin(request("http://localhost:3000"))).toBe(true);
  expect(isAllowedRequestOrigin(request("https://evil.example", { "x-forwarded-host": "evil.example" }))).toBe(false);
});

it("preserves non-browser requests and the stricter profile policy, rejecting cross-site fetches without Origin", () => {
  expect(isAllowedRequestOrigin(request())).toBe(true);
  expect(isAllowedRequestOrigin(request(), { requireOrigin: true })).toBe(false);
  expect(isAllowedRequestOrigin(request(undefined, { "sec-fetch-site": "cross-site" }))).toBe(false);
});

it.each(["https:calorie.example.com", "https:///calorie.example.com", "https://user:secret@calorie.example.com", "https://calorie.example.com/api/auth", "https://calorie.example.com?x=1", "https://calorie.example.com#x", "ftp://calorie.example.com", "*"])("rejects malformed public URL %s", value => {
  expect(appOriginSchema.safeParse(value).success).toBe(false);
});
