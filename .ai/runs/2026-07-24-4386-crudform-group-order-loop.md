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

### Phase 3: Close the QA gate

- 3.1 Run the code review the CI-blocked first pass never reached, and file any non-blocking
  findings as a separate issue rather than growing this PR.
- 3.2 Hand-verify the changed UI in a browser and post screenshot evidence, because the diff
  lives under `packages/ui/src/` and therefore cannot take the automated-verification
  `skip-qa` exemption in `AGENTS.md`.

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
- [x] 2.2 Drive CI green and diagnose the red `ephemeral-integration (8/15)` check
- [x] 2.3 Restore the PR body template, tracking-plan line, and summary comment

### Phase 3: Close the QA gate

- [x] 3.1 Re-review the diff now that CI is green (APPROVED, 3 nits) and move the nits off this PR
- [x] 3.2 Verify the changed UI in a real browser and post the evidence on the PR

## Verification record (2026-07-30 resume)

Each Phase 2 checkbox was re-derived from the tracker and the repository rather than trusted
as written, because the run that wrote them stopped mid-flight.

- **2.2 — done before this resume.** Workflow run `30123338840` on head `40951cdb` reports
  **20 pass, 0 fail, 3 skipping**; the shard the first review blocked on,
  `ephemeral-integration (8/15)`, passes in 17m58s on the same code. The red-check diagnosis
  the step asked for also landed: the failure is `TC-CRM-086` (DataTable column resize), now
  tracked on its own as #4545, and it is red on `develop` itself.
- **2.3 — was two-thirds done.** The PR body already carried the full template and the
  `Tracking plan:` line, so those parts were real. The third artifact, the comprehensive
  summary comment, did **not** exist — the 2026-07-24 comments are CI notes, not a summary.
  This resume posted it, which is what completed the step.
- **3.1 — the 2026-07-30 re-review is the code review this plan owed.** Verdict APPROVED,
  0 blockers / 0 majors / 0 minors / 3 nits. The nits are optional hardening
  (`reorder` ref composition, a `useMemo` that memoizes nothing in the fixed scenario, an
  undocumented render-time ref mutation) and moved to #4692 instead of growing this PR: all
  three are unreachable or cosmetic today, and re-rolling 15 integration shards against the
  #4545 flake to land them would risk the green run this PR waited six days for.
- **3.2 — 12/12 checkpoints PASS.** The diff sits under `packages/ui/src/`, so the
  automated-verification exemption does not apply and the PR needs `needs-qa`, not `skip-qa`
  (the earlier `skip-qa` request in the PR body and review was wrong on that rule).
  Browser evidence covers all three `sortableGroups` call sites — `deal-detail-v3`,
  `company-v2`, `person-v2` — plus reorder, persistence, reload hydration, stale-preference
  merging, a mobile viewport, and a console audit that found zero
  `Maximum update depth exceeded` entries.

Labels remain a maintainer action: this account has no `triage` permission, so every
`AddLabelsToLabelable` call in this run was attempted and rejected with 403.
