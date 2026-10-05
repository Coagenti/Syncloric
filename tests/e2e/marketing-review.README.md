# Sync keyboard focus regression (Marketing M1)

Source: `review/tests/e2e/marketing-review.spec.ts` in the evidence archive for
`t_9dacece5`. `review/` was the review checkout directory; the integration path
inside the repository is `tests/e2e/marketing-review.spec.ts`, next to the existing
`helpers/diary-harness.ts`. Original `evidence/independent-sync.json` reported
BODY focus for all six 200/503 × 320/390/1440 combinations.

## Execution

Install locked dependencies and Chromium as required by the existing harness.
Build production CSS first; the test intentionally refuses a CSS-free run:

    pnpm exec next build --webpack
    DIARY_VISUAL_CSS=1 pnpm exec vitest run --config vitest.e2e.config.ts tests/e2e/marketing-review.spec.ts --maxWorkers=1

This file uses Vitest `it`, not the Playwright test runner. The existing harness
bundles the real CalorieApp with esbuild, serves it locally, and launches headless
Chromium. The CSS loader reads production styles from `.next/static` with both
Webpack and Turbopack layouts supported.
Do not place the file in `review/` inside the repo: the existing config discovers
`tests/e2e/**/*.spec.ts` and the helper import is relative to that directory.

## Contract / matrix

36 independently reported cases: widths 320, 390, 1440 × outcomes HTTP200,
HTTP503 already-in-progress, HTTP401, transport failure × three behaviors:

- Focus the sync CTA, activate with Enter, hold POST pending, assert busy/disabled
  CTA and pending status, release, assert CTA enabled and exact
  `document.activeElement === CTA` identity.
- While pending press real Tab. Capture the actual destination DOM element (not
  BODY), then check that exact element retains activeElement after completion
  and two render frames. CTA must not steal it for any outcome.
- Independently assert exact localized outcome text, visible nonempty geometry,
  minimum 12px computed font, text range fitting the viewport, and screen-reader
  exposure through live-region/status/alert semantics with no aria-hidden/inert
  ancestor. HTTP401 also exposes the visible login link.

Transport is intercepted, including the feed refresh after HTTP200. Requests are
released by explicit promise gates, not sleeps. Assertions also verify exactly
one POST per keyboard activation. Separate feedback/no-steal tests still run
when restore fails, so the RED report distinguishes the missing focus behavior
from setup failures and other accessibility contracts.

## Integrated GREEN / CI execution

Integration task `t_cb34a3c6` applies these tests above the published focus fix
`9a3c71ae112e8ca2b476950f9cf96ec65ce05d93` on the existing PR32 branch.
CI builds with `pnpm exec next build --webpack` before browser regression:
the harness reads `.next/static/css`, while the default Turbopack build uses
another output layout. The browser step sets `DIARY_VISUAL_CSS=1`, running
these mandatory-CSS tests and the existing opt-in dialog layout/focus tests.
No application/auth code, palette, or copy is changed by this integration.

The full local regression command (serial workers for this shared sandbox) is:

    DIARY_VISUAL_CSS=1 DIARY_EVIDENCE_DIR=../integration-evidence pnpm exec vitest run --config vitest.e2e.config.ts --maxWorkers=1 --testTimeout=180000 --hookTimeout=600000

Results, exact final head and CI links are recorded on `t_cb34a3c6`; downstream
Marketing approval remains `t_3f51b03e`, then the TL gate. The baseline RED
provenance below describes the earlier test-authoring phase, not the final head.

## Delivery and limits

This is an intentionally test-only TDD delivery on baseline
`e1d43851bc267d4ea4d6f5dd88dcd3d160cc84b0`. No changes to CalorieApp, auth, palette,
copy, build configuration, or production code; no push. Restore tests are
expected RED before the parallel focus fix. Integration task `t_cb34a3c6` applies
this patch above the published fix and performs the full green/CI gate; Marketing
review is already scheduled in `t_3f51b03e`.

Local baseline run uses compiled CSS copied from the existing successful build
in `t_c70cab8a/syncloric`, whose Git HEAD was verified as the same baseline SHA.
A fresh build and full regression remain responsibilities of the integration
phase, not a claim of this test-only RED phase.

This checks Chromium accessibility semantics, not a hardware screen-reader
session or a complete WCAG certification. No upstream Norish/auth network service
is exercised. Generated with AI by the developer agent; requirements and test
contracts provided by the human-governed Technical Lead/Marketing workflow.
Human review/approval remains pending in the pre-created downstream review cards.
