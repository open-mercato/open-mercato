# Stabilize main — 2026-11-19

## Goal

Establish green full-suite CI on a dedicated stabilization PR into main, fixing verified root causes and requesting automerge only after independent review and passing checks.

## Scope

Start from main at `754b2dafc0d6775aef2c22aec7c9b6300e579663` on `stabilize/main-2026-11-19-1600`. Inspect current main failures and repeat the full suite in the PR's isolated concurrency group. Full-suite selection for trusted `stabilize/` branches and the `ci-full` label already exists in `.github/workflows/ci.yml`; preserve it unless evidence demonstrates a defect.

Non-goals: speculative changes, unrelated refactors, release publishing, deployment, database migration application, base-branch merges, or weakening/skipping checks.

## Implementation Plan

### Phase 1: Establish evidence

1.1 Independently audit current main CI logs and existing stabilization coverage (read-only delegated investigation).

1.2 Open the draft stabilization PR and verify all 15 integration shards are selected.

### Phase 2: Repair and validate

2.1 Reproduce and fix verified CI root causes with focused regression coverage; document a no-change result if current main is already healthy.

2.2 Run the configured validation gate and full PR CI, iterating on failures until the exact PR head is green.

### Phase 3: Review and handoff

3.1 Dispatch one final independent review task for the completed branch, resolve findings, and verify the reviewed head.

3.2 Publish final evidence, mark the PR ready, and apply automerge only when all checks pass.

## Delegation

Two tasks maximum: a read-only CI investigation, then a final independent review. The parent owns all implementation because the discovered fixes and full-suite feedback form a coupled stabilization loop. No child changes will be merged without review.

## Risks

- The unsuffixed daily branch and plan belong to merged PR #9867. This scheduled occurrence uses a time suffix to preserve that completed run. Preflight briefly republished the old local branch; no changes were pushed to main or the earlier PR.

- Main may already be healthy after recent fixes; do not manufacture code changes to justify the PR.
- Long-running full integration and container builds require exact-head workflow evidence, including queued runs with no visible checks.
- The local checkout initially has no installed dependencies. Record runner and any resource/environment blockers honestly; hosted CI evidence remains necessary.
- The user explicitly requests waiting for green CI, overriding the skill's usual report-without-waiting default.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Establish evidence

- [ ] 1.1 Independently audit current main CI logs and existing stabilization coverage
- [ ] 1.2 Open the draft stabilization PR and verify all 15 integration shards are selected

### Phase 2: Repair and validate

- [ ] 2.1 Reproduce and fix verified CI root causes with focused regression coverage
- [ ] 2.2 Run the configured validation gate and full PR CI

### Phase 3: Review and handoff

- [ ] 3.1 Dispatch final independent review and resolve findings
- [ ] 3.2 Publish evidence, mark ready, and apply automerge after green checks
