import { test, expect, type Locator } from "@playwright/test";
import type { DiaryEntry } from "../../src/lib/diary";

// UI fixture only: include an adjacent-month import to exercise its small label.
const entries: DiaryEntry[] = ["2026-09-29", "2026-08-31"].map((date, index) => ({
  id: `contrast-fixture-${index}`, date, slot: "Lunch", entryType: "recipe",
  name: "Pasto fixture contrasto", quantityGrams: null, servings: 1,
  kcal: 420, protein: null, fat: null, carbs: null,
  source: "norish_sync", norishDeleted: false,
}));

async function measureText(text: Locator) {
  return text.evaluate((element) => {
    const parse = (color: string) => {
      const parts = color.match(/[\d.]+/g);
      if (!parts) throw new Error(`Unsupported computed color: ${color}`);
      const [r, g, b, a = 1] = parts.map(Number);
      return { rgb: [r, g, b], alpha: a };
    };
    const blend = (front: number[], back: number[], alpha: number) =>
      front.map((channel, i) => channel * alpha + back[i] * (1 - alpha));
    const luminance = (rgb: number[]) => {
      const [r, g, b] = rgb.map((channel) => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    // Composite computed backgrounds/opacity from the root towards the text.
    // Keep the painted text pixel separate from its surrounding background.
    const chain: Element[] = [];
    for (let node: Element | null = element; node; node = node.parentElement) chain.unshift(node);
    const paint = (index: number, includeText: boolean, backdrop: number[]): number[] => {
      const style = getComputedStyle(chain[index]);
      if (style.backgroundImage !== "none") throw new Error("Gradient needs pixel sampling");
      const color = parse(style.backgroundColor);
      let pixel = blend(color.rgb, backdrop, color.alpha);
      if (index + 1 < chain.length) pixel = paint(index + 1, includeText, pixel);
      else if (includeText) {
        const foreground = parse(style.color);
        pixel = blend(foreground.rgb, pixel, foreground.alpha);
      }
      return blend(pixel, backdrop, Number(style.opacity));
    };
    const foreground = paint(0, true, [255, 255, 255]);
    const background = paint(0, false, [255, 255, 255]);
    const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
    return { ratio: (light + 0.05) / (dark + 0.05), color: getComputedStyle(element).color };
  });
}

for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
  test(`feed calendar outside-month text meets AA and retains interaction at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.clock.setFixedTime(new Date("2026-09-29T12:00:00"));
    await page.route("**/api/v1/diary?month=*", async (route) => {
      expect(route.request().method()).toBe("GET");
      await route.fulfill({ json: { entries, target: null, sync: { state: "never", lastSuccessAt: null } } });
    });
    await page.goto("/calendar");
    await expect(page.getByLabel("Seleziona data")).toHaveValue("2026-09-29");
    await expect(page.getByRole("heading", { name: "settembre 2026" })).toBeVisible();
    const outside = page.locator(".calendar-day.outside").first();
    await expect(outside).toBeEnabled();
    await expect(outside.locator("small")).toHaveText("1 norish");
    const insideText = page.locator(".calendar-day:not(.outside):not(.selected) > span").first();
    const inside = await measureText(insideText);
    const day = await measureText(outside.locator("span"));
    const label = await measureText(outside.locator("small"));
    console.info(JSON.stringify({ viewport: viewport.width, inside, outside: day, importLabel: label }));
    expect(day.ratio).toBeGreaterThanOrEqual(4.5);
    expect(label.ratio).toBeGreaterThanOrEqual(4.5);
    expect(inside.ratio).toBeGreaterThanOrEqual(4.5);
    expect(day.color).not.toBe(inside.color);
    await expect(outside).toHaveCSS("opacity", "1");

    await outside.focus();
    await expect(outside).toBeFocused();
    await expect(outside).toHaveCSS("outline-color", "rgb(0, 240, 255)");
    await expect(outside).toHaveCSS("outline-style", "solid");
    await expect(outside).toHaveCSS("outline-width", "3px");
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(outside).toBeFocused();
    await page.screenshot({ path: test.info().outputPath(`calendar-${viewport.width}.png`), fullPage: true });
    expect((await measureText(outside.locator("span"))).ratio).toBeGreaterThanOrEqual(4.5);
    await outside.hover();
    await expect(outside).toHaveCSS("border-top-color", "rgb(0, 240, 255)");
    expect((await measureText(outside.locator("small"))).ratio).toBeGreaterThanOrEqual(4.5);
    const selected = page.locator(".calendar-day:not(.outside)").filter({ hasText: /^1$/ });
    await selected.click();
    await expect(page.getByLabel("Seleziona data")).toHaveValue("2026-09-01");
    const selectedDay = page.locator(".calendar-day.selected");
    await expect(selectedDay).toHaveAttribute("aria-pressed", "true");
    await expect(selectedDay).toHaveCSS("border-top-color", "rgb(252, 238, 10)");
    expect((await measureText(selectedDay.locator("span"))).ratio).toBeGreaterThanOrEqual(4.5);
    // Outside cells are active: keyboard activation navigates to the adjacent month.
    await page.locator(".calendar-day.outside").first().focus();
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("Seleziona data")).toHaveValue("2026-08-31");
    await expect(page.getByRole("heading", { name: "agosto 2026" })).toBeVisible();
  });
}
