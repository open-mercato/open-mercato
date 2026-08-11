# Raise the harness release routing case-timeout default

Closes #5078. Follow-up from #5068, which settled the routing duration-budget contract and corrected the
`RELEASE.md` paragraph describing it, but deliberately left the code question open.

## Goal

Settle whether `yarn harness:release` should keep passing `--timeout` explicitly to the evaluator for every
routing step, and make the resulting budget match the routing durations actually measured. The decision is
**keep the explicit pass-through and raise the release default** from 120000 ms to 600000 ms.

## Decision and why

The release gate builds two coupled budgets from one operator value
(`agentic/shared/scripts/run-agent-harness-release.mjs:1619-1623`): the per-case ceiling handed to the
evaluator as `--timeout`, and the routing step's own process budget, computed as
`60000 + sum(effectiveCaseTimeout(case, options.caseTimeout))` — exactly the sum of the inner ceilings plus
slack. That equality is the invariant this step relies on to fail a single slow case rather than killing the
whole routing step.

The alternative the issue names — pass `--timeout` only when the operator set `--case-timeout`, letting
`resolveLiveCaseTimeout` apply its runner-aware floors — breaks that invariant. The inner ceiling would rise
to the runner floor while the outer budget stayed derived from `options.caseTimeout`, so a run of slow cases
would exhaust the step's process budget and lose every routing result instead of failing one case. Repairing
that requires changing the outer computation too, so it is not the one-line change it appears to be.

Two further facts argue against it. First, the release path never passes `--reasoning-effort` and its Codex
`modelSelector` is `default`, not `gpt-5.4-mini`, so the 900000 ms floor is unreachable there regardless of
this decision; the floors would deliver 600000 ms for Claude and 300000 ms for Codex — and 300000 ms is the
exact ceiling OMH-139 already exhausted. Second, a runner-dependent ceiling makes the primary and portability
lanes carry different budgets, which blurs the release report's runner comparison: a Codex timeout would no
longer distinguish a slower model from a tighter budget.

Raising the flat default preserves the invariant, keeps the budget runner-independent, keeps the three
`--timeout` pass-throughs (routing `:1619`, writable `:1651`, review `:1711`) consistent, and keeps
`--case-timeout` meaning what its name says. 600000 ms is chosen because it clears the slowest audited passing
routing run with margin, matches the Claude floor, and matches the `timeoutMs` ceiling `cases.schema.json`
already enforces, so the gate carries one upper number instead of three.

## Evidence, and the deviation from acceptance criterion 1

The issue asks for the measurement to come from driven `yarn harness:release` runs on both runners. That is
not reachable here: the complete release gate fails closed off Linux-with-Bubblewrap (`RELEASE.md`, host
prerequisites), and this work runs on macOS. The decision therefore rests on evaluator-path evidence, and this
deviation is recorded explicitly in the PR body and in `RELEASE.md` rather than left implied:

- `.ai/analysis/2026-07-28-harness-module-fact-coverage-and-budget-audit.md` §2.5 — passing routing runs
  spanned 71 s to 231 s; the same case measured 147 s and 132 s across two runs of one model; OMH-139
  exhausted the evaluator's 300000 ms default outright.
- #5068's live evidence (`claude` 2.1.223 / `sonnet`) — OMH-007 pass at 100397 ms, OMH-048 pass at 86483 ms,
  OMH-064 at 521990 ms over two attempts (failing on the context byte budget, not on time).

Every one of those numbers exceeds or approaches the 120000 ms release default, which is the defect this
closes.

## Scope

- Raise the release `--case-timeout` default and its `--help` text.
- Extract the routing step's invocation into an exported helper and pin its argv and process budget with
  tests, so the release path's timeout behaviour cannot drift away from its documentation again.
- Restate the duration-budget paragraph in `agentic/shared/ai/harness/RELEASE.md` for the new default and
  record the measurement deviation.

## Non-goals

- No change to `resolveLiveCaseTimeout`, to the runner-aware floors, or to the evaluator's own default.
- No change to the writable (`:1651`) or review (`:1711`) pass-throughs, which already resolve a per-case
  ceiling before passing it.
