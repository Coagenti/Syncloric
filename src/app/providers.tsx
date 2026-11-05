"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider } from "react-aria-components";
import { useState } from "react";
import { UiPreferencesProvider, useUiPreferences } from "@/components/ui-preferences-provider";
import { intlLocale, type UiPreferences } from "@/lib/ui-preferences";

/**
 * Provider client: TanStack Query 5 (cache/stato server, § 2) + I18nProvider
 * di react-aria-components (base HeroUI v3 — nessun provider globale esportato
 * da @heroui/react 3.x; il theming passa dal CSS, vedi globals.css).
 * I provider server-only (auth, DB) NON stanno qui: il confine è il modulo (§ 3).
 */
export function Providers({ children, initialPreferences }: { children: React.ReactNode; initialPreferences?: UiPreferences }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: 1,
          },
        },
      }),
  );

  return (
    <UiPreferencesProvider initial={initialPreferences}><AriaLocale>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </AriaLocale></UiPreferencesProvider>
  );
}
function AriaLocale({ children }: { children: React.ReactNode }) {
  const { locale } = useUiPreferences();
  return <I18nProvider locale={intlLocale(locale)}>{children}</I18nProvider>;
}
