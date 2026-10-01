import { describe, expect, it, vi } from "vitest";
const session = vi.hoisted(() => vi.fn());
vi.mock("@/server/auth", () => ({ getAuth: () => ({ api: { getSession: session } }) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ redirect: (target: string) => { throw new Error(`redirect:${target}`); } }));

vi.mock("@/components/calorie-app", () => ({ CalorieApp: () => null }));
const pages = {
  dashboard: () => import("../../src/app/dashboard/page"),
  diary: () => import("../../src/app/diary/page"),
  calendar: () => import("../../src/app/calendar/page"),
};
describe.each(["dashboard", "diary", "calendar"] as const)("/%s server guard", route => {
  it("redirects anonymous visitors before rendering private UI", async () => {
    session.mockResolvedValue(null);
    const page = await pages[route]();
    await expect(Promise.resolve().then(() => page.default())).rejects.toThrow("redirect:/login");
  });
  it("keeps authenticated visitors on the requested page", async () => {
    session.mockResolvedValue({ user: { id: "user", role: "user" } });
    const page = await pages[route]();
    expect(await page.default()).toBeTruthy();
  });
});
