import { it } from "vitest";
import { expect as pw } from "@playwright/test";
import { diaryUrl, withDiaryBrowser } from "./helpers/diary-harness";

it("restores the sync trigger after pending but preserves intentional keyboard focus", async () => {
  await withDiaryBrowser(async page => {
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const status of [200, 503]) {
        for (const moveAway of [false, true]) {
          let release: (() => void) | undefined;
          await page.route("**/api/v1/**", async route => {
            if (route.request().url().endsWith("/sync")) {
              await new Promise<void>(resolve => { release = resolve; });
              return route.fulfill({ status, json: status === 200 ? { status: "ok", reason: null, origin: null } : { error: "Sincronizzazione già in corso." } });
            }
            return route.fulfill({ json: { entries: [], sync: null, target: null } });
          });
          await page.goto(diaryUrl(page));
          const trigger = page.getByRole("button", { name: "Sincronizza ora", exact: true });
          await trigger.focus();
          await page.keyboard.press("Enter");
          await pw(page.getByRole("button", { name: "Sincronizzazione…", exact: true })).toBeDisabled();
          await pw.poll(() => Boolean(release)).toBe(true);
          if (moveAway) {
            await page.keyboard.press("Tab");
            await pw.poll(() => page.evaluate(() => document.activeElement !== document.body)).toBe(true);
            await page.evaluate(() => document.activeElement?.setAttribute("data-sync-focus-away", "true"));
          }
          release?.();
          await pw(trigger).toBeEnabled();
          if (moveAway) await pw(page.locator('[data-sync-focus-away="true"]')).toBeFocused();
          else await pw(trigger).toBeFocused();
          await pw(page.getByRole("status").filter({ hasText: status === 200 ? "Sincronizzazione Norish: completata." : "Sincronizzazione già in corso. Attendi e riprova." })).toBeVisible();
          await page.unroute("**/api/v1/**");
        }
      }
    }
  });
}, 600000);
