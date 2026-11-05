export const locales = ["it", "en"] as const;
export type Locale = typeof locales[number];
export const themes = ["cyberpunk", "arasaka-red", "synthwave", "terminal"] as const;
export type Theme = typeof themes[number];
export type UiPreferences = { locale: Locale; theme: Theme };
export const defaultUiPreferences: UiPreferences = { locale: "it", theme: "cyberpunk" };
export const localeCookie = "syncloric.locale";
export const themeCookie = "syncloric.theme";
export function validLocale(value: unknown): value is Locale { return locales.includes(value as Locale); }
export function validTheme(value: unknown): value is Theme { return themes.includes(value as Theme); }
export function normalizeUiPreferences(value?: Partial<{ locale: unknown; theme: unknown }> | null): UiPreferences {
  return { locale: validLocale(value?.locale) ? value.locale : "it", theme: validTheme(value?.theme) ? value.theme : "cyberpunk" };
}
export function intlLocale(locale: Locale) { return locale === "en" ? "en-GB" : "it-IT"; }
