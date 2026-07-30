# Standalone Dev-Memory 30% Reduction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:executing-plans` to implement this plan task-by-task. The work is
> evidence-driven; Phase 2 produces the exact production-change manifest before
> Phase 3 begins.

**Goal:** Reduce the scaffolded standalone app's median peak dev-mode process-tree
RSS by at least 30% while preserving login, authenticated page rendering, and
module hot reload.

**Architecture:** Use the existing process-tree sampler from outside a fresh
Verdaccio-backed standalone app, drive one deterministic browser workflow, and
repeat it three times for the baseline and candidate. Attribute the peak before
changing production code, then test one minimal hypothesis at a time and retain
only the intervention that meets the target without weakening runtime behavior.

**Tech Stack:** Node.js 24, Yarn 4, Verdaccio, Next.js/Turbopack, Playwright,
Open Mercato CLI, and the existing `scripts/profile-dev-rss.mjs` sampler.

## Global Constraints

- Primary metric: median `summary.peakTotalMb` across three equivalent runs.
- Required reduction: at least 30%.
- Every measurement run must start `yarn dev`, authenticate as the default super
  administrator, visit the same backend page, modify the same standalone module
  file, observe the hot-reloaded result, and stop the process tree cleanly.
- Baseline and candidate use the same generated app, dependencies, database,
  environment, route, edit, sampling interval, and duration.
- Do not use a V8 heap cap as the first intervention.
- Do not ship a preview dependency release as the final intervention.
- Mirror every affected `apps/mercato/src/app/**`, app-shell component, dev-runtime
  script, or environment change into `packages/create-app/template`.
- Preserve public contracts described by `BACKWARD_COMPATIBILITY.md`.
- Runner: local, because validation is against a host-run standalone app.

---

## File Structure

- `.ai/specs/2026-07-30-standalone-dev-memory-reduction.md`
  - Owns the measurement contract and final result summary.
- `.ai/runs/2026-07-30-standalone-dev-memory/PLAN.md`
  - Tracks the evidence-driven implementation sequence.
- `.ai/runs/2026-07-30-standalone-dev-memory/baseline.md`
  - Records the exact fixture, workflow, three baseline results, median, and
    process attribution.
- `.ai/runs/2026-07-30-standalone-dev-memory/root-cause.md`
  - Records evidence, the single tested hypothesis, and the resulting exact
    production/test file manifest.
- `.ai/runs/2026-07-30-standalone-dev-memory/verification.md`
  - Records three candidate results, comparison math, functional checks, and
    repository validation.
- Production and regression-test files
  - Determined by the Phase 2 attribution gate and written into
    `root-cause.md` before any production edit.

## Tasks

### Task 1: Create and measure the standalone baseline

**Files:**

- Create: `.ai/runs/2026-07-30-standalone-dev-memory/baseline.md`
- Runtime artifact: `/tmp/open-mercato-standalone-memory-baseline`
- Runtime reports:
  `/tmp/open-mercato-standalone-memory-baseline/.mercato/dev-rss/baseline-{1,2,3}.json`

**Interfaces:**

- Consumes: current `develop` packages published to local Verdaccio.
- Produces: three comparable profiler reports plus a baseline median and peak
  process attribution.

- [ ] Build packages in the required order:
  `yarn build:packages`, `yarn generate`, `yarn build:packages`.
- [ ] Start Verdaccio, publish the current workspace packages, and scaffold
  `/tmp/open-mercato-standalone-memory-baseline` with agentic setup disabled.
- [ ] Install and initialize the standalone app using the generated commands.
- [ ] Add one minimal app-local module whose visible backend output can change from
  `Baseline marker A` to `Baseline marker B` without database writes.
- [ ] Start `yarn dev`, attach `scripts/profile-dev-rss.mjs --pid <pid>` at a
  1-second interval, and drive the browser workflow.
- [ ] Verify authentication with `superadmin@acme.com`, visit the chosen backend
  route, change the module marker, and assert the browser displays marker B without
  a server restart.
- [ ] Stop the full dev process tree and retain the report.
- [ ] Repeat the same workflow twice more from a full dev restart.
- [ ] Write `baseline.md` with each peak, mean, dominant process class, top process,
  hot-reload evidence, and the median peak.

### Task 2: Attribute the peak and confirm one hypothesis

**Files:**

