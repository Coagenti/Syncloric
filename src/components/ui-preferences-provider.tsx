"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { defaultUiPreferences, intlLocale, localeCookie, normalizeUiPreferences, themeCookie, validLocale, validTheme, type UiPreferences } from "@/lib/ui-preferences";
import { translate, type TranslationValues } from "@/lib/i18n/translate";

type PreferenceContext = UiPreferences & { loading: boolean; saving: boolean; error: string | null; update: (value: Partial<UiPreferences>) => Promise<boolean> };
const Preferences = createContext<PreferenceContext>({ ...defaultUiPreferences, loading: false, saving: false, error: null, update: async () => false });
const backgrounds = { cyberpunk: "#090d14", "arasaka-red": "#0b090b", synthwave: "#110d1c", terminal: "#08110d" };
function apply(preferences: UiPreferences) {
  document.documentElement.lang = preferences.locale;
  document.documentElement.dataset.theme = preferences.theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", backgrounds[preferences.theme]);
  const flags = `; Path=/; SameSite=Lax; Max-Age=31536000${location.protocol === "https:" ? "; Secure" : ""}`;
  document.cookie = `${localeCookie}=${preferences.locale}${flags}`;
  document.cookie = `${themeCookie}=${preferences.theme}${flags}`;
}
export function UiPreferencesProvider({ initial = defaultUiPreferences, children }: { initial?: UiPreferences; children: ReactNode }) {
  const [preferences, setPreferences] = useState(initial);
  const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false); const [error, setError] = useState<string | null>(null);
  const current = useRef(initial); const generation = useRef(0); const busy = useRef(false);
  const saveRequest = useRef<AbortController | null>(null);
  useEffect(() => { current.current = preferences; apply(preferences); }, [preferences]);
  useEffect(() => {
    let request: AbortController;
    const refresh = async () => {
      request?.abort(); const controller = new AbortController(); request = controller; const version = generation.current;
      try {
        const response = await fetch("/api/v1/account/preferences", { cache: "no-store", credentials: "same-origin", signal: controller.signal });
        if (!response.ok) return;
        const data = await response.json();
        if (!controller.signal.aborted && generation.current === version && validLocale(data?.preferences?.locale) && validTheme(data?.preferences?.theme)) {
          const value = normalizeUiPreferences(data.preferences); current.current = value; setPreferences(value);
        }
      } catch { /* Keep the last known appearance when offline. */ }
      finally { if (!controller.signal.aborted) setLoading(false); }
    };
    const changed = () => { void refresh(); };
    const storage = (event: StorageEvent) => { if (event.key === "syncloric.ui-preferences.changed") void refresh(); };
    void refresh(); window.addEventListener("syncloric:account-updated", changed); window.addEventListener("storage", storage);
    return () => { request?.abort(); saveRequest.current?.abort(); window.removeEventListener("syncloric:account-updated", changed); window.removeEventListener("storage", storage); };
  }, []);
  const update = useCallback(async (value: Partial<UiPreferences>) => {
    if (busy.current) return false;
    busy.current = true; generation.current++; setSaving(true); setError(null);
    const before = current.current; const next = normalizeUiPreferences({ ...before, ...value });
    current.current = next; setPreferences(next);
    const controller = new AbortController(); saveRequest.current = controller;
    try {
      const response = await fetch("/api/v1/account/preferences", { method: "PATCH", cache: "no-store", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value), signal: controller.signal });
      if (!response.ok) throw new Error(response.status === 401 ? "Accedi per salvare le preferenze." : "Impossibile salvare le preferenze. Riprova.");
      const data = await response.json();
      if (!validLocale(data?.preferences?.locale) || !validTheme(data?.preferences?.theme)) throw new Error("Impossibile salvare le preferenze. Riprova.");
      const saved = normalizeUiPreferences(data.preferences); current.current = saved; setPreferences(saved);
      try { localStorage.setItem("syncloric.ui-preferences.changed", String(Date.now())); } catch { /* Cookies and DB remain authoritative. */ }
      return true;
    } catch (failure) {
      if (!controller.signal.aborted) { current.current = before; setPreferences(before); setError(failure instanceof Error ? failure.message : "Impossibile salvare le preferenze. Riprova."); }
      return false;
    } finally { if (!controller.signal.aborted) { busy.current = false; setSaving(false); } }
  }, []);
  const value = useMemo(() => ({ ...preferences, loading, saving, error, update }), [preferences, loading, saving, error, update]);
  return <Preferences.Provider value={value}>{children}</Preferences.Provider>;
}
export function useUiPreferences() { return useContext(Preferences); }
export function useI18n() {
  const { locale } = useUiPreferences();
  return useMemo(() => ({
    locale,
    tr: (message: string, values?: TranslationValues) => translate(locale, message, values),
    formatNumber: (value: number, options?: Intl.NumberFormatOptions) => new Intl.NumberFormat(intlLocale(locale), options).format(value),
    formatDay: (date: string, options: Intl.DateTimeFormatOptions = { weekday: "long", day: "numeric", month: "long" }) => new Intl.DateTimeFormat(intlLocale(locale), { timeZone: "UTC", ...options }).format(new Date(`${date}T12:00:00Z`)),
    formatTimestamp: (date: string | Date, options?: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(intlLocale(locale), options).format(new Date(date)),
  }), [locale]);
}
