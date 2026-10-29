# Checkpoint 1 — Steps 1.1..2.2

- **Steps covered:** 1.1 (`7bcbf9d0f`), 1.2 (`68caa78ff`), 2.1 (`0913bbe3a`), 2.2 (`f77228974`); range `0fff7fac1..f77228974`
- **Touched areas:** `packages/shared/src/lib/db` (lock helper, transient matcher, real-Postgres suite), `packages/shared/package.json`, `packages/shared/AGENTS.md`, `.github/workflows/ci.yml` (one step in `documents-multi-instance`), `yarn.lock`, `packages/core/src/modules/integrations/lib/oauth` (protocol helpers, descriptor, fake authorization server), `packages/core/src/helpers/integration/oauthGrantFixtures.ts`
- **Runner:** local (no compose `app` container)
- **Why now:** planned pause before Step 3.1 until App Spec Q3 has a signal

| Check | Result |
|---|---|
| `yarn build:packages` | ✅ pass |
| `yarn workspace @open-mercato/shared typecheck` | ✅ pass |
| `yarn workspace @open-mercato/core typecheck` | ✅ pass |
| `yarn workspace @open-mercato/shared test src/lib/db` | ✅ 143 passed, 7 skipped (the gated real-Postgres suite) |
| `yarn workspace @open-mercato/core test src/modules/integrations src/helpers/integration` | ✅ 34 suites, 341 tests passed |
| `yarn workspace @open-mercato/shared test:pg-integration` (A1, `postgres:16` via testcontainers) | ✅ 7 passed |
| eslint on every changed `.ts` file | ✅ clean |
| `yarn agents:check-budget` | ✅ pass (no new chain over budget) |
| i18n checks | ⏭️ skipped: no locale file or user-facing string changed |
| UI verification | ⏭️ skipped: no UI touched before Step 5.1 |

Acceptance criteria covered so far: A1, A2 (shared); A3, A4, A5, A6 (integrations).