- No change to the catalog guard that keeps `timeoutMs` writable-only, and no new case-local durations.
- No driven live release run; see the deviation above.

## Implementation Plan

### Phase 1: Raise the release routing budget

- Raise `caseTimeout` from 120000 ms to 600000 ms in `parseArgs` and update the `--case-timeout` line in the
  help text so the two cannot disagree.
- Update the existing `#5057` help-text assertion, which pins the documented default.

### Phase 2: Pin the routing step's argv contract

- Extract `routingInvocation` from the routing loop as an exported function returning the evaluator argv and
  the step's process budget, and call it at the existing site with no behavior change.
- Add a regression test asserting the argv carries `--timeout` with the operator value, that the primary lane
  adds `--all` while the portability lane does not, and that the process budget equals the slack plus the sum
  of per-case ceilings with a declared writable `timeoutMs` raising its own slot and never lowering another.

### Phase 3: Documentation

- Restate the duration-budget paragraph in `RELEASE.md` for the raised default, keep the statement that the
  evaluator's runner-aware floors never fire under `yarn harness:release`, and record the acceptance-criterion
  deviation and the evidence behind the chosen value.

## Risks

- The routing step's worst-case wall clock rises with the ceiling: over the shipped catalog the primary lane's
  process budget grows from 28620000 ms to 127860000 ms, roughly 7.9 h to roughly 35.5 h. That is a cap on a
  hung run, not an expected duration — a healthy pass at the audited per-case durations lands far below it — but a
  genuinely stuck case now burns ten minutes before failing instead of two. The `RELEASE.md` note tells an
  operator to lower `--case-timeout` when they want a faster failure.
- Extracting `routingInvocation` touches a live release path; the extraction must be behavior-preserving and
  is asserted against the existing call site's shape rather than rewritten.
- `agent-surface-coverage.test.ts` rejects any stated case count in `RELEASE.md` that is neither the shipped
  catalog nor the portability sample, so the reworded paragraph must not introduce a new "N cases" phrasing.

## Progress

PR: #5180

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Raise the release routing budget

- [x] 1.1 Raise the release case-timeout default and its help text — 49b686f42
- [x] 1.2 Update the existing help-text assertion for the new default — 49b686f42

### Phase 2: Pin the routing step's argv contract

- [x] 2.1 Extract an exported routingInvocation helper at the routing call site — 49b686f42
- [x] 2.2 Add the routing argv and process-budget regression test — 49b686f42

### Phase 3: Documentation

- [x] 3.1 Restate the RELEASE.md duration-budget paragraph and record the deviation — 935c02616

### Phase 4: Review follow-through

- [x] 4.1 Fix the two majors the review pass raised — cdf39888b
- [x] 4.2 File the deferred minor as a follow-up issue — #5184

## Validation outcome

Local runner (no compose `app` container running). `build:packages` → `generate` → `build:packages` →
`i18n:check-sync` → `i18n:check-usage` → `typecheck` → `build:app` all green.

`yarn test` aborted twice on a jest worker `SIGSEGV` inside `@open-mercato/cli`, on a different suite each
time and with zero failed assertions; `yarn workspace @open-mercato/cli test --runInBand` then passed 81/81
suites and 1480/1480 tests, which identifies it as a worker-crash flake rather than a regression.
`yarn workspace create-mercato-app test` reported 466 passed / 5 skipped (the Bubblewrap-only lanes) / 1
failed on `ENOTEMPTY: dist/agentic` from a concurrent package build; that file alone passes 11/11. Neither
failure reads a file in this diff.

## Review outcome

`om-auto-review-pr 5180 --autofix` found no blockers, two majors and one minor. Both majors were fixed in
this PR (`cdf39888b`): the `timeoutMs` raise mechanism is inert at the new default because the schema caps it
at exactly that value, and the raised default governs the writable and review lanes as well as routing —
neither was stated. The minor, the deterministic step budgeting its process from the per-model ceiling
(`run-agent-harness-release.mjs:1598`), predates this change and needs its own measured value, so it was
filed as #5184 instead of guessed at here. The verdict was submitted as a comment review because GitHub does
not permit self-approval; the PR keeps the `review` pipeline label until a maintainer approves it.
