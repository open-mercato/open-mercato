# Execution plan — stabilize the `create-mercato-app` unit suite (#5059, #5052)

- Engine: om-auto-create-pr (steps: 14, --loop: no)
- Base branch: `develop`
- Branch: `fix/create-app-test-suite-stability`
- Issues: #5059 (parallel test files race on `build.mjs` wiping `dist/agentic`), #5052 (suite truncated on slow CI runners)

## Goal

Make `yarn workspace create-mercato-app test` deterministic and fast enough to finish on a 2-core CI
runner: no test file may rebuild `dist/agentic` while another file reads it (#5059), and the suite must
have real wall-clock headroom instead of being cut off mid-run with `fail 0` and 26+ cancelled files (#5052).

Both issues share one aggravating cause — the package build (esbuild + a ts-morph extraction of ~55
module fact-sheets) is executed *from inside* the test files, concurrently, several times per run.

## Scope

- `packages/create-app/package.json` — the `test` script (build once, pinned runner policy).
- `packages/create-app/build.mjs` — refresh `dist/agentic` without a destructive window.
- `packages/create-app/src/lib/module-facts-build.test.ts`, `src/lib/ready-apps.test.ts` — stop spawning
  `build.mjs` from inside the suite.
- A new guard test that pins whatever runner policy lands, so a future edit cannot silently revert it.
- Measurement evidence (before/after) recorded in this plan and in the PR.

## Non-goals

- Changing which CI step runs the suite. `.github/workflows/ci.yml` must keep running the create-app
  suite unconditionally (the step's own comment references #3779) — "run it only when create-app changes"
  is explicitly rejected.
- Raising `--test-timeout` as a masking measure. Nothing in the reported runs hit the 120 s per-test
  timeout, so a higher global threshold would hide the failure instead of fixing it.
- Touching published artifacts, the template tree, or anything outside `packages/create-app` test plumbing.

## Risks

- `packages/create-app/src/lib/module-facts-build.test.ts` is also touched by open PR #5038; whichever
  lands second needs a trivial rebase.
- Moving the build out of the test files means a *single* test file run (`node --test src/lib/x.test.ts`)
  no longer builds implicitly. The fix must fail with an actionable message instead of a bare ENOENT.
- Reducing per-case cost in `business-writable-oracles.test.ts` must not weaken what the 23 `OMH-*`
  oracle cases assert; any sharing has to keep each case's writes isolated.

## Implementation Plan

### Phase 1 — Measure the baseline

Establish the "before" numbers this PR is judged against: full-suite wall time, node:test counters, and
per-file durations that identify where the budget is spent. Reproduce the #5059 race deterministically.

### Phase 2 — Remove the concurrent build (#5059)

Build the package once, before the runner starts, and drop the in-test `build.mjs` spawns so no process
can delete `dist/agentic` while another reads it. Make `build.mjs` refresh `dist/agentic` through a
staged swap so any other concurrent consumer sees a complete tree. Pin the policy with a guard test.

### Phase 3 — Give the suite real headroom (#5052)

Re-measure after Phase 2 and only then decide what else is required: cut the dominant per-case cost in
`business-writable-oracles.test.ts`, pin runner concurrency so behavior does not vary with the runner's
core count, and make a truncated run fail with a message that names the abort.

### Phase 4 — Prove it and ship

After-measurement under simulated runner starvation, full validation gate, PR body with both issues
linked, labels and summary comment.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Measure the baseline

- [ ] 1.1 Record full-suite wall time and node:test counters on the develop tip
- [ ] 1.2 Record per-file durations and identify the hot spots
- [ ] 1.3 Reproduce the #5059 race deterministically and record the failure signature

### Phase 2: Remove the concurrent build (#5059)

- [ ] 2.1 Build once before the runner in the create-app `test` script
- [ ] 2.2 Drop the in-test `build.mjs` spawns and fail actionably when `dist/` is missing
- [ ] 2.3 Refresh `dist/agentic` through a staged swap in `build.mjs`
- [ ] 2.4 Guard test pinning the `test` script policy

### Phase 3: Give the suite real headroom (#5052)

- [ ] 3.1 Re-measure after Phase 2 and decide the remaining work from the numbers
- [ ] 3.2 Cut the dominant per-case cost in `business-writable-oracles.test.ts`
- [ ] 3.3 Pin runner concurrency so behavior is deterministic across runner sizes
- [ ] 3.4 Make a truncated run fail with a readable message instead of `fail 0`

### Phase 4: Prove it and ship

- [ ] 4.1 After-measurement, including a starved-runner comparison
- [ ] 4.2 Full validation gate
- [ ] 4.3 PR body, labels, summary comment
