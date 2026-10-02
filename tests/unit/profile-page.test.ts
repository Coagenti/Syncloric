import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), read: vi.fn(), db: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));
vi.mock("@/server/auth", () => ({ getAuth: () => ({ api: { getSession: mocks.session } }) }));
vi.mock("@/server/db", () => ({ getDb: mocks.db }));
vi.mock("@/server/services/profile/http", () => ({ readProfile: mocks.read }));
import { profilePageProps } from "@/server/services/profile/page-data";
beforeEach(() => vi.clearAllMocks());
it("redirects unauthenticated requests before accessing profiles", async () => {
  mocks.session.mockResolvedValue(null);
  await expect(profilePageProps()).rejects.toThrow("redirect:/login");
  expect(mocks.db).not.toHaveBeenCalled();
});
it("loads only the authenticated user's profile", async () => {
  mocks.session.mockResolvedValue({ user: { id: "u1" } });
  mocks.read.mockResolvedValue(null); mocks.db.mockReturnValue("test-db");
  expect(await profilePageProps()).toEqual({ initialProfile: null });
  expect(mocks.read).toHaveBeenCalledWith("test-db", "u1");
});
