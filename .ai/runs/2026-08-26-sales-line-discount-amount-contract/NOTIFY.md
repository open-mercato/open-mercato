# Notify — 2026-08-26-sales-line-discount-amount-contract

> Append-only log. Every entry is UTC-timestamped. Never rewrite prior entries.

## 2026-08-26T05:52:00Z — run started
- Brief: implement §§ 1–4 of the approved sales line `discount_amount` contract, so the column means a line total on both the read and the write path and recalculation becomes idempotent.
- External skill URLs: none.

## 2026-08-26T05:52:00Z — decision: the maintainer approval that unblocks this run
- @wojciechszyjka approved § Proposed Solution 1 (the column is a line total) and § Proposed Solution 2 (percentage-first precedence, a stored `0` treated as absent) on 2026-08-26, releasing a gate the spec had held since 2026-08-07.
- Four further calls were resolved rather than deferred back to the user, because each follows from the approval and stopping on any of them would have delivered nothing: D3 — `discountAmount: 0` alongside a non-zero percent now applies the percentage, which is § 2 as written; D4 — § Alternatives E is not adopted, since the § 3 type shape is identical either way and E stays additively adoptable later; D5 — the opt-in operator repair CLI is deferred to a follow-up issue rather than bundled into an already-large behaviour change; D6 — the duplicated mapper is extracted rather than kept behind an equivalence test.

## 2026-08-26T05:52:00Z — decision: plan drafted against live code, not the spec's pinned lines
- The spec pins its source sites to `develop@33a7d00c4` and states in its own header that those line numbers drift. Every anchor was therefore re-verified against `develop@97319f09f` before planning: the defect in `buildBaseLineResult`, the two upsert coalescing sites (`commands/documents.ts:7270` and `:7764`), and the three entity→snapshot mappers (`documents.ts:2972`, `:3003`, `returns.ts:137`). All were found where the spec's symbol-led citations said they would be.

## 2026-08-26T05:52:00Z — decision: engine routing
- `om-auto-create-pr` drafted 24 Steps against a `LOOP_STEP_THRESHOLD` of 20 and handed the run to `om-auto-create-pr-loop`. The step count was not shaved to avoid the handoff: the change genuinely spans types, the calculation engine, two command files, the validators, a component, the upgrade notes and three test layers, and the loop engine is the resumable one.

## 2026-08-26T05:52:00Z — environment note
- The reused linked worktree had no `node_modules`; a full `yarn install` was run here before any validation. It completed cleanly. Nothing was symlinked into the worktree — doing so has previously emptied the source checkout's install.

