# Execution plan — CrudForm group visibility (`hiddenGroupIds`)

Source doc: `.ai/specs/2026-09-04-crudform-group-visibility.md`
Spec PR: #5885
Issue: #5876
Engine: om-auto-create-pr (steps: 7, --loop: no)

## Goal

Give `CrudForm` hosts one additive, optional prop — `hiddenGroupIds?: readonly string[]` — that hides declared groups by their stable `CrudFormGroup.id`, so a host can drop built-in cards without copying the page. Hiding is presentation-only: the submitted payload is unchanged.

## Scope

- `packages/ui/src/backend/CrudForm.tsx` — the prop, the single-chokepoint filter, the all-hidden guard, and the hidden-only field exclusion from the two validation gates.
- `packages/ui/src/backend/__tests__/CrudForm.hiddenGroups.test.tsx` — new unit coverage.
- A customers-facing example test proving `createCompanyFormGroups` renders with groups omitted and no page copy.
- `packages/ui/AGENTS.md` — one entry documenting the seam.

## Non-goals

- No predicate/callback visibility API (explicitly deferred in the spec's Q1).
- No conditional-form rules engine.
- No renaming of existing customer group ids.
- No change to which company groups a real page shows — the example ships as a test, not a new page.
- No change to `allFields`, `placedCustomFieldIds`, or the submit payload — those staying unfiltered is the mechanism, not an oversight.

## Risks

- The `useGroupedLayout` edit (Step 1.3) touches a line every grouped form depends on; without the all-hidden guard, hiding every group would fall through to the flat layout and render every field ungrouped. Mitigated by explicit non-regression assertions for all three layout modes.
- `hiddenGroupIds` identity churn could disturb `useGroupOrder`'s documented content guard (#4386 / #4691). Mitigated by memoising the set on a joined string key.
- Excluding hidden-only fields from the required gate must not also excuse a field that is present in a visible group. Mitigated by computing the set as "in hidden groups minus in visible groups" and testing the shared-field case.

## Implementation Plan

### Phase 1: The `hiddenGroupIds` mechanism

- 1.1 Declare `hiddenGroupIds?: readonly string[]` on `CrudFormProps` with JSDoc and destructure it.
- 1.2 Add the memoised `hiddenGroupIdSet` and filter `resolvedGroupsForLayout`; dev-only warn on ids matching no declared group.
- 1.3 Add the all-hidden guard to `useGroupedLayout` via a pre-filter `declaredGroupCount`.
- 1.4 Add `hiddenGroupFieldIds` (hidden-only field ids) and consult it in the blur validator and the built-in required gate.

### Phase 2: Coverage and documentation

- 2.1 Add `CrudForm.hiddenGroups.test.tsx` covering absence-preserves-behavior, single hidden group, unknown id, mixed columns, injected widget group, customFields group, collapsible, sortable, validation focus, and submit payload semantics.
- 2.2 Add the customers company-form example test showing built-in groups omitted without copying the page.
- 2.3 Document the prop in `packages/ui/AGENTS.md` under CrudForm Guidelines.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: The `hiddenGroupIds` mechanism

- [x] 1.1 Declare the prop on CrudFormProps — ba17abe2e
- [x] 1.2 Filter resolvedGroupsForLayout at the chokepoint — ba17abe2e
- [x] 1.3 Add the all-hidden layout guard — ba17abe2e
- [x] 1.4 Exclude hidden-only fields from the validation gates — ba17abe2e

### Phase 2: Coverage and documentation

- [x] 2.1 Unit coverage for hidden groups — c5a28c361
- [x] 2.2 Customers company-form example test — 83f273572
- [x] 2.3 Document the prop (landed in apps/docs — the packages/ui AGENTS.md chain is over budget and may only shrink) — 83f273572
