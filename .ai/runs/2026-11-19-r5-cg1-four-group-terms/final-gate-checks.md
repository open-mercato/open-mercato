# Final gate — r5-cg1-four-group-terms

**Runner:** local mode. `validation.commands` from `.ai/agentic.config.json`, in order.

| Command | Result |
|---------|--------|
| `yarn build:packages` | ✅ |
| `yarn generate` | ✅ |
| `yarn build:packages` | ✅ |
| `yarn i18n:check-sync` | ✅ |
| `yarn i18n:check-usage` | ✅ |
| `yarn typecheck` | ✅ |
| `yarn test` | ⚠️ 49/51 tasks; only `create-mercato-app#test` failed — its live Codex/Claude agent-harness oracle cases (`OMH-*`, "yarn typecheck must complete within 120000ms"). Known local-only failure, pre-existing on clean checkouts; this PR touches no create-app file. `@open-mercato/core`: 1391 suites passed, 0 failed |
| `yarn build:app` | ✅ |

## Integration suite

- `yarn test:integration:ephemeral TC-CGRP` (ephemeral Docker env via colima): **37 passed (11.3m)**, including the new `TC-CGRP-031` (API: `eur`/`EURO`/`either` → 400, store, read, clear; UI: four fields, missing-currency warning, reload persistence).
- The full cross-module suite (~2,500 tests, ~53 min) was not run locally; only `customer_groups` code and its own tests changed. CI runs the full suite.

## Design-system pass

- New UI uses `Alert status="warning"` and existing CrudForm field types only; no hardcoded colors, arbitrary sizes or `dark:` overrides (manual om-ds-guardian checklist).
