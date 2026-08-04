# Handoff — 2026-08-04-stryker-mutation-testing-ci-gate

**Last updated:** 2026-08-04T07:33:00Z
**Branch:** `feat/stryker-mutation-testing-ci-gate`
**PR:** https://github.com/open-mercato/open-mercato/pull/4932 (draft)
**Current phase/step:** Phase 2 Step 2.1 (next to land)
**Last commit:** `089fcad52` — feat(ci): add the advisory mutation-testing workflow

## What just happened

- **Phase 1 and Phase 0b are complete** — 6 Steps landed. Checkpoint 1 recorded in
  `checkpoint-1-checks.md`: `yarn test:scripts` green at 463 passed / 0 failed, and the Step 1.2
  headline criterion verified — `packages/shared`'s `boolean.ts` scores **93.33 %** through the new
  factory, reproducing the Phase 0 pilot's 93.3 %.
- **Phase 0b decided the allowlist**: `packages/core` is excluded. Only its 75-LOC `lib/` leaf
  completed (1 m 45 s); `commands/roles.ts` exceeded ten minutes twice and `data/validators.ts`
  projected ~6 h 42 m for 403 mutants. The spec's 10-minute criterion is missed by ~2 orders of
  magnitude. Numbers are appended to `.ai/analysis/2026-07-31-stryker-mutation-testing-pilot.md`.

## Next concrete action

- Land Step 2.1: `scripts/stryker/report.mjs` is already written and its 13 tests pass — it needs
  committing together with the workflow steps that write `$GITHUB_STEP_SUMMARY` and upload the
  HTML/JSON artifact.

## Blockers / open questions

- None blocking. Two Steps remain conditional by the spec's own design: Phase 4's
  `mixinJestEnvironment` (4.1) and `incremental` caching (4.2) ship only if the measured timings
  justify them, and must be reported honestly rather than shipped speculatively.
- Step 1.5's spec criterion ("the workflow runs on this PR and reports a score") can only be
  confirmed once CI runs on PR #4932. Workflow invariants are unit-asserted in the meantime.

## Environment caveats

- Dev runtime runnable: not needed — no application code, no UI, no database.
- Browser / UI checks: **skipped for the whole run**, deliberately. The change touches no
  `.tsx` outside tests and nothing under `packages/ui/src/`; its only developer-facing surface is a
  GitHub Actions job summary. There is nothing to screenshot.
- Database/migration state: clean — no entities, no migrations, no database access.
- Packages are built in this worktree (`build:packages` → `generate` → `build:packages`, rc=0).
  A fresh worktree must repeat that before any Stryker run, or the dry run fails on
  `@open-mercato/cache`.
- **Never run two `inPlace` Stryker runs against the same package concurrently.** An interrupted run
  leaves ~4 966 files carrying an injected `// @ts-nocheck`; recover with
  `git checkout -- packages/<pkg>`. Killing a runaway run needs `dangerouslyDisableSandbox`, and
  `pgrep` sees these processes when `ps` does not.
- Known pre-existing failures on this machine, unrelated to this change: `packages/ui`
  `format.test.ts` (Polish locale) and two `watch-packages` `fs.watch` tests.

## Worktree

- Path: `/home/bernard/workspace/OpenMercatoTest/.ai/tmp/om-auto-create-pr-loop/stryker-mutation-testing-ci-gate-20260804-085356`
- Created this run: yes
