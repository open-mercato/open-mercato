# Execution plan — harness backward-compatibility guidance and the routing duration budget

Issues: [#5058](https://github.com/open-mercato/open-mercato/issues/5058), [#5057](https://github.com/open-mercato/open-mercato/issues/5057)
Source analysis: `.ai/analysis/2026-07-28-harness-module-fact-coverage-and-budget-audit.md` (§2.5, §3.1)
Engine: om-auto-create-pr (steps: 12, --loop: no)

## Goal

Close the guidance defect #5058 describes at the level where it can still bite — the routed chain of the
cases that are *registered* as backward-compatibility cases — and settle #5057's duration-budget contract
with a decision backed by what the evaluator actually does today, not by the audit's pre-`dd2c172e` numbers.

## Scope

Both issues were written against the state of `develop` on 2026-07-28. Upstream commit `dd2c172e`
("fix(harness): tighten residual routing contracts", 2026-07-29) moved both premises, so step 1 of each
phase is to re-establish what is actually true before changing anything.

- `packages/create-app/agentic/shared/ai/skills/**` — route-level pointers to the compatibility guide
- `packages/create-app/agentic/shared/ai/harness/RELEASE.md` — the documented duration margin
- `packages/create-app/src/lib/context-guidance-contracts.test.ts` — the guidance guard
- `packages/create-app/src/lib/agent-harness-evaluator.test.ts` — the duration-contract pin

**Non-goals**

- No change to `cases.json` budgets, no new cases, no case renumbering (that is #5038's surface — it is
  open on the same file and must not be conflicted with).
- No change to `MAX_REFUSED_CONTEXT_READS`, catalog-wide budgets, or the writable `timeoutMs` contract.
- No move or rename of `.ai/guides/upstream/BACKWARD_COMPATIBILITY.md` (a case-context contract surface).

## Implementation Plan

### Phase 1 — Re-establish the facts

Scaffold a controller, run the deterministic gate, and run the live cases the issues name so the PR
reports measured state rather than the audit's.

### Phase 2 — #5058: route-level compatibility guidance

The audit's OMH-169 finding was resolved upstream by dropping the required path from the case. What
survives is the asymmetry that let it exist: a case can sit in `compatibilityRequiredCaseIds` while
nothing in its routed chain, beyond one generic root line, points at the guide. Add the missing
route-level pointers and make the property enforceable.

### Phase 3 — #5057: decide the duration-budget contract

Record the decision and its evidence, document the margin, and pin the chosen behaviour with a test.

### Phase 4 — Live re-verification and the full gate

Re-run the affected live cases, then the ordered `validation.commands` gate.

## Risks

- Adding prose to a routed `SKILL.md` or guide grows every case's measured initial context; the
  deterministic gate's `required context exceeds maxInitialContextBytes` check is the guard, and Phase 4
  re-runs it. Keep additions to one sentence.
- Live runs are model-variance-bound; a single failing run is not evidence on its own. Report run counts.
- `cases.json` is also touched by open PR #5038; this run must not edit it.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Re-establish the facts

- [ ] 1.1 Scaffold a controller root with `agentic:init --tool claude-code` and run the deterministic gate
- [ ] 1.2 Map the compatibility-required cohort against its routed guidance and record the gaps
- [ ] 1.3 Run OMH-169 live and record whether the issue's repro still reproduces

### Phase 2: #5058 route-level compatibility guidance

- [ ] 2.1 Add the missing route-level pointers for the cases whose chain carries none
- [ ] 2.2 Add the deterministic guard that every compatibility-required case routes a pointer

### Phase 3: #5057 duration-budget decision

- [ ] 3.1 Record the decision and its evidence in the harness release notes
- [ ] 3.2 Pin the routing-vs-writable `timeoutMs` contract with a deterministic test

### Phase 4: Live re-verification and the gate

- [ ] 4.1 Re-run the affected live cases and record the result
- [ ] 4.2 Run the full validation gate
