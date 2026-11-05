# Issue #8825 — scoped verification blocker

Issue: https://github.com/open-mercato/open-mercato/issues/8825
Fork revision: ada24d305c3cfee633c3081c5f55e334330e6b87
Runner: local, Node 24.22.2, Yarn 4.18.1. Docker restored (29.9.2).

The original environment clean stop was resumed. Immutable dependency installation, module generation and package builds now succeed. Concurrency was rechecked before claiming: no other assignee/claim or PR referencing #8825. The original #7907 source fix is still open, so its authored commit 7b69580c19c4ddc91e56545ed05c58b6602e59e5 was reused as d86055c161, preserving Oskar Wojciechowski's authorship.

## Candidate coverage

`candidate-TC-WF-073.spec.ts.txt` preserves the draft outside test discovery because app verification is blocked. It contains four EN/PL × Control/Meta cases, each creating four independent definitions and executor-started instances via API (selected/control failed and paused), with synchronous missing-function failure and WAIT_FOR_SIGNAL parking. Assertions cover exact selected identifier, no raw token, Cancel/Escape full API-record equality and no action request, selected keyboard request plus unchanged controls, 100-character identifiers at 390px, screenshots, and transaction-based fixture cleanup in finally. This is a draft, not browser-verified coverage. Do not infer a pass from its presence.

## Actual validation

| Command | Result |
|---|---|
| `mise exec node@24.22.2 -- yarn install --immutable` | Passed with optional cpu-features build warning. |
| `mise exec node@24.22.2 -- yarn build:packages` | Passed: 42 tasks. |
| `mise exec node@24.22.2 -- yarn generate` | Passed. |
| `mise exec node@24.22.2 -- yarn build:packages` | Passed: 42 tasks after generation. |
| `TMPDIR=/tmp mise exec node@24.22.2 -- yarn i18n:check-sync` | Passed. Initial long TMPDIR attempt hit macOS tsx socket EINVAL; corrected environment. |
| `TMPDIR=/tmp mise exec node@24.22.2 -- yarn i18n:check-usage` | Passed; advisory unused keys. |
| `TMPDIR=/tmp mise exec node@24.22.2 -- yarn typecheck` | Failed: duplicate getTelemetryRuntime imports in warranty_claims/backend/warranty_claims/[id]/page.tsx:9 and :13, also present at fork revision. |
| `TMPDIR=/tmp mise exec node@24.22.2 -- yarn test` | Failed: shared dynamicLoader.generatedCacheRecovery tests hit long-TMPDIR tsx socket EINVAL in Turbo subprocesses; shared summary 257 passed suites, 1 failed, 5 skipped; 3188 passed tests, 2 failed, 18 skipped. Other packages aborted by Turbo. |
| `TMPDIR=/tmp mise exec node@24.22.2 -- yarn build:app` | Compiled successfully, then failed on the same warranty_claims duplicate imports. |
| `TMPDIR=/tmp mise exec node@24.22.2 -- yarn jest --config packages/core/jest.config.cjs packages/core/src/modules/workflows/backend/instances/__tests__/page.confirmDialogs.test.tsx --runInBand` | Passed: 3/3 tests. Initial root-config invocation failed TS5011; corrected to authoritative core config. |
| `mise exec node@24.22.2 -- yarn mercato test:integration TC-WF-073` | Failed before Playwright launch during app build; no browser assertions executed. First attempt additionally needed generated entity registries; build/generate/build resolved that prerequisite. |

## Failure ownership and disposition

The app cannot be provisioned by the mandatory managed integration runner while the warranty_claims TypeScript error exists. Its source is outside the explicit workflows-only task order. No other module or shared production code was edited and no validation gate was bypassed. Parent notified with the exact prerequisite. No passing browser evidence, completed review, or QA signoff can be claimed. No PR published because the implementer gate remains blocked; no qa-approved label applied.

Resume after the warranty_claims prerequisite is corrected: restore the candidate spec into the module's __integration__ directory if archived, run through `yarn mercato test:integration TC-WF-073`, fix any discovered test issues, then complete validation, PR publication, review and screenshot QA. Keep #7907 credited and avoid duplicating its source fix when it has merged.

Additional diagnostics: Playwright `--list` discovered all four intended cases successfully (syntax/discovery only); direct shared Jest invocation with TMPDIR=/tmp passed both dynamic-loader tests (2/2), identifying the broad-test failure as Turbo subprocess environment handling rather than a demonstrated shared product defect. Exact commands: `TMPDIR=/tmp mise exec node@24.22.2 -- yarn playwright test --config=.ai/qa/tests/playwright.config.ts TC-WF-073 --list`; `TMPDIR=/tmp mise exec node@24.22.2 -- yarn jest --config packages/shared/jest.config.cjs packages/shared/src/lib/bootstrap/__tests__/dynamicLoader.generatedCacheRecovery.test.ts --runInBand`.
