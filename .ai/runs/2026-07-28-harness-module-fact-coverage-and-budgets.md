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

- [x] 1.1 Materialise a faithful controller and establish the pre-change baseline — deterministic
      189/189 on the stacked parent's exact bytes
- [x] 1.2 Inventory every shipped fact-sheet against catalog context, owner, and prompt coverage —
      47 shipped, 6 with no trace at all (`configs`, `gateway_stripe`, `perspectives`, `resources`,
      `sync_akeneo`, `sync_excel`)
- [x] 1.3 Measure every case's declared-context footprint against its own budgets — three
      contradictions found (OMH-111, OMH-146, OMH-169)
- [x] 2.1 Add OMH-190…OMH-195 for the six uncovered capabilities, following the OMH-188/189 shape
      (facts owner, `om-help`, observed architecture guide, observed fact-sheet)
- [x] 2.2 Align the catalog size everywhere: `validators.json`, `cases.schema.json` (`minItems`,
      `maxItems`, `id`/`relatedCases` patterns), harness README/RELEASE, package README, spec
- [x] 3.1 Widen the three contradictory budgets from measured footprints; global caps untouched
- [x] 3.2 Make the deterministic gate measure declared context on disk and reject budgets a case
      cannot satisfy, so this class cannot return silently
- [x] 3.3 Regression test proving the new rule fails on the pre-fix state and passes after
- [x] 4.1 Build guard: every module fact-sheet a scaffold ships must be routed by at least one case
- [x] 4.2 Semantic assertions for OMH-190…195 in `agent-surface-coverage.test.ts`
- [ ] 4.3 Live before/after evidence for the budget fixes and live runs for the six new cases
- [ ] 5.1 Full configured validation gate
- [ ] 5.2 Audit report committed under `.ai/analysis/`
- [ ] 5.3 Follow-up issue for the `allowedExtra`-only coverage tier

## Deliberately out of scope

- The 11 fact-sheets that appear only in `context.allowedExtra`: no case fails when an agent ignores
  them, but they are not "uncovered" in the sense the issue names. Recorded in the audit report and
  handed to a follow-up rather than grown into this branch.
- Global limits: `catalog.maxContextFiles` (16), `catalog.maxInitialContextBytes` (90112),
  `catalog.maxTotalContextBytes` (262144), `MAX_REFUSED_CONTEXT_READS` (6), and every write, oracle,
  and review limit are unchanged.
