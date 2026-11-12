# Issue 9105: literal GeoJSON popup browser coverage

Scope: test-only, no production behavior, catalog files, API or database changes.

## Browser evidence

`BASE_URL=http://127.0.0.1:5001 TMPDIR=/tmp timeout 180 node node_modules/@playwright/test/cli.js test --config=.ai/runs/issue-9105/playwright.config.ts`

Result: **2 passed (12.0s)**, Chromium, against native ephemeral application built from this checkout.

- Create/edit preview (5.1s): persisted HTML-looking feature name, reload, literal text/no supplied markup, ordinary and missing names, repeated layer replacement.
- Statement map (6.4s): API supplier/plot/statement/evidence fixtures, persisted geometry/reload, HTML-looking/ordinary/missing names.
- Cleanup attempts every fixture deletion in reverse dependency order and fails on any unsuccessful deletion; both cleanups passed.
- Observed UI selectors confirmed through browser exploration: Paste JSON, Paste GeoJSON geometry, Leaflet interactive paths and popup content.
- Screenshots: create-literal-popup.png, edit-literal-popup.png, statement-literal-popup.png in task artifacts; copied to cockpit Assets as eudr-{create,edit,statement}-popup.png.

The ordinary managed repository runner subsequently passed both scenarios as well: **2 passed (2.2m)**, 3.2s create/edit and 3.4s statement execution. The preceding delay was cold Playwright config/discovery latency. The focused config is retained only to reproduce the diagnostic fallback; the normal integration config was not changed.

## Validation (runner: local)

| Command | Result |
| --- | --- |
| `timeout 180 yarn install --immutable` | Passed, optional native build warnings |
| `timeout 300 yarn build:packages` | Passed, 42 tasks |
| `timeout 120 yarn generate` | Passed |
| `timeout 300 yarn build:packages` (after generate) | Passed, 42 tasks |
| `TMPDIR=/tmp timeout 120 yarn i18n:check-sync` | Passed |
| `TMPDIR=/tmp timeout 120 yarn i18n:check-usage` | Passed, 8121 unused keys advisory |
| `TMPDIR=/tmp timeout 180 yarn typecheck` | Passed, 42 tasks |
| `TMPDIR=/tmp timeout 300 yarn test` | Failed: shared dynamicLoader.generatedCacheRecovery child tsx process inherited cockpit long socket path; 40 tasks passed, 50 total |
| `TMPDIR=/tmp timeout 45 yarn workspace @open-mercato/shared jest src/lib/bootstrap/__tests__/dynamicLoader.generatedCacheRecovery.test.ts --runInBand` | Passed, 2 tests |
| `TMPDIR=/tmp TURBO_ENV_MODE=loose timeout 300 yarn test` | Running retry to pass short TMPDIR through Turbo |
| `TMPDIR=/tmp timeout 300 yarn test:integration:ephemeral TC-EUDR-020` | App initialized/generated/rebuilt; app build passed in 136s, readiness passed; timed out during Playwright startup/discovery before tests |
| Same managed integration command, warm environment | Passed, 2 tests (2.2m), 0 skipped/flaky/unexpected |
| `timeout 60 yarn playwright test --config=.ai/qa/tests/playwright.config.ts TC-EUDR-020 --list` | Timed out without output; longer 120s attempt also timed out |
| Focused Playwright command above | Passed, 2 tests |
| `git diff --check` | Passed |

Initial ephemeral bootstrap before the ordered generate/rebuild failed on missing generated dist registry. Subsequent native initialization and app build succeeded. A separate `yarn build:app` attempt was stopped before completion to avoid concurrent builds; the native managed runner subsequently completed the app build.

## Review

Static review: confined to EUDR browser spec and task run artifacts; no runtime contracts changed, no `any`, fixtures scoped via standard authenticated API helpers, no business seed data dependency. Cleanup was strengthened to attempt all records even if one deletion fails.

Ordinary repository browser coverage is verified. Complete unit-gate retry and CI/review results are still pending. No `qa-approved` label is authorized or applied. This test-only change qualifies for `skip-qa`; screenshots show browser evidence, not manual QA approval.
