# Notify — 2026-07-27-workflows-ux-phase1

> Append-only log. Every entry is UTC-timestamped. Never rewrite prior entries.

## 2026-07-27T08:30:00Z — run started
- Brief: Phase 1 of the workflows UX redesign — Activity Registry + schema-driven forms/pickers, SET_VARIABLE, #4230 typed OpenAPI responses, command outputSchema seam, template gallery, autosave draft layer.
- External skill URLs: none
- Decision: PR stacks on feat/workflows-ux-phase0 (unmerged) — Phase 1 forms build on Phase 0 dialogs; branching develop would guarantee conflicts. Retarget after #4532 merges.

## 2026-07-27T10:40:00Z — checkpoint 1
- Steps 1.1..1.4 (b69f2b664..a669adaad): registry core complete; build/generate/typecheck green; 737 workflows tests (executor suite unedited — BC proof held).
- Executor delegations: one sequential executor per step.

## 2026-07-27T13:10:00Z — checkpoint 2
- Steps 2.1..4.3 (352ccb1c4..fd323ee66) verified: build/generate/typecheck/i18n green; 779 workflows tests.
- SET_VARIABLE merge semantics decided: path-patch at the two existing sync merge points; async keeps namespaced result.
- Executor delegations: one sequential executor per step; 4.1's missed CrudForm activity-type select folded into 4.2.

## 2026-07-27T15:30:00Z — checkpoint 3
- Steps 4.4..4.6 (8ded5a899..be5841f08): Phase 4 closed — every activity type edits through a schema form; JSON demoted to Advanced everywhere. 810 workflows tests green.

## 2026-07-27T18:20:00Z — checkpoint 4
- Steps 5.1..8.1 (cdbeadb4e..a830038a2) verified: 844 core + 141 shared tests; migration reviewed clean (single table, no unrelated output).

## 2026-07-28T01:30:00Z — final gate passed
- Validation green (build:app needed 7.1-review-fix: static template imports + executor binding seam; base A/B test proved regression ours). Integration: 1699 passed; TC-WF-011 toast-literal assertion aligned + proven 5/5 scoped; onboarding failures same unrelated-env signature as Phase 0.
- DS CLEAN (advisories landed in 7.2-ds-fix). Code review REQUEST_CHANGES → all majors fixed in 3.1-review-fix (second worker switch unified via executeRegistryActivity; SET_VARIABLE async refusal + proto-pollution guard).

## 2026-07-28T02:20:00Z — run complete
- PR: https://github.com/open-mercato/open-mercato/pull/4551 (undrafted, APPROVED via comment, merge-queue + needs-qa; stacked on #4532 — merge order documented)