- Create: `.ai/runs/2026-07-30-standalone-dev-memory/root-cause.md`
- Read: the three baseline JSON reports
- Read: relevant Turbopack trace/import and generated-registry sources

**Interfaces:**

- Consumes: Task 1 profiler reports and lifecycle evidence.
- Produces: one falsifiable root-cause hypothesis, one isolated experiment, and
  the exact production/test file manifest for Task 3.

- [ ] Compare the three peak samples and identify the repeatable dominant process,
  lifecycle phase, and top commands.
- [ ] Inspect the standalone app's generated route/client registries and the
  corresponding template/generator call sites reachable at the peak.
- [ ] Compare the current implementation with existing dev-memory research
  branches only as reference; do not import a branch wholesale.
- [ ] State one hypothesis in `root-cause.md` as “X causes Y because Z evidence”.
- [ ] Test that hypothesis with the smallest reversible experiment against one
  standalone run.
- [ ] Revert the experiment if it does not reduce the attributed component; form a
  new single hypothesis from the new evidence.
- [ ] When confirmed, record exact production files, regression-test files,
  expected failing assertion, and compatibility/template-sync obligations in
  `root-cause.md`.

### Task 3: Implement the confirmed optimization test-first

**Files:**

- Modify: only the exact files recorded by Task 2 in `root-cause.md`
- Test: the exact focused regression tests recorded by Task 2

**Interfaces:**

- Consumes: Task 2's confirmed hypothesis and file manifest.
- Produces: a minimal production change that removes the proven dev-memory cost
  while preserving public behavior.

- [ ] Read `BACKWARD_COMPATIBILITY.md` and every closest package/module
  `AGENTS.md` named by the Task 2 file manifest.
- [ ] Write the focused regression test that would fail if the expensive eager
  behavior remains.
- [ ] Run the focused test and confirm it fails for that behavior, not for setup.
- [ ] Implement the smallest production change that satisfies the test.
- [ ] Run the focused test and confirm it passes.
- [ ] Run adjacent tests for every touched package.
- [ ] Run `yarn generate` when auto-discovered module or registry inputs change.
- [ ] Review the diff for template parity and unrelated edits.

### Task 4: Prove the 30% candidate result and runtime behavior

**Files:**

- Create: `.ai/runs/2026-07-30-standalone-dev-memory/verification.md`
- Runtime reports:
  `/tmp/open-mercato-standalone-memory-baseline/.mercato/dev-rss/candidate-{1,2,3}.json`

**Interfaces:**

- Consumes: Task 3 production change and Task 1 standalone fixture.
- Produces: three candidate reports, comparison math, and functional evidence.

- [ ] Rebuild packages in the required order and republish them to Verdaccio.
- [ ] Refresh the existing standalone app's Open Mercato packages without changing
  its app-local module, database, or workflow.
- [ ] Run the exact Task 1 workflow three times as `candidate-1` through
  `candidate-3`.
- [ ] Confirm all three runs authenticate, render the backend page, and hot-reload
  marker A to marker B.
- [ ] Compute the candidate median and
  `(baseline median - candidate median) / baseline median`.
- [ ] If the reduction is below 30%, return to Task 2 with the new attribution;
  do not stack an unproven second change.
- [ ] Write `verification.md` with raw results, medians, percentage, functional
  evidence, and any secondary mean/idle/latency effects.

### Task 5: Repository validation and completion audit

**Files:**

- Modify: `.ai/specs/2026-07-30-standalone-dev-memory-reduction.md`
- Modify: `.ai/runs/2026-07-30-standalone-dev-memory/verification.md`

**Interfaces:**

- Consumes: all implementation and measurement evidence.
- Produces: current-state proof for every requirement in the user objective.

- [ ] Run the smallest relevant focused tests and the create-app template tests.
- [ ] Run the required package build/generate/build sequence.
- [ ] Run `yarn typecheck` and the smallest relevant lint scope.
- [ ] Re-run one fresh final standalone `yarn dev` workflow after all validation.
- [ ] Append exact before/after medians, reduction, implementation summary,
  validation commands, and changelog entry to the dev-memory spec.
- [ ] Audit each requirement: fresh standalone creation, baseline measurement,
  at least 30% reduction, dev-mode start, login, page visit, standalone-module
  hot reload, template parity, and regression coverage.
