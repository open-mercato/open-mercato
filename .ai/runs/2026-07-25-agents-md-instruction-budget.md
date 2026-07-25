# Fit the root AGENTS.md into Codex's 32 KiB instruction budget (#4484)

## Goal

Bring the repository-level agent harness back inside Codex's default
`project_doc_max_bytes` (32,768 bytes) so the whole root `AGENTS.md` reaches the model on
the first turn, and add an automated check so neither the root file nor the representative
root-to-module instruction chains can grow past the budget unnoticed again.

## Scope

- Restructure the root `AGENTS.md`: keep every hard rule, boundary and routing row, move the
  long-form procedural detail into referenced docs under `.ai/docs/`.
- New extracted docs: `.ai/docs/pr-workflow.md` (full label taxonomy, QA gate, auto-skill
  claim protocol) and `.ai/docs/official-modules.md` (submodule + activation guidance).
- New `scripts/check-agents-md-budget.mjs` + `yarn agents:check-budget`, wired into the CI
  quality job and covered by `node --test` unit tests.
- Chain budgets (root + nested `AGENTS.md`) enforced as a ratchet against a committed
  baseline, because several package files (e.g. `packages/ai-assistant/AGENTS.md`, 103 KiB)
  are far over budget today and cannot be rewritten in this PR.

### Non-goals

- Rewriting the oversized package-level `AGENTS.md` files. The ratchet freezes them at
  today's size and makes the overflow visible; shrinking them is follow-up work.
- Touching `packages/create-app/template/AGENTS.md` — the standalone template harness is
  being rebuilt in #4483 (maintainer's explicit instruction on the issue).
- Changing any behavioural rule the harness states. This is a relocation + condensation
  pass, not a policy change.

## Implementation Plan

### Phase 1 — Extract the long-form sections

1.1 Create `.ai/docs/pr-workflow.md` carrying the complete label taxonomy, priority/risk
inference tables, QA-approval gate, self-QA exception and auto-skill claim protocol.
1.2 Create `.ai/docs/official-modules.md` carrying the `external/official-modules` submodule
contract (activation, module-id convention, commit routing, cross-cutting merge order).

### Phase 2 — Rewrite the root AGENTS.md under budget

2.1 Condense the Task Router while preserving every row's destination.
2.2 Replace the extracted sections with short summaries + links; condense Monorepo
Structure, Workflow Orchestration and Key Commands.
2.3 Keep the precise rules the issue calls out (pageSize ≤ 100, no `any`, DS token rules,
migration/snapshot workflow, UI mutation/error/JSON/conflict helpers) in the root file.

### Phase 3 — Automated budget check

3.1 Add `scripts/check-agents-md-budget.mjs`: hard limit on the root file, chain ratchet
against `scripts/agents-md-budget.baseline.json`, `--update-baseline` maintenance flag.
3.2 Add `yarn agents:check-budget` and wire it into `.github/workflows/ci.yml` (quality job).
3.3 Add `scripts/__tests__/check-agents-md-budget.test.mjs` covering root overflow, chain
regression, and the passing case.
3.4 Document the budget in the root `AGENTS.md` so contributors know the constraint exists.

### Phase 4 — Validation

4.1 Run the configured validation gate (`yarn test:scripts`, plus the doc-relevant checks).

## Risks

- **Information loss during condensation.** Mitigated by moving text verbatim into
  `.ai/docs/*` and linking from the Task Router / the section that used to hold it.
- **Baseline churn.** The ratchet fails when a package `AGENTS.md` grows; contributors must
  either shrink it or run `--update-baseline` deliberately. The failure message says so.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Extract the long-form sections

- [ ] 1.1 Create `.ai/docs/pr-workflow.md`
- [ ] 1.2 Create `.ai/docs/official-modules.md`

### Phase 2: Rewrite the root AGENTS.md under budget

- [ ] 2.1 Condense the Task Router
- [ ] 2.2 Replace extracted sections with summaries and links
- [ ] 2.3 Keep the precise post-cutoff rules in the root file

### Phase 3: Automated budget check

- [ ] 3.1 Add `scripts/check-agents-md-budget.mjs`
- [ ] 3.2 Add `yarn agents:check-budget` and wire it into CI
- [ ] 3.3 Add unit tests for the checker
- [ ] 3.4 Document the budget in the root `AGENTS.md`

### Phase 4: Validation

- [ ] 4.1 Run the validation gate
