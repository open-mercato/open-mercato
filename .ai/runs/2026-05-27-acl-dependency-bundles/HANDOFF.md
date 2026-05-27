# Handoff — 2026-05-27-acl-dependency-bundles

**Last updated:** 2026-05-27T17:26Z
**Branch:** feat/acl-dependency-bundles
**PR:** not yet opened
**Current phase/step:** Phase 4 Step 4.1 (AclEditor diagnostics panel)
**Last commit:** c7d7ac20d — feat(customers): declare ACL feature dependencies

## What just happened
- Steps 1.1, 1.2, 2.2 (squashed 2.1+2.2), 2.3, 3.1 landed.
- Phase-1 (spec) + Phase-2 (infra) + Phase-3 (customers acl) all done.
- Checkpoint 1 ran: resolver 19/19 pass, features-endpoint 6/6 pass, typecheck clean. Pre-existing baseline failures (`@open-mercato/cache` not resolvable from this janitor worktree) confirmed unrelated by re-running against `origin/develop`.

## Next concrete action
- Step 4.1: wire `resolveAclDependencyDiagnostics` into `AclEditor.tsx`. Add the diagnostics panel above the module feature grid. Wire the three apply helpers (`Add missing`, `Restore parent`, `Drop dependents`) as click handlers.

## Blockers / open questions
- Server-side enforcement of declared deps is intentionally deferred to a follow-up spec; warnings only in this PR.
- Workspace `@open-mercato/cache` link is broken in this janitor environment (reproduces on develop). Out of scope for this PR; noted as a follow-up task.

## Environment caveats
- Dev runtime runnable: unknown (this is a janitor-managed worktree; no plans to boot dev for UI screenshots in this run unless required by the checkpoint).
- Playwright / browser checks: skipped at Checkpoint 1; will attempt at Checkpoint 2 after AclEditor edits.
- Database/migration state: clean — no migrations in this PR.

## Worktree
- Path: /home/pkarw/Projects/github-janitor/.janitor/repos/open-mercato__open-mercato/worktrees/7976838e-008e-4537-b93d-ab4e3c1fd486
- Created this run: no — reusing the janitor task worktree.
