# Final gate — 2026-11-24-pluggable-cache-providers

Runner: local mode (no compose `app` container), `TMPDIR=/tmp`, `NODE_OPTIONS=--max-old-space-size=12288`. Date: 2026-11-24.

## validation.commands (run after all planned Steps, before review fixes)
- `yarn build:packages` → exit 0
- `yarn generate` → exit 0
- `yarn build:packages` → exit 0
- `yarn i18n:check-sync` → exit 0
- `yarn i18n:check-usage` → exit 0
- `yarn typecheck` → exit 0
- `yarn test` → exit 1 — only `@open-mercato/shared` (`dynamicLoader.generatedCacheRecovery.test.ts`, `listen EINVAL`: turbo drops `TMPDIR`, tsx IPC socket path exceeds the Unix socket limit). Direct `TMPDIR=/tmp npx jest` in `packages/shared`: 3597 passed, 0 failed.
- `yarn build:app` → exit 0

## After review fixes (3.1–3.8)
- `yarn build:packages` + `yarn generate` → exit 0.
- `yarn test --continue`: every package green except the same environment-only shared case; ten packages that first failed with `Cannot find module @open-mercato/cache/redisConnection` (stale local `dist` while the integration app was running) re-ran green after the rebuild (10/10 tasks).
- Scoped `npx tsc --noEmit` for cache, core, shared, cli: clean.

## Integration suite (`yarn test:integration:ephemeral`, 3858 tests)
- Full run reached ~3165 tests before the 2 h runner limit; the 208 unreached spec files plus the 8 spec files that failed were re-run (400 tests, 215 files): 387 passed, 1 flaky (passed on retry), 8 skipped, 6 failed.
- The 6 remaining failures (TC-START-001 ×2, TC-CRM-5629, TC-DOCUMENTS-009, TC-DOCUMENTS-013, TC-ONBOARDING-EMAIL-001) fail identically on a clean `origin/main` worktree in the same environment (6 failed / 4 passed) → pre-existing/environmental, not regressions.
- TC-CRM-007, TC-CUSTOMERS-SEED-001, TC-ECOM-013, TC-PGWY-025, TC-STAFF-SUP-010, TC-TRANS-005 failed under load in the first run and passed on the targeted re-run.
- New spec TC-CONF-007 (readiness + cache admin under provider extension) passes under stock and provider configurations (checkpoint 1).

## Design-system pass
No `.tsx`/UI package files changed; system-status rows reuse the existing row component and i18n keys (all five locales).
