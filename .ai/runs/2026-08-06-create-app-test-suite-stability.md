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

PR: #5064

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

- [x] 4.1 After-measurement against the baseline — measurement, see Measurements
- [x] 4.2 Full validation gate — all eight configured commands green
- [x] 4.3 PR body, labels, summary comment — PR #5064
- [x] 4.4 Code-review pass and its one finding (no test covered the new staging artifacts) — 87153a75d

### Phase 5: External review follow-up (@adeptofvoltron, changes-requested)

- [x] 5.1 Restore the PR description — a spec-writing run had overwritten the body with an unrelated
      4catalog design summary, which would have become the squash-merge message and falsely claimed
      "design only, no contract change"
- [x] 5.2 Declare `create-mercato-app#test` → `dependsOn: ["^build"]` in `turbo.json`, and turn an
      unresolved sibling import in `build.mjs` into the actionable "run `yarn build:packages` first"
      message (`scripts/sibling-build.mjs`) so a direct `node build.mjs` says the same thing turbo's
      graph now prevents — with `src/lib/sibling-build.test.ts` and a `turbo.json` policy assertion
      covering the gap the review named
- [x] 5.3 Note in the reporter header that the banner needs node:test's run-level summary, so a hard
      kill printing only node's own interruption notice reads as expected rather than as a reporter
      that failed to fire
- [x] 5.4 Build-log honesty: the copy and fact-sheet lines now name `dist/agentic.staging/`, and the
      header states that a single builder at a time is an assumption of the staged-swap design
- [x] 5.5 Follow-up issue for the same in-place `rmSync` + `cpSync` pattern still in
      `packages/cli/build.mjs` — out of scope here, nothing reads that tree concurrently today

### Phase 6: Second review follow-up — the conflict against `develop` (@adeptofvoltron, changes-requested)

- [x] 6.1 Merge the current `develop` tip (`2968c89bd`) and resolve the one conflicting file,
      `packages/create-app/src/lib/module-facts-build.test.ts`, by taking `develop`'s stricter
      "required by at least one catalog case" guard from #4603 (`50ba13cfd`) — including its
      `FACT_SHEETS_EXEMPT_FROM_REQUIRED_CASE` list and the two staleness assertions — and applying
      only this PR's own change on top of it: the removal of the in-test `ensureBuilt()` build
      spawn, which is the whole point of #5059. Keeping this branch's weaker "routed by at least
      one catalog case" predicate would have silently regressed a guard that already landed
- [x] 6.2 Re-run the full validation gate on the merged head — eight configured commands, local
      runner, no Docker `app` container present. Seven green; `yarn test` fails only on
      `@open-mercato/cli` `openapi.test.ts` (4 × 5 s Jest timeout), a package this branch leaves
      byte-identical to `develop`, and that file passes 10/10 in 1.9 s when run without the
      parallel monorepo load — host contention, not a regression. The changed package's own suite
      was run directly and is green: 477 tests, 472 pass, 0 fail, 5 skipped
- [x] 6.3 The failing required `audit` check is base-branch breakage, not this PR's: `yarn.lock`
      is byte-identical to `develop`, and the advisories are already tracked repo-wide by the
      auto-refreshed issue #5111 (`security: high-severity dependency advisories on develop`).
      No duplicate follow-up filed; no dependency bump attempted from this branch

### Phase 7: Unblock the skipped checks — refresh against the `develop` tip that fixed `audit`

