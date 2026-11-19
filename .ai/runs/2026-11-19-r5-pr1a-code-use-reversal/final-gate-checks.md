# Final gate — 2026-11-19 r5-pr1a-code-use-reversal

**Runner:** local mode (no compose `app` container running). Fresh `yarn install --immutable` in the worktree.
**Head:** `1b8b8fe45d`

## `validation.commands`

| Command | Result |
|---------|--------|
| `yarn build:packages` | pass |
| `yarn generate` | pass |
| `yarn build:packages` | pass |
| `yarn i18n:check-sync` | pass (pre-commit hook, every commit) |
| `yarn i18n:check-usage` | pass (advisory unused keys only) |
| `yarn typecheck` | pass — 42/42 tasks |
| `yarn test` | 50/51 tasks pass. `create-mercato-app#test` fails only in the agent-harness live-adapter suites (`live Codex adapter …`, `live Claude adapter …`, writable-oracle cases), which shell out to the local `codex`/`claude` CLIs and fail on this machine on a clean base too. This PR touches nothing under `packages/create-app`. |
| `yarn build:app` | pass |

## Card gate

- `commands/__tests__/codes.test.ts`, `lib/__tests__/code-service.test.ts`, `lib/__tests__/promotions-service.test.ts`: pass (promotions: 28 suites, 358 tests).
- Migration SQL vs reference `Migration20261026161603_promotions`: identical `up()`/`down()` SQL; only the class name and `name` changed to `Migration20261119224920`.
- `yarn typecheck`: pass.
- `UPGRADE_NOTES.md`: entry added for the `codes/use` replay; `revertCodeUse?` documented as an optional, additive member.

## Integration

`TMPDIR=/private/var/tmp yarn test:integration:ephemeral TC-PROM --verbose` — **39 passed (5.5m)**, including both `TC-PROM-090` cases and `TC-PROM-022b` (concurrent code-use race). The first ephemeral boot died on a port clash (`EADDRINUSE :5001`, another worktree's server); the harness rebuilt the environment and the rerun passed. The ephemeral init ran all migrations, so `Migration20261119224920_promotions` applied cleanly on real Postgres.

Scope note: only the promotions integration suite ran locally (the full ~2,500-test suite takes ~1h on one worker here); CI's `ephemeral-integration` job runs the full suite on the PR.

## Design-system pass

Skipped — no UI file touched.
