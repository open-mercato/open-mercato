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

PR: #4506

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Extract the long-form sections

- [x] 1.1 Create `.ai/docs/pr-workflow.md` — 647ffa641
- [x] 1.2 Create `.ai/docs/official-modules.md` — 647ffa641

### Phase 2: Rewrite the root AGENTS.md under budget

- [x] 2.1 Condense the Task Router — 1993e3971
- [x] 2.2 Replace extracted sections with summaries and links — 1993e3971
- [x] 2.3 Keep the precise post-cutoff rules in the root file — 1993e3971

### Phase 3: Automated budget check

- [x] 3.1 Add `scripts/check-agents-md-budget.mjs` — a8db4b9ed
- [x] 3.2 Add `yarn agents:check-budget` and wire it into CI — a8db4b9ed
- [x] 3.3 Add unit tests for the checker — a8db4b9ed
- [x] 3.4 Document the budget in the root `AGENTS.md` — 1993e3971, a8db4b9ed

### Phase 4: Validation

- [x] 4.1 Run the validation gate

### Phase 5: Keep the branch mergeable

- [x] 5.1 Merge `develop` and re-apply the two upstream `AGENTS.md` rules in the new layout

## Outcome

- Root `AGENTS.md`: 44,393 → 29,688 bytes (9.4% under Codex's 32,768-byte default budget, and
  under the 30,720-byte root limit the checker enforces). No rule was dropped; the long-form
  label policy, official-modules contract, boundary-label definitions and the Docker/local
  validation-runner procedure now live in `.ai/docs/`.
- `yarn agents:check-budget` (+ CI step, + 7 `node --test` cases) enforces the root limit and
  ratchets the four representative root-to-module chains, which are still 32–100 KiB over budget
  and can now only shrink.
- Validation: `node --test scripts/__tests__/*.test.mjs` → 307 passed; `node --test
  apps/mercato/scripts/__tests__/*.test.mjs` → 24 passed (this mirrors the CI `yarn test:scripts`
  step; the worktree has no local `node_modules`, so the yarn wrapper was bypassed). No
  TypeScript, locale or app source changed, so the build/typecheck/i18n legs of the gate are not
  affected by this diff.
- Phase 5 (`develop` merge): `develop` had meanwhile added two rules to the root `AGENTS.md` —
  the automated-verification QA exemption (#4461) and the `triage`-permission caveat on the
  self-QA exception (#4478). Both were re-applied in the new layout: verbatim in
  `.ai/docs/pr-workflow.md`, condensed to one boundary bullet each in the root. `.github/
  workflows/ci.yml` and `package.json` merged without conflicts, so the new `lint:check-graph`
  step and the `postcss` bump sit alongside the budget step. Re-validated: root at 30,400 bytes
  (320 free under the 30,720 limit), `node scripts/check-agents-md-budget.mjs` passes, 314 + 24
  `node --test` cases pass.
