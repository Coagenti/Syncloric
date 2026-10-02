import { it, expect } from "vitest";
import { expect as pw } from "@playwright/test";
import { diaryUrl, withDiaryBrowser } from "./helpers/diary-harness";

it("a later feed run replaces the temporary on-demand result", async () => {
  await withDiaryBrowser(async page => {
    let feedSync = { status: "ok", reason: null as string | null, origin: null as string | null, finishedAt: "2026-09-29T12:00:00Z" };
    await page.route("**/api/v1/**", route => route.fulfill({ json: route.request().url().endsWith("/sync") ? feedSync : { entries: [], sync: feedSync, target: null } }));
    await page.goto(diaryUrl(page));
    await page.getByRole("button", { name: "Sincronizza ora" }).click();
    await pw(page.getByText("Sincronizzazione Norish: completata.", { exact: true })).toBeVisible();
    feedSync = { status: "error", reason: "auth", origin: "https://norish.example.invalid", finishedAt: "2026-09-29T13:00:00Z" };
    await page.getByRole("button", { name: "Giorno successivo" }).click();
    await pw(page.getByRole("alert")).toContainText("Riassocia la tua chiave API");
    await pw(page.getByText("Sincronizzazione Norish: completata.", { exact: true })).toHaveCount(0);
  });
}, 600000);

it("sync on demand shows completed/partial/auth failure and distinguishes busy without a false success", async () => {
  await withDiaryBrowser(async page => {
    let status = 503;
    let sync = { status: "ok", reason: null as string | null, origin: null as string | null };
    const requests: unknown[] = [];
    await page.route("**/api/v1/**", route => {
      if (route.request().url().endsWith("/sync")) {
        requests.push(route.request().postDataJSON());
        return route.fulfill({ status, json: status === 503 ? { error: "Sincronizzazione già in corso." } : sync });
      }
      return route.fulfill({ json: { entries: [], sync: null, target: null } });
    });
    await page.goto(diaryUrl(page));
    const trigger = page.getByRole("button", { name: "Sincronizza ora" });
    await trigger.click({ timeout: 10000 });
    await pw(page.getByRole("status").filter({ hasText: "Sincronizzazione già in corso" })).toBeVisible();
    await pw(page.getByText("Sincronizzazione Norish: completata.", { exact: true })).toHaveCount(0);
    status = 200;
    await trigger.click();
    await pw(page.getByText("Sincronizzazione Norish: completata.", { exact: true })).toBeVisible();
    sync = { status: "partial", reason: null, origin: null };
    await trigger.click();
    await pw(page.getByText("Sincronizzazione Norish: parziale.", { exact: true })).toBeVisible();
    sync = { status: "error", reason: "auth", origin: "https://norish.example.invalid" };
    await trigger.click();
    await pw(page.getByRole("alert")).toContainText("Riassocia la tua chiave API");
    expect(requests).toEqual([{}, {}, {}, {}]);
  });
}, 600000);
