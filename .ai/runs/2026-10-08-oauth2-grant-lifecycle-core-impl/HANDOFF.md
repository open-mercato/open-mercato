# Handoff — 2026-10-08-oauth2-grant-lifecycle-core-impl

**Last updated:** 2026-10-12T15:12:48Z
**Branch:** feat/oauth2-grant-lifecycle-core-impl
**PR:** https://github.com/open-mercato/open-mercato/pull/7057 (draft)
**Current phase/step:** all Steps done (status complete); the merge waits for App Spec Q3 and Q7
**Last commit:** the branch's single commit (Steps recorded as `squashed`)

## What just happened
- P3–P6 landed with review fixes (cross-copy error identity, app build typing of the fake server, banner focus ring, disconnect-hook error reporting, one definition of the frozen grant-row suffix); final gate passed (`final-gate-checks.md`).

## Next concrete action
- Maintainers: App Spec Q3 (public surface and CI steps), Q7 (consumer gate) and the Phase 2 home (`packages/sync-xero`, since official-modules is deprecated).
- The first consumer is specified in `.ai/specs/2026-09-26-app-spec-xero-integration.md` (separate branch).

## Blockers / open questions
- Platform issue outside this PR: a transaction whose session Postgres ends (25P03) never returns its pooled connection (Kysely `ControlledTransaction.rollback()` skips `release()` when the rollback fails).
- Open nits are listed in `final-gate-checks.md`.

## Environment caveats
- The real-Postgres suites need Docker; CI on this fork PR runs only after a maintainer approves the workflow runs.

## Worktree
- Path: `.claude/worktrees/pr-7057-upstream-update-78cfe8`
- Created this run: no
