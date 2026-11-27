# Final gate — 2026-11-20-r5-as1-scaffold-settings

Runner: local mode (no compose `app` container for this worktree). Postgres via the local instance; integration via the ephemeral harness.

## Validation commands

| Command | Result |
|---|---|
| `yarn build:packages` | pass (42/42) — run before and after `generate` |
| `yarn generate` | pass; no committed generated file changed |
| `yarn i18n:check-sync` | pass — "All translation files are in sync" |
| `yarn i18n:check-usage` | pass (exit 0); no missing keys; unused keys are advisory |
| `yarn typecheck` | pass |
| `yarn template:sync` | pass — app and template in sync |
| `yarn test` | 49/51 tasks green. `core`: the one assertion failure (`command-interceptor-http-coverage` flagging the new route) fixed in Step 3.3 and re-run green; `forms/nps-opinion-fields` hit a jest-worker SIGSEGV and passes in isolation (5/5). `create-mercato-app`: the known local harness failures below |
| `yarn build:app` | pass — production build compiled inside the ephemeral integration run (`Compiled successfully in 45s`) |

## Targeted tests (from the brief's gate)

- `packages/core`: `src/modules/assisted_selling` (setup, validators, settings lib, command, route), `ecommerce/lib/__tests__/storeContextService.test.ts`, `auth/__tests__/acl-feature-catalog.i18n.test.ts`, `src/__tests__/module-decoupling.test.ts` → **8 suites, 85 tests passed**.
- `packages/cli` `module-facts.bc-guard.test.ts` → **338 passed**; no module-facts cap raised.
- `yarn workspace create-mercato-app test` → 1172 pass / 81 fail. All 81 failures are in the four live-adapter harness files known to fail locally (`agent-harness-evaluator`, `agent-harness-release`, `business-writable-oracles`, `writable-ast-oracles`). Baseline on `pr/9997` in a clean worktree: 1169 pass / **84 fail** in the same files (plus 3 env-related `module-activation-fixtures`). No regression.

## Integration

- `yarn test:integration:ephemeral TC-ASSIST-001` → **3 passed (3.6m)**. The trailing "server exited with code 143" is the harness stopping its own server at teardown.
- Full integration suite not run locally (hours on this host); CI runs it. The change adds API surface only, covered by TC-ASSIST-001.

## Design-system pass

Skipped — no UI file touched (API-only step; the settings page is AS7, #10039).
