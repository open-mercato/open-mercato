# Handoff — 2026-05-27-acl-dependency-bundles

**Last updated:** 2026-05-27T17:15Z
**Branch:** feat/acl-dependency-bundles
**PR:** not yet opened
**Current phase/step:** Phase 1 Step 1.1 (seeding run folder)
**Last commit:** pending — this is the seed

## What just happened
- Triaged alinadivante's PR #2073 QA comment.
- Surveyed 48 module `acl.ts` files (small, uniform shape).
- Confirmed `AclEditor` is the single shared point for role-edit and user-edit feature toggling.
- Drafted Tasks table + spec scaffold.

## Next concrete action
- Step 1.2: write `.ai/specs/2026-05-27-acl-dependency-bundles.md` (audit + per-module dep tables + UI design).

## Blockers / open questions
- Server-side enforcement of declared deps is intentionally deferred to a follow-up spec; warnings only in this PR.

## Environment caveats
- Dev runtime runnable: unknown (this is a janitor-managed worktree; no plans to boot dev for UI screenshots in this run unless required by the checkpoint).
- Playwright / browser checks: skipped at checkpoints unless UI verification is essential.
- Database/migration state: clean — no migrations in this PR.

## Worktree
- Path: /home/pkarw/Projects/github-janitor/.janitor/repos/open-mercato__open-mercato/worktrees/7976838e-008e-4537-b93d-ab4e3c1fd486
- Created this run: no — reusing the janitor task worktree.
