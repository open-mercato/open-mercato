# Execution Plan: Parallel Fork / Join for the Workflows Engine

> Source spec: `.ai/specs/2026-06-01-workflows-parallel-fork-join.md`
> Pre-implement analysis: `.ai/specs/analysis/ANALYSIS-2026-06-01-workflows-parallel-fork-join.md`
> Issue: open-mercato/open-mercato#2292 (PARALLEL_FORK / PARALLEL_JOIN portion)

## Goal

Implement working `PARALLEL_FORK` / `PARALLEL_JOIN` execution in the workflows engine (declared but previously threw `STEP_TYPE_NOT_IMPLEMENTED`), via a multi-token model with per-branch context, independent pause/resume, wait-all join, and sibling-cancellation on failure.

## Scope

- `packages/core/src/modules/workflows/` only (engine, data, validators, events, i18n, visual-editor nodes, integration tests).
- Additive DB changes (new `workflow_branch_instances` table + nullable columns + new `FORKED` status).
- DI signatures preserved (BC).

## Non-goals

- Nested fork, wait-N/quorum, first-completed/race (validator rejects nesting).
- Per-branch instance-viewer UI (deferred follow-up; data is available).

## Risks

- Token-abstraction refactor could regress the single-token path — mitigated by keeping the 521 existing unit tests green at every step and preserving DI signatures.
- Integration tests TC-WF-015..022 authored but **not executed** in the implementation environment (yarn/Playwright/DB unavailable) — must pass in CI; TC-WF-016 (async, worker-gated) and TC-WF-017 (failure) may need tuning once run.
- `yarn generate` must run before app boot (new entity).

## Environment blocker (this run)

The local toolchain could not run as the user: `.yarn/install-state.gz` is `root:root` (so `yarn install` cannot run) and the shell defaults to Node 22 (project requires Node 24). Gates verified directly: `tsc --noEmit` (clean), `jest` workflows scope (524 green), `i18n-check-sync` (clean for workflows). Gates deferred to CI: `build:packages`, `generate`, `build:app`, full-monorepo `test`, `om-auto-review-pr`. PR opened as **draft / in-progress** accordingly.

## Implementation Plan

Phases mirror the spec. All implemented in this run (pre-existing working tree captured onto the branch).

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Data model + validation

- [x] 1.1 `WorkflowBranchInstance` entity + `FORKED` status + nullable `branchInstanceId`/`activeForkStepId` columns
- [x] 1.2 Migration `Migration20260602120000.ts` + `.snapshot-open-mercato.json` (additive)
- [x] 1.3 `validateParallelForkJoin()` + schema wiring + 16 unit tests

### Phase 2: Engine (token abstraction)

- [x] 2.1 `execution-token.ts` (root + branch tokens)
- [x] 2.2 `transition-handler` → `executeTransitionForToken` + root adapter (DI signature preserved)
- [x] 2.3 `step-handler` branch-aware (optional `branch` param; root path unchanged)
- [x] 2.4 `openFork` / `advanceBranches` / `fireJoin` (parallel-handler) + executor `FORKED` hook
- [x] 2.5 Branch failure → sibling cancellation; unit tests (openFork, FORK/JOIN step-handler)

### Phase 3: Pause, resume, failure

- [x] 3.1 Per-branch resume: USER_TASK / signal / timer / async (with in-flight-job instance-level fallback)
- [x] 3.2 `StepInstance.branchInstanceId` (additive) for per-branch step lookup
- [x] 3.3 Public `workflows.branch.*` + `workflows.join.completed` events; base i18n ×4 locales
- [x] 3.4 Integration tests TC-WF-015..022 (authored; run in CI)

### Phase 4: Visual editor

- [x] 4.1 `ParallelForkNode` / `ParallelJoinNode` (DS-compliant) + node-type-map registration + icons
- [x] 4.2 `NodeEditDialog` labels + `workflows.nodeTypes.parallel*` i18n ×4 locales
- [ ] 4.3 Per-branch instance-viewer panel — DEFERRED follow-up (data available via branch events + `branchInstanceId`)

## Changelog

- 2026-06-02: Implemented Phases 1–3 + Phase 4 core. Captured onto `feat/workflows-parallel-fork-join` and opened as draft PR (in-progress) pending CI gate verification.