- [x] 7.1 Merge the current `develop` tip (`560e304de`) into the branch — no conflict this time.
      Ten commits had landed since the Phase 6 merge base (`2968c89bd`), among them `4792c7717`
      (`fix(ci): unblock the dependency audit gate`, #5157) which added `scripts/audit-ci-allowlist.json`
      and the narrow-exception path in `scripts/audit-ci.mjs`. This is the only thing that could
      clear the red `audit` check on this PR: the check failed on base-branch breakage tracked as
      #5111, and `ci.yml` gates `test`, `ephemeral-integration`, `merge-coverage` and `docker-build`
      on `audit` being success-or-skipped, so on the Phase 6 head those four never ran at all — the
      review's earlier reading (that the skips came from the merge conflict) was wrong, and Phase 6
      had already corrected it publicly
- [x] 7.2 Verify the gate locally rather than assume the merge fixed it — `node scripts/audit-ci.mjs`
      on the merged head with a fresh advisory database: 2416 packages scanned, threshold `high+`,
      two `image-size` advisories consumed by the new allowlist, **no advisory at or above the
      threshold**, exit 0
- [x] 7.3 Re-run the full validation gate on the merged head — eight configured commands, local
      runner (no Docker `app` container present). Seven green. `yarn test` exits 1 on a single
      assertion in `@open-mercato/telemetry` `pg-instrumentation.test.ts`, a package this branch
      leaves byte-identical to `develop` (`git diff upstream/develop HEAD -- packages/telemetry`
      is empty) and whose test landed long before this branch (`e76f4b8cb`, #4475). It fails the
      same way when run alone, so it is not parallel-load contention; it is the local host — the
      probe spawns a child process and asserts on OpenTelemetry's `require-in-the-middle` patch of
      `pg`, and `develop`'s own CI run on `4792c7717` (the tip merged here) went green including
      that job. `yarn build:app` ✅ after it. The changed package's suite was run directly and is
      green: **478 tests, 473 pass, 0 fail, 5 skipped**
- [x] 7.4 Push, report on the PR, and request the re-review

### Phase 8: Close the three nits from the approving review (@pkarw, `656cd762f`)

- [x] 8.1 Close #5091 from this PR's body — PR body edit, no commit. It is the ENOTEMPTY-shaped sibling of #5059 — the same
      `rmSync(..., { recursive: true })` on `dist/agentic` that the staged swap deletes, triggered by
      the same back-to-back builds this PR stops spawning — and its own "Suggested direction" asks
      verbatim for the swap implemented here. Without the keyword the issue sits open until somebody
      re-triages it and rediscovers it was fixed in August
- [x] 8.2 `packages/create-app/build.mjs` — 15fa941dc: the standalone-guides log line still named
      `dist/agentic/guides/` while its two siblings (the copy line and the fact-sheet line) were
      updated to the staging path in step 5.4. While the build runs, that directory still holds the
      *previous* build's contents, which is exactly the confusion the staged swap exists to remove
- [x] 8.3 Cover `requirePackageBuild()`'s throw path directly — 15fa941dc, `src/lib/package-build-artifacts.test.ts`. The guard's whole reason to exist is
      the message it raises when `dist/index.js` or `dist/agentic` is missing, and the suite only
      ever reached the satisfied branch because the `test` script builds first; its sibling
      `describeMissingSiblingBuild` already had `sibling-build.test.ts` covering both branches
- [x] 8.4 Verify, push, and re-request the review that still holds the merge blocked. Verification on
      this head, local runner (no Docker `app` container): `yarn build:packages` ✅ · `yarn generate` ✅
      (no tracked-file drift) · `yarn i18n:check-sync` ✅ · `yarn i18n:check-usage` ✅ ·
      `yarn typecheck` ✅ (22/22 turbo tasks) · `yarn test:scripts` ✅ (475 pass, 0 fail — run
      explicitly because `yarn test` does not reach `scripts/check-version-alignment.sh`, the lesson
      from #4391) · the changed package's own suite ✅ **481 tests, 476 pass, 0 fail, 5 skipped**
      (was 478/473 before this phase; +3 are the new throw-path cases). The monorepo-wide `yarn test`
      and `yarn build:app` were not re-run on this head: this phase's delta is one log string and one
      new test file, both inside `packages/create-app`, and neither enters `build:app`'s input set —
      CI runs the full gate on the merge result and is the arbiter, per this repo's review
      convention. The merge stays blocked on the stale `changes-requested` review, not on the gate
