# Checkpoint 1 — Steps 1.1–2.1 (Phase 1 closed)

**Runner:** local mode (no compose `app` container running).

| Check | Command | Result |
|-------|---------|--------|
| Cart unit tests | `npx jest --config jest.config.cjs src/modules/cart` (packages/core) | 22 suites passed, 1 skipped (pg-gated); 292 passed, 11 skipped |
| Lock helper | `…/lib/__tests__/lineMutationLock*` | 15 passed |
| Lines | `…/commands/__tests__/lines.test.ts` | 57 passed |
| Lock | `…/commands/__tests__/lock.test.ts` | 14 passed |
| Merge | `…/commands/__tests__/merge.test.ts` | 28 passed |
| Cart PostgreSQL suites | `OM_PG_INTEGRATION=1 jest --runInBand 'src/modules/cart/.+\.integration\.test\.ts$'` (colima, testcontainers) | 2 suites, 19 passed (statusTransitionRaces 8, promotionContext 11) |
| pg-integration selection | `yarn test:pg-integration --listTests` | lists both cart suites |
| Core typecheck | `yarn generate` then `npx tsc --noEmit` (packages/core) | clean |
| Repo-wide guards | `explicit-sort-comparators`, `optimistic-lock-command-coverage`, `record-locks-coverage` | 15 passed |

UI: not touched — no browser checks or screenshots.
