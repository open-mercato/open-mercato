# Harness module-fact coverage and case-budget audit (#4565)

Source issue: [#4565](https://github.com/open-mercato/open-mercato/issues/4565) — follow-up from #4529.
Related: #4529 (parent, unmerged), #4556 (OMH-188/189, stacked parent of this branch).
Audit report: `.ai/analysis/2026-07-28-harness-module-fact-coverage-and-budget-audit.md`.

## Why

PR #4529 uses catalog budgets and module-fact coverage as release evidence. The reviewer asked for two
things this branch delivers: an inventory of every shipped module-fact file against the catalog, and an
audit of whether case-local budgets are tighter than their tasks genuinely need.

Both were measured against a real scaffolded controller (`mercato agentic:init` into an empty app root),
not estimated: the controller ships exactly 47 module fact-sheets, and every case budget was compared
against the on-disk byte size of the context that case declares.

## Scope

- Inventory all 47 shipped fact-sheets against `context.required`, `context.allowedExtra`, `owner.path`,
  and prompt/title/tag text.
- Add routing cases for the capabilities with no catalog trace at all.
- Audit case-local file, byte, refused-read, and duration budgets from measured footprints and clean
  live traces.
- Keep global safety, write, oracle, and review limits unchanged.

## Progress

PR: #4602
Follow-up: #4603

- [x] 1.1 Materialise a faithful controller and establish the pre-change baseline — deterministic
      189/189 on the stacked parent's exact bytes
- [x] 1.2 Inventory every shipped fact-sheet against catalog context, owner, and prompt coverage —
      47 shipped, 6 with no trace at all (`configs`, `gateway_stripe`, `perspectives`, `resources`,
      `sync_akeneo`, `sync_excel`)
- [x] 1.3 Measure every case's declared-context footprint against its own budgets — three
      contradictions found (OMH-111, OMH-146, OMH-169)
- [x] 2.1 Add OMH-190…OMH-195 for the six uncovered capabilities, following the OMH-188/189 shape
      (facts owner, observed architecture guide, observed fact-sheet, and the governing skill —
      `om-help` on the discovery-framed three, `om-integration-builder` on the provider-framed three)
- [x] 2.2 Align the catalog size everywhere: `validators.json`, `cases.schema.json` (`minItems`,
      `maxItems`, `id`/`relatedCases` patterns), harness README/RELEASE, package README, spec
- [x] 3.1 Widen the three contradictory budgets from measured footprints; global caps untouched
- [x] 3.2 Make the deterministic gate measure declared context on disk and reject budgets a case
      cannot satisfy, so this class cannot return silently
- [x] 3.3 Regression test proving the new rule fails on the pre-fix state and passes after
- [x] 4.1 Build guard: every module fact-sheet a scaffold ships must be routed by at least one case
- [x] 4.2 Semantic assertions for OMH-190…195 in `agent-surface-coverage.test.ts`
- [x] 4.3 Live before/after evidence for the budget fixes and live runs for the six new cases —
      OMH-169's `initial context byte budget exceeded: 57372/57344` reproduced before and gone after;
      OMH-190/191/192 pass first try; OMH-193/194/195 retargeted to the skill live routing selects — f8af90d77
- [x] 5.1 Full configured validation gate — 8/8 commands green. `yarn test` needed two runs: each
      lost one random jest worker to `SIGSEGV` (`ui/primitives/tag`, then `cli/testing/integration`)
      with zero assertion failures, and every affected suite passes in isolation. Across the two runs
      `core` 1033/1033, `ui` 206/206, `enterprise` 57/57, `create-app` 335 pass / 5 skipped.
- [x] 5.2 Audit report committed under `.ai/analysis/` — c6e4f8afb
- [x] 5.3 Follow-up issue for the `allowedExtra`-only coverage tier — #4603
- [x] 5.4 Review pass (`om-auto-review-pr`): one Minor finding fixed — the new rule's
      `maxTotalContextBytes` arm had no assertion and measures fact-sheets as zero in a staged
      fixture; the regression test now isolates that arm and mirrors the evaluator's initial-path
      rule. Three nits fixed: the fact-sheet guard comment no longer implies it asserts the
      `allowedExtra` tier, and the audit report names #4603 and records the measurement
      boundary — 625bc0c73

## Deliberately out of scope

- The 11 fact-sheets that appear only in `context.allowedExtra`: no case fails when an agent ignores
  them, but they are not "uncovered" in the sense the issue names. Recorded in the audit report and
  handed to a follow-up rather than grown into this branch.
- Global limits: `catalog.maxContextFiles` (16), `catalog.maxInitialContextBytes` (90112),
  `catalog.maxTotalContextBytes` (262144), `MAX_REFUSED_CONTEXT_READS` (6), and every write, oracle,
  and review limit are unchanged.
