# Final gate — Phases 2-4 on PR #18 (2026-11-02)

Runner: local (no Docker), Node 24, worktree at PR head. Dependencies reinstalled with `yarn install --immutable` after switching to the PR head (the first gate pass failed in packages/documents only because node_modules predated the PR lockfile).

| Command | Result |
|---|---|
| yarn build:packages (x2) / yarn generate | exit 0 |
| yarn i18n:check-sync | exit 0 |
| yarn typecheck | exit 0 |
| yarn build:app | exit 0 |
| yarn i18n:check-usage | NOT RUN — hangs on this machine after "Found 34299 translation keys" (0% CPU, two attempts, one 10-minute wait); new keys checked by script instead |
| yarn test --continue | exit 1 — three failures below; every other suite passed (core 24737 passed, cli 2109 passed) |

## Test failures

1. `packages/cli` module-facts BC guard, "bounded build-time and context budgets" (CPU budget < 90 s): received 130.9 s, 90.6 s and 98.9 s across three full runs with machine load average 11-12 (virus scan, browsers); passes when run alone. Load-sensitive timing, threshold not edited.
2. `packages/core` warranty_claims `quantity.test.ts`: expects "2.5", receives "2,5" — this machine's Polish locale; unrelated to this PR (same family as the known UI format test).
3. `create-mercato-app` `source-link-inventory`: checked-in inventories stale/missing. This PR's diff touches nothing under packages/create-app; not verified against a clean checkout of the base.

## Found and fixed by this gate

- `packages/cli` module-facts BC guard (v1 vs v2 extraction): the test used the catalog bulk-actions slot as its "single-object form" example. Step 5.2 turned that slot into an array, so v1 now sees it. Example switched to the string-form `crud-form:catalog.catalog_product` slot; the guard's intent is unchanged. Commit 2a5597d201.

## Not run

- Integration suite (TC-CAT-043..050): the fixture decision adapter needs NODE_ENV != production; the ephemeral harness always runs production. Written, typechecked, linted, traced by hand only.
- No UI verification in a browser for the review page, bulk actions, settings controls or the on-create switch.
