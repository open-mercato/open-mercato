# Final gate — 2026-11-24-managed-cloud-cache-providers

Runner: local mode (no compose `app` container), `TMPDIR=/tmp`, `NODE_OPTIONS=--max-old-space-size=12288`. Date: 2026-11-24.

## validation.commands
- `yarn build:packages` → exit 0
- `yarn generate` → exit 0
- `yarn build:packages` → exit 0
- `yarn i18n:check-sync` → exit 0
- `yarn i18n:check-usage` → exit 0
- `yarn typecheck` → exit 0
- `yarn test --continue` → exit 1
- `yarn build:app` → exit 0

`yarn test` was rerun with `--continue` so every package executed: Tasks:    61 successful, 62 total. The single failing task, `@open-mercato/shared#test`, fails only in `dynamicLoader.generatedCacheRecovery.test.ts` with `listen EINVAL` because turbo does not pass `TMPDIR` and tsx's IPC socket path under the cezar temp dir exceeds the Unix socket length limit. Run directly with `TMPDIR=/tmp npx jest` in `packages/shared`: 3597 passed, 35 skipped, 0 failed. The other "FAIL source-link-inventory" lines are expected output of passing negative tests in create-mercato-app.

## Real-engine verification (Testcontainers, sequential, manual run)
See the package READMEs/EVIDENCE.md and checkpoint records. All container suites pass after the review fixes.

## Integration suite
No UI, route, or app-module change in this PR beyond the stacked base (#10513, whose integration run is recorded there). The packages are opt-in and not installed by the app; the integration suite is therefore not re-run here.

## Design-system pass
Not applicable — no UI files touched.

## After review fixes
The full gate above ran before the review-fix steps. The review-fix commits touch only the provider packages; for every touched package `yarn test`, `npx tsc --noEmit` (src + tests) and the full sequential Testcontainers suites were re-run green afterwards (see the review-fix rows in PLAN.md and the PR summary comment).
