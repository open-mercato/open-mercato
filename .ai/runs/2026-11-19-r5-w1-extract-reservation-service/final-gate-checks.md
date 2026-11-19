# Final gate — R5 W1

**Date:** 2026-11-19
**Runner:** local mode (no compose `app` container; colima used only for testcontainers and the ephemeral Postgres)

## `validation.commands` (+ `yarn lint`)

| Command | Result |
|---------|--------|
| `yarn build:packages` | exit 0 |
| `yarn generate` | exit 0 |
| `yarn build:packages` | exit 0 |
| `yarn i18n:check-sync` | exit 0 |
| `yarn i18n:check-usage` | exit 0 |
| `yarn typecheck` | exit 0 |
| `yarn lint` | exit 0 |
| `yarn test` | exit 1: 50/51 turbo tasks passed, including `@open-mercato/core#test`. The only failure is `create-mercato-app#test`, in its agent-harness oracle suites (`writable-ast-oracles`, `agent-harness-*`), which shell out to the live `codex`/`claude` CLIs. That is a known local-only failure, and this branch changes nothing under `packages/create-app`. |
| `yarn build:app` | exit 0 |

## Integration suites

- Playwright through `yarn test:integration:ephemeral 'TC-WMS-0(02|21|27)'`: **8 passed (3.5m)** — TC-WMS-002 (insufficient-stock 409), TC-WMS-021 (concurrent reservation locking), TC-WMS-027 (ledger integrity, 6 cases). The first attempt lost the race for port 5001 to a sibling worktree (`EADDRINUSE`). The harness rebuilt its own environment and the rerun passed.
- Real Postgres: `OM_PG_INTEGRATION=1 jest wmsReservationService.integration.test.ts` — 3 passed; `jest --listTests` with the `test:pg-integration` pattern selects the suite.
- Full `yarn test:integration`: not run. The change is a server-side move with no UI. The three suites the spec names for W1 ran, and CI's `ephemeral-integration` job runs the rest.

## Design-system pass

Skipped. No UI file is touched.
