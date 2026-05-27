# Handoff — 2026-05-27-dev-mode-lazy-load-heavy-clients

**Last updated:** 2026-05-27T14:38:00Z
**Branch:** `feat/dev-mode-lazy-load-heavy-clients`
**PR:** not yet opened
**Current phase/step:** Phase 1 Step 1.1 (seeding)
**Last commit:** (pending)

## What just happened
- Reconnaissance complete. Identified five quick-win interventions: recharts lazy, @xyflow/react lazy + CSS scoping, ClientBootstrap registry deferral, optimizePackageImports for lucide-react/recharts/date-fns, and dead transpiledWorkspacePackages cleanup.
- Branch created from `origin/develop` (HEAD: `25fdb35f2`).

## Next concrete action
- Commit the seed run folder (`docs(runs): add execution plan for dev-mode-lazy-load-heavy-clients`) and push.
- Then Step 2.1 — split each recharts chart primitive into a public wrapper + sibling Impl, dynamic-import the Impl with `ssr: false`.

## Blockers / open questions
- `yarn dev:profile` harness from PR #2104 is not on `develop` yet. Using manual `ps axo rss` snapshots for before/after numbers. Once #2104 lands, future regression checks should use the harness.
- Need to confirm whether `WorkflowGraphReadOnly` is a separate file or re-exported from `WorkflowGraph.tsx` (Step 2.2 plan adjusts depending).

## Environment caveats
- Dev runtime runnable: yes (verified via prior runs in this worktree).
- Playwright / browser checks: enabled via `yarn test:integration` at final gate.
- Database/migration state: clean — no schema changes in this run.

## Worktree
- Path: `/home/pkarw/Projects/github-janitor/.janitor/repos/open-mercato__open-mercato/worktrees/4dee35c7-8b57-48f5-8a72-031ed5261eb3`
- Created this run: no (janitor-managed, reusing existing linked worktree)