## 2026-08-26T06:05:00Z — decision: the D5 follow-up issue was filed early
- Step 0.4 has to record the D5 deferral in the spec *with a link*, and Step 7.1 was planned to file that issue. Filing it first (#5641) rather than writing a dangling "a follow-up issue will exist" sentence keeps the spec honest at every commit. Step 7.1 accordingly becomes: link it from the PR body and confirm. The Tasks table order is unchanged.

## 2026-08-26T06:05:00Z — note: the Commit column is backfilled one step late
- `git commit --amend` rewrites the SHA, so a step cannot record its own final SHA inside its own commit. Each step therefore lands with `Status: done` and its SHA filled in by the next commit; a closing plan-sync backfills the last one. `Status` is what `om-auto-continue-pr-loop` resumes from, so resumability is unaffected.

## 2026-08-26T06:10:00Z — checkpoint 1 (Steps 0.1–3.4)
- Typecheck clean on `@open-mercato/core`; 97 sales suites / 722 tests pass. The 15 new engine tests were negative-controlled against the unfixed engine and 10 of them fail there, so they lock in real behaviour.
- The checkpoint fired late (at Step 3.4 rather than 1.1) because the worktree needed `yarn install`, `yarn build:packages` and `yarn generate` — in that order — before any validation command could give a trustworthy answer.

## 2026-08-26T06:10:00Z — blocker resolved: the generate/build ordering
- `yarn generate` failed with "CLI not built" until `yarn build:packages` had run, which is exactly why the configured gate lists the build first. An earlier invocation was misreported as passing because the exit code captured belonged to a trailing `echo` rather than to yarn; every command since has had its real status captured.

## 2026-08-26T06:10:00Z — decision: the shared mapper keeps the stricter numeric coercion
- The two duplicated mappers differed in one respect: `returns.ts` guarded numeric inputs with `Number.isFinite`, `documents.ts` did not. The extracted mapper keeps the guarded version, so this is not a pure move — a `NaN` on the documents path now coerces to `0` rather than propagating. Unreachable from `numeric` columns in practice, and the safer direction, but it is a behaviour change and is flagged for review rather than buried.

## 2026-08-26T06:35:00Z — blocker found and fixed: the fix was incomplete
- Writing the Phase 4 command tests exposed a real defect in this run's own Phase 3 work. The line upsert rebuilds EVERY line of the order and runs each back through `createLineSnapshotFromInput`, which Step 3.4 had made overwrite the origin with the caller default. Untouched lines therefore lost their stored-row origin and were still re-inflated by quantity — the defect had been moved one step further down, not fixed.
- `createLineSnapshotFromInput` is now origin-preserving, which makes all twelve of its call sites correct whether they are fed raw caller input or a re-mapped snapshot. Landed as Step `3.4-fix` with the test that fails without it.

## 2026-08-26T06:40:00Z — decision: two of this run's tests were rewritten because they passed vacuously
- Negative-controlling each new suite against the reverted implementation caught two tests that passed either way. Both asserted the origin of a discount on a line that also carried a `discount_percent` — and percentage-first precedence heals such a line regardless of how its amount is tagged, so the assertion could never observe the defect. Both were moved onto amount-only lines, which is the only shape that exercises the origin at all. Recorded because the same trap will catch the next person writing tests against this contract.

## 2026-08-26T07:10:00Z — final gate green
- All eight configured `validation.commands` passed in order, none skipped: `GATE_ALL_GREEN`. Test step: 34/34 workspaces, 0 failures. The tree is clean afterwards — `yarn generate` produced no uncommitted output.
- The test step took 26 minutes because a second cezar worktree was running its own full gate on the same machine (load 20–27). Contention only; separate `node_modules`, `--env-mode=loose` on both.
- The Playwright integration suite was NOT run locally: no provisioned test environment exists for this worktree. The new integration spec ships typechecked but unexecuted here, and CI's `ephemeral-integration` job is what exercises it. Stated in `final-gate-checks.md` rather than glossed.

## 2026-08-26T07:20:00Z — review pass complete
- `om-auto-review-pr --autofix`: APPROVE, 0 blockers, 0 majors, 2 minors fixed in the pass, 1 nit declined. Submitted as a comment because GitHub rejects self-approval, so the pipeline label stays `review` rather than `merge-queue` — calling it merge-ready would misrepresent it.
- Minor 1: `lib/lineSnapshots.ts` was the only file under `lib/` importing from `commands/`, against the module's own convention. `cloneJson` moved to `lib/json.ts` with a re-export from `commands/shared.ts`, so all seven existing importers are untouched and `lib/` now imports nothing from `commands/`.
- Minor 2: the line-**delete** rebuild had no test despite sharing the upsert's origin-preservation requirement. Added, and negative-controlled — it is one of the three that fail without the fix.
- Nit declined: `toNumeric` now has a third copy. Consolidating means touching 20 call sites in `returns.ts` on a money-math PR; the risk outweighs the tidiness.

## 2026-08-26T07:25:00Z — run closed out
- PR #5640 promoted draft → ready, full label set applied with a rationale comment, summary comment posted, lock swapped from `in-progress` to `ci-monitoring`.
- #5550 closed as superseded, with a comment recording what was salvaged and crediting @pkarw's review as correct on every substantive point.
- Bounded CI follow-up started against head `f4320a7da` with the default 40-minute budget. On settle: post the CI-result comment and drop `ci-monitoring`. On exhaustion: report the local gate as this run's own evidence, name the still-pending checks, state that no further follow-up will come from this agent, and drop `ci-monitoring` anyway — leaving it on would promise a follow-up nobody is making.

## 2026-08-26T07:26:00Z — the first CI waiter reported a false settle; corrected
- The bounded waiter exited with `CI_WAIT=SETTLED` after seeing nine checks with none pending. That was wrong. The nine were only the CodeQL / scope / mutation / CLA set; the `CI for Develop&Main` workflow — which carries `prepare`, `lint`, `ds-lint`, `test`, `docker-build`, `ephemeral-integration` and the rest — had not yet registered its jobs as checks, so "no pending" meant "not scheduled yet", not "finished".
- The flaw was in the waiter's own heuristic (no pending + a stable check count), which is unsafe in the window right after a push. Replaced with one keyed on the terminal conclusion of the `CI for Develop&Main` run for the current head, which cannot be satisfied by jobs that have not been created.
- **No CI-result comment was posted on the false signal.** Reporting green off it would have been exactly the "silence is not success" failure — and on a money-math PR with a hard QA gate, a fabricated green is worse than no report at all.
- Also visible from the run list: the successive pushes in this run cancelled several in-flight CI runs. The last fully green `CI for Develop&Main` is on `85ea256e4`, which predates the two review-fix commits, so it is not evidence for the current head.
