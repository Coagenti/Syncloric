# Calendar accessibility (feed UI)

The adjacent-month cells remain active date-navigation buttons. Do not mute the
whole button with opacity: it composites both the date and the import count into
the panel background and reduces normal-text contrast below WCAG AA (4.5:1).
Use the approved dedicated date/import colors instead, before the hover and
selected border rules in the cascade. Keep the global cyan focus-visible outline.

## Browser regression

`tests/e2e/contrast.spec.ts` runs in the Vitest browser harness (driver Vitest,
Chromium reale, bundle esbuild del componente di produzione; stesso pattern di
`tests/e2e/auth.spec.ts`) at desktop and mobile widths and freezes the local
date to 2026-09-29 via a `Date` shim. The harness server answers
GET `/api/v1/diary?month=...` with synthetic entries (including an
adjacent-month import), so no login, database, Next build, Norish service,
private data, or real credential is needed. This fixture tests UI rendering
only; it is not an API-contract test.

The regression computes WCAG relative luminance from actual computed colors,
compositing backgrounds and ancestor opacity. It verifies normal text >=4.5:1,
distinguishable outside dates, import counts, visible keyboard focus, cyan hover,
yellow selection, and keyboard activation into the adjacent month. Gradients in
the measured ancestry explicitly fail rather than silently assuming a surface.
Since PR #22 the calendar page requires a session, so the file no longer uses
the Playwright Next-server setup (public `/calendar`); it is included in the
standard Vitest e2e suite instead.

PR #11's demo dialog focus tests are not ported here: the feed UI removed the demo
write dialog. Its replacement and focus restoration belong to t_ef7dd54d (M2).
This card preserves calendar focus checks without editing either shared UI file.

## Contribution provenance

Implementation and regression authored with AI assistance. Human contribution:
the Technical Lead specified the palette, cascade, scope and acceptance criteria;
the operator authorized model equivalence. Human technical and brand review remain
in the downstream review lane; no approval or merge is implied by this document.
