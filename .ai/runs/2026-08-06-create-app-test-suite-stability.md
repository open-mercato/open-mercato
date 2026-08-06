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

## Measurements

Machine: 11-core macOS laptop that is not idle (a second agent worktree and an endpoint-security
daemon run throughout), so wall clock is noisy and **CPU time (user+sys) is the primary metric** — it
measures the work the suite performs rather than how much of the machine it got. Three runs per state,
whole `test` script, 461 tests each.

| State | wall (median of 3) | CPU user+sys (median of 3) |
|-------|--------------------|----------------------------|
| before (develop tip) | 114.5 s (138.9 / 114.5 / 92.9) | 200.8 s (209.0 / 200.8 / 188.6) |
| after | 101.2 s (101.2 / 107.7 / 98.4) | 178.3 s (177.6 / 181.1 / 178.3) |

**−22.5 s CPU (−11.2%) and −13.3 s wall (−11.6%)** for the same 461 tests: the suite used to build the
package twice (`module-facts-build.test.ts` and `ready-apps.test.ts`), now it builds once.

Pinning `--test-concurrency` was measured rather than assumed, and every pinned value came out worse
than the runner default (which is `availableParallelism()`), so the suite keeps the default and this
PR adds no concurrency knob:

| run | wall | CPU user+sys |
|-----|------|--------------|
| after, runner default | 101.2 s / 108.2 s (control) | 178.3 s / 181.3 s (control) |
| after, `--test-concurrency=4` | 135.1 s | 188.4 s |
| after, `--test-concurrency=8` | 167.2 s | 199.2 s |
| after, `--test-concurrency=16` | 136.6 s | 196.9 s |

`dist/agentic` availability during one build, sampled every 5 ms (`build exit=0`):

| probe path | before | after |
|------------|--------|-------|
| `guides/module-facts.json` | missing 98.0% of the build (~5.28 s) | missing 0.0% |
| `guides/modules/customers.md` | missing 97.8% (~5.26 s) | missing 0.0% |
| `shared/ai/harness/cases.json` | missing 0.5% (~0.03 s) | missing 0.0% |

## Implementation Plan

### Phase 1 — Measure the baseline

Establish the "before" numbers this PR is judged against: full-suite wall time, node:test counters, and
per-file durations that identify where the budget is spent. Reproduce the #5059 race deterministically.

### Phase 2 — Remove the concurrent build (#5059)

Build the package once, before the runner starts, and drop the in-test `build.mjs` spawns so no process
can delete `dist/agentic` while another reads it. Make `build.mjs` refresh `dist/agentic` through a
staged swap so any other concurrent consumer sees a complete tree. Pin the policy with a guard test.

### Phase 3 — Make the truncation readable (#5052)

Reading both CI jobs the issue cites changed the diagnosis, so this phase follows the evidence rather
than the issue's hypothesis:

| PR | job | turbo summary | create-app suite |
|----|-----|---------------|------------------|
| #4974 | 92297927575 | `Failed: @open-mercato/checkout#test` | `fail 0`, 27 cancelled |
| #4358 | 92281599626 | `Failed: @open-mercato/app#test` | `fail 0`, 26 cancelled |

Both truncations happened inside the turbo **Test** step (`yarn turbo run test --filter=…`, 23 tasks at
turbo's concurrency of 32), not in the "Check create-app template parity" step, and in both cases a
*different* package's test task failed first. Turbo then aborted the siblings still running; the
create-app suite is the longest-running one, so it is the one caught mid-flight, and the files it had
not started yet are reported as cancelled with `fail 0`. It was not running out of headroom on its own.

So the remedy is the issue's own step 5 — make truncation loud instead of confusing — plus Phase 2's
removal of two redundant package builds, which shortens the window in which the suite can be caught.
Raising a timeout would have masked nothing real, and cutting the `business-writable-oracles.test.ts`
per-case cost is not pursued without evidence that duration is what breaks the run.

### Phase 4 — Prove it and ship

After-measurement under simulated runner starvation, full validation gate, PR body with both issues
linked, labels and summary comment.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Measure the baseline

- [x] 1.1 Record full-suite wall time, CPU time and node:test counters on the develop tip — measurement, see Measurements
- [x] 1.2 Quantify the `dist/agentic` window a concurrent reader can observe — measurement, see Measurements
- [x] 1.3 Diagnose the truncation from the two CI jobs the issue cites — see Phase 3 table

### Phase 2: Remove the concurrent build (#5059)

- [x] 2.1 Build once before the runner in the create-app `test` script — 85d73399d
- [x] 2.2 Drop the in-test `build.mjs` spawns and fail actionably when `dist/` is missing — 85d73399d
- [x] 2.3 Refresh `dist/agentic` through a staged swap in `build.mjs` — b2208f747
- [x] 2.4 Guard test pinning the `test` script policy — d900cf931

### Phase 3: Make the truncation readable (#5052)

- [x] 3.1 Re-measure after Phase 2 and decide the remaining work from the numbers — measurement, see Measurements
- [x] 3.2 Report a truncated run as truncated instead of as 26 failing tests — d900cf931
- [x] 3.3 Decide runner-concurrency pinning from the measurements, not from assumption — measured, not pinned

### Phase 4: Prove it and ship

- [ ] 4.1 After-measurement against the baseline
- [ ] 4.2 Full validation gate
- [ ] 4.3 PR body, labels, summary comment
