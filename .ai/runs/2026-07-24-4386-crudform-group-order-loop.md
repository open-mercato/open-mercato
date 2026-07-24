# Execution plan — stop the `useGroupOrder` render loop (#4386)

Retrofitted after the fact: the original run shipped this PR without an `om-auto-create-pr`
tracking plan. This file restores the contract so `om-auto-continue-pr` / `om-auto-fix-pr`
can resume the run, and records the CI-stabilization work that follows.

## Goal

`CrudForm`'s group-order hook must never write state from a `defaultGroupIds` value that
the host recreates on every render, so mounting a `CrudForm` under jsdom cannot spin the
passive-effect flush into "Maximum update depth exceeded" (#4386).

## Scope

- `packages/ui/src/backend/crud/useGroupOrder.ts` — hold only the saved user preference in
  state; derive the effective order during render.
- `packages/ui/src/backend/crud/__tests__/useGroupOrder.test.ts` — lock the new invariants
  in without weakening the eight pre-existing behavior tests.

## Non-goals

- No change to the group-order storage format (`om:group-order:<pageType>`) or to the
  drag-and-drop UX.
- No refactor of `CrudForm`'s memo chain beyond what the fix requires.
- No unrelated DataTable / integration-test work on this branch.

## Implementation plan

### Phase 1: Fix the hook

- 1.1 Replace the two state-sync effects with render-time derivation (state = saved
  preference only; `orderedIds` = `mergeOrder(saved, defaults)`), keeping a stable array
  identity for consumers.
- 1.2 Extend the hook's unit tests: stable identity across equal-content re-renders, plus a
  loop repro that fails against the previous implementation.

### Phase 2: Land it green

- 2.1 Rebase/merge the current base branch so CI judges the real merge result.
- 2.2 Drive CI green (`om-auto-fix-pr --ci-only`) and diagnose any red check from its logs.
- 2.3 Restore the missing `om-auto-create-pr` artifacts: this plan, the templated PR body
  with the `Tracking plan:` line, and the summary comment.

## Risks

- The hook is consumed by every grouped `CrudForm`, so a regression would be broad — covered
  by the ten unit tests in `useGroupOrder.test.ts`; no visual or storage-format change.
- `ephemeral-integration (8/15)` (`TC-CRM-086`, DataTable column resize) has been red on this
  head three times while passing on other PRs. Diagnosis is in progress: base drift is the
  first hypothesis (this branch was 19 commits behind), a genuine test-state leak the second.
  It is out of this PR's blast radius either way — `useGroupOrder` has exactly one consumer
  (`CrudForm`) and the failing test never mounts one.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

PR: #4411

### Phase 1: Fix the hook

- [x] 1.1 Derive the order during render instead of syncing it through effects — 9f99a044
- [x] 1.2 Extend the hook unit tests with the identity and loop-repro cases — 9f99a044

### Phase 2: Land it green

- [x] 2.1 Merge the current base branch into the PR head
- [ ] 2.2 Drive CI green and diagnose the red `ephemeral-integration (8/15)` check
- [ ] 2.3 Restore the PR body template, tracking-plan line, and summary comment
