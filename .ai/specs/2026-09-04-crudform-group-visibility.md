# CrudForm group visibility — hide built-in groups by stable id

## 📝 TLDR

`CrudForm` hosts that need a smaller form today have only one option: copy the whole page and rebuild the `groups` array, which couples standalone apps to core component internals just to drop a card. This spec adds one additive, optional prop — `hiddenGroupIds?: readonly string[]` — that filters groups by their stable `CrudFormGroup.id` before layout, so a host can omit built-in cards while keeping every other field, injected widget, and default behavior intact. Hiding is **presentation-only**: the submitted payload is byte-for-byte what it would have been without the prop. Absent the prop, `CrudForm` behaves exactly as it does today.

Resolves FR [#5876](https://github.com/open-mercato/open-mercato/issues/5876). Implemented on [#5886](https://github.com/open-mercato/open-mercato/pull/5886).

## 📝 Overview

One optional `CrudForm` prop, `hiddenGroupIds`, lets a host omit named group cards from a form it does not own. Scope is deliberately narrow: it hides declared groups by id and does nothing else. It is not a conditional-form rules engine, it does not change what is submitted, and it does not let a host reorder, retitle, or inject groups — those either already exist or are explicitly out of scope per the FR.

Everything lives in `packages/ui/src/backend/CrudForm.tsx`. There is no new module, no new export beyond the prop, no schema change, and no new persisted state. Absent the prop, the component behaves byte-for-byte as it does today.

> **Anchor convention.** Line numbers in this document are hints recorded against `develop` at authoring time (2026-09-04) and drift as `CrudForm.tsx` changes — the implementation on #5886 alone shifts most of them by roughly 78 lines. The **symbol name** is the durable anchor; treat every `(~NNNN)` as "look near here", not as an address.

## 📝 Problem Statement

`CrudFormGroup` (`packages/ui/src/backend/CrudForm.tsx`, `~436`) already carries a stable `id` used for sortable order persistence, collapsible state keys, and injected-field targeting. But nothing consumes that id as a visibility key. `groups` flows straight from the prop into `groupsWithInjectedFields` (`~2060`) and then into `resolvedGroupsForLayout` (`~2089`), which every downstream consumer derives from.

The consequence is that a consumer who wants a company form without the `profile` and `customFields` cards — the ids declared in `createCompanyFormGroups` (`packages/core/src/modules/customers/components/formConfig.tsx`, `~1414`) — must either:

- replace the entire page through the component-replacement system and re-declare all five groups, inheriting the maintenance burden of every future core change to that array; or
- fork `createCompanyFormGroups` and drift from core silently.

Both couple the app to internals it does not otherwise care about. The ask is narrow and recurring: keep the page, drop named cards.

## 📝 Proposed Solution

Add one optional prop to `CrudFormProps`:

```ts
/**
 * Hide the groups whose `CrudFormGroup.id` appears in this list, so a host can
 * omit built-in cards without rebuilding the whole `groups` array.
 *
 * Presentation-only: hidden groups are removed before layout, so they reserve
 * no column space and contribute no header, sortable entry, collapsible state
 * or validation focus target. Fields that live only in a hidden group keep
 * their current values and are still submitted unchanged — hiding a group
 * never clears data. A `required` field that lives only in a hidden group is
 * skipped by the built-in required check (mirroring `visibleWhen`), but a
 * host-supplied zod `schema` is NOT bypassed: do not hide a group whose
 * fields the schema requires unless defaults supply them.
 *
 * Hiding an injection widget's card (`widget:<widgetId>`) hides the card only —
 * the widget's `onBeforeSave` / `transformFormData` handlers still run. Do not
 * hide a widget group that gates saving; disable the widget instead.
 *
 * Ids that match no declared group are ignored (dev-only warning). Strictly
 * additive: when the prop is absent or empty the form behaves exactly as
 * before.
 */
hiddenGroupIds?: readonly string[]
```

Filtering happens at exactly one place — `resolvedGroupsForLayout` — because every layout and rendering consumer already derives from it. That keeps the change surface to a handful of lines rather than threading a predicate through five call sites.

### Alternatives considered

| Alternative | Why it lost |
|---|---|
| `isGroupVisible?: (group: CrudFormGroup) => boolean` predicate | More expressive, but a larger public surface for the same use case, not serialisable, and re-evaluated on every render (identity churn feeds `useMemo`/`useGroupOrder` deps). A predicate remains additively addable later on top of the id list if a real need appears. |
| A `hidden?: boolean` flag on `CrudFormGroup` itself | Requires the host to own the group array — precisely the coupling this FR removes. |
| Matching on translated group titles | Titles are i18n strings and change with locale; ids are the documented stable key. Explicitly rejected by the FR. |
| A general conditional-form rules engine | Out of scope per the FR, and far more surface than the problem justifies. |

### Prior art

`Formily` distinguishes `visible: false` (unmount **and** drop the value from the model) from `display: 'hidden'` (unmount, **keep** the value); `react-jsonschema-form`'s `ui:widget: 'hidden'` and AdminJS's `isVisible` likewise keep the value in the payload. The mainstream choice is to keep the data, which is also the only choice safe against a full-replace `PUT`. This spec follows it. What those libraries carry that this one can skip: a whole expression/rules layer for computing visibility — the FR explicitly rules that out.

## 📝 Architecture

The change is contained in `packages/ui/src/backend/CrudForm.tsx`. No new component, no new module, no new export beyond the prop.

### Where filtering applies

`resolvedGroupsForLayout` (`~2089`) is the single chokepoint. Filtering there automatically covers, with no further edits:

| Consumer | Anchor | Effect of filtering at the chokepoint |
|---|---|---|
| `useGroupedLayout` | `~2094` | — see the all-hidden guard below |
| `defaultGroupIds` → `useGroupOrder` | `~2097` | Hidden groups produce no sortable entry and no DnD target |
| Collapsible auto-expand on validation error | `~2115` | Hidden groups are never expanded or scrolled to |
| `firstFieldId` autofocus scan | `~2183` | Autofocus never targets a control that is not rendered |
| Two-column render + column counts | `~3490–3570` | Hidden groups reserve no column space and leave no empty card |

### Where filtering deliberately does **not** apply

Three derivations stay on the **unfiltered** `groups` prop, and this is load-bearing:

- **`allFields`** (`~1853`) — inline field configs declared inside a hidden group stay registered, so `values`, the zod schema shape, and the submitted payload are unchanged. This is what makes hiding presentation-only.
- **`placedCustomFieldIds`** (`~2132`) — a custom field placed into a hidden group stays "placed", so it does **not** migrate into the `kind: 'customFields'` card. Hiding a group hides its custom fields; it does not relocate them.
- **The submit payload** (`~2859` onward) — untouched.

A fourth surface is deliberately **out of reach** of this filter and must not be read as covered by it: injection-widget *event handlers*. See "Injection widgets keep their handlers" below.

### All-hidden guard

`useGroupedLayout` is currently `resolvedGroupsForLayout.length > 0`, and the falsy branch renders the flat, ungrouped `allFields` list. Without a guard, hiding *every* group would therefore reveal *every* field ungrouped — the exact opposite of the request. The fix: keep the pre-filter list around, and derive the layout decision from it rather than from the filtered one.

```ts
// Pre-filter: what the form declared, including the synthesised auto-group
// and injection cards. Decides which layout renders.
const declaredGroupsForLayout = React.useMemo(() => { /* … as today … */ }, [/* … */])
// Post-filter: what actually renders.
const resolvedGroupsForLayout = React.useMemo(
  () => (hiddenGroupIdSet.size === 0
    ? declaredGroupsForLayout
    : declaredGroupsForLayout.filter((group) => !hiddenGroupIdSet.has(group.id))),
  [declaredGroupsForLayout, hiddenGroupIdSet],
)
const useGroupedLayout = declaredGroupsForLayout.length > 0
```

Splitting the memo rather than counting sources (`groupsWithInjectedFields.length + injectionGroupCards.length`) keeps the decision on the same list the layout actually uses, so the synthesised `__auto-fields__` group is covered without a special case.

### Hidden-group field ids

Two validation paths iterate `allFields` and would otherwise gate submit on a control the user cannot see. `CrudForm` already has the precedent for this: `visibleWhen` produces `hiddenBaseFieldIds` (`~1804`), which the blur validator (`~1905`) and the built-in required gate (`~2793`) both skip. This spec adds a parallel `hiddenGroupFieldIds` set — field ids that appear in a hidden group and in **no** visible group — consulted alongside it in those same two guards.

Fields shared between a hidden and a visible group therefore stay validated, which is the conservative reading.

**Why a parallel set rather than folding the ids into `hiddenBaseFieldIds`.** The union would be a smaller diff, and the first question a reviewer asks. It is rejected because `hiddenBaseFieldIds` is derived purely from `fields` + `visibleWhen` and has no access to `cfFields`/`placedCustomFieldIds`, which the group set needs in order to resolve a hidden `kind: 'customFields'` card into the custom-field ids it owns. Folding them together would either mis-handle custom fields or drag custom-field resolution into a set whose whole purpose is field-level `visibleWhen` visibility.

### Injection widgets keep their handlers

`useInjectionSpotEvents` (`packages/ui/src/backend/injection/InjectionSpot.tsx`, `~297`) builds its handler set from the **loaded widget definitions** passed to it (`CrudForm.tsx` `~1141`), not from what rendered. Filtering the layout therefore removes a widget's *card* but not its *behavior*: `onBeforeSave`, `transformFormData` and `onFieldChange` still run for a hidden `widget:<widgetId>` group, and `widgetRequiredFieldIds` (`~1147`) still marks its fields required.

This is intentional — a widget's data hooks belong to the spot, not to its card, and silently disabling another module's save-time validation because a host hid a card would be worse than the alternative. But it has a real consequence, recorded in Edge Cases: a hidden widget whose `onBeforeSave` rejects blocks submit with a field error whose control is not in the DOM, and `scrollToInjectionBlockedTarget` has nothing to scroll to. Hosts must not hide a widget group that gates saving.

## 📝 Data Models

No entity, column, migration, or persisted-schema change. The only persistence touched indirectly is the sortable-group order in `localStorage` (`om:group-order:<pageType>`), and only through existing behavior: `mergeOrder` already filters saved ids down to the current defaults and appends missing ones. See Edge Cases for the observable consequence.

## 📝 API Contracts

No HTTP endpoint, command, or event changes. The only contract change is the `CrudFormProps` addition above — additive, optional, and covered by the *"`CrudForm` component props — MUST NOT remove existing props"* row in `BACKWARD_COMPATIBILITY.md` (§ 3, Function & Component Signatures). Nothing is removed, renamed, or given new required semantics.

`readonly string[]` (not `string[]`) so hosts can pass a `const` array without a variance error.

## 📝 UI/UX

Nothing new is drawn — the feature only removes cards that the host names.

- A hidden group renders no card, no header, no chevron, and no drag handle.
- Column balance follows automatically: hiding all column-2 groups collapses the layout to the single-column presentation the existing code already produces for a column-2-empty form, rather than leaving a blank gutter.
- Autofocus moves to the first enabled field of the first *visible* group.
- Validation errors on a hidden-only field cannot be surfaced, which is why those fields are excluded from the built-in required gate rather than left to fail invisibly.

## 📝 Edge Cases & Failure Scenarios

| Case | Behavior |
|---|---|
| Unknown / misspelled id in `hiddenGroupIds` | Ignored. In non-production a `logger.warn` names the id, mirroring the existing unknown-injection-group warning (`~2067`). Never throws — a stale id after a core rename must not white-screen a host page. |
| `hiddenGroupIds` empty or absent | Identical rendering and submission to today. Guarded by a byte-for-byte regression test. |
| Every group hidden | Grouped layout is kept and renders zero cards (all-hidden guard). The flat-field fallback is never reached. |
| Hiding an injected widget group card | The **card** is hidden — injection cards carry the stable id `widget:<widgetId>` (`~2041`), so the filter is uniform. The **widget's handlers are not disabled** (see "Injection widgets keep their handlers"). |
| Hidden widget whose `onBeforeSave` rejects | ⚠️ Submit is blocked by a field error whose control is not rendered, and `scrollToInjectionBlockedTarget` finds no target: the user sees "Save blocked by validation" with nothing to fix. This is the one failure mode the design does not make safe. **Rule: do not hide a `widget:<id>` group that gates saving.** A host that must hide such a card should disable the widget through the module override system instead, which removes the handler with the card. |
| Hidden widget contributing `transformFormData` | Still runs and still rewrites the payload. Hiding a card does not opt out of another module's data transform. |
| Hiding a `kind: 'customFields'` group | Supported; the custom-field controls simply do not render. Their values are still submitted. The initial-focus effect still waits on `isLoadingCustomFields` (`~2228`) even though nothing from that fetch renders — a small, harmless autofocus delay, not a bug. |
| Injected field targeting a hidden group | The field is injected into that group as today and hidden with it. It is not relocated — silently moving another module's field into an unrelated visible card would be more surprising than hiding it. Its **value is kept and submitted** (see the submission rule under Q2). |
| Hiding the synthesised `__auto-fields__` group | `__auto-fields__` (`~2091`) is an internal id, created only when a form declares no `groups` but has injection cards. It is **reserved**: naming it in `hiddenGroupIds` is unsupported and its behavior may change without a deprecation. Hosts hide declared ids only. |
| Field in a hidden group is `required` | Excluded from the built-in required gate (hidden-only fields). A host-supplied zod `schema` is **not** bypassed: a schema-required field with no value in create mode still blocks submit. Documented as host responsibility — do not hide a group whose fields the schema requires unless defaults supply them. |
| Field appears in both a hidden and a visible group | Stays validated and focusable via the visible group. |
| Hidden group participates in persisted sortable order | `mergeOrder` drops ids absent from the current defaults, so the next `reorder` write persists an order without the hidden ids. Un-hiding later restores the group at its default position (appended) rather than its previously dragged position. Acceptable and documented; ordering is a per-user convenience, not data. |
| `hiddenGroupIds` identity changes every render | The set is memoised on a stable join key so `useGroupOrder`'s content guard (documented at `useGroupOrder`'s JSDoc, re: #4386/#4691) is not disturbed. |

**No case loses data**: hiding is presentation-only everywhere, and the worst outcome of a *bad id* is that nothing is hidden. There is exactly one case that is not merely local — hiding a widget group whose `onBeforeSave` gates saving, marked ⚠️ above. It is a host misuse rather than a defect the component can prevent, because the handler belongs to the injection spot rather than to the card, but the spec states it rather than claiming the design has no sharp edge.

## 📝 Risks & Impact Review

- **Blast radius.** One file for the mechanism (`CrudForm.tsx`), plus an opt-in example. Every existing call site passes no `hiddenGroupIds`, so the filter is a no-op set lookup on an empty set.
- **Compatibility.** Additive optional prop on a protected surface; no existing prop or `CrudFormGroup` semantic changes. No deprecation protocol needed.
- **The one real regression risk** is the `useGroupedLayout` guard, because it touches a line every grouped form already depends on. Mitigated by an explicit test asserting that a form with `groups` and no `hiddenGroupIds` still uses the grouped layout, and that a form with no `groups` at all still uses the flat layout.
- **The one sharp edge left to hosts** is hiding a `widget:<id>` group whose `onBeforeSave` gates saving; the component cannot prevent it because the handler is registered against the injection spot, not the card. Mitigated by documentation (the prop JSDoc, the public docs page, and the ⚠️ Edge Cases row) rather than by code.
- **Rollback.** Remove the prop and the three edits; there is no persisted state, no migration, and no serialized artifact to unwind. A host that had passed the prop simply renders the full form again.
- **Coupling.** None added: the mechanism is keyed on ids the host already knows, and no module gains a dependency on another.

## 📋 Phasing

One phase — the capability is not independently splittable in a way that leaves anything useful shipped halfway. The mechanism and its coverage land together; the customers-facing example, the docs page and the harness refresh are the trailing steps and are additive documentation of the same API.

## 📋 Implementation Plan

### Phase 1 — `hiddenGroupIds` on `CrudForm`

1. **Declare the prop.** Add `hiddenGroupIds?: readonly string[]` to `CrudFormProps` with the JSDoc from Proposed Solution, and destructure it in the component signature. Export nothing new. *Testable:* typecheck passes and a host may pass the prop.

2. **Filter at the chokepoint.** Add a `hiddenGroupIdSet` memo (stable on a joined key, empty-set fast path) and filter `resolvedGroupsForLayout` by it. Emit the dev-only `logger.warn` for ids that match no declared group. *Testable:* a group named in `hiddenGroupIds` renders no card, while its siblings render unchanged.

3. **Add the all-hidden guard.** Split the layout memo into `declaredGroupsForLayout` (pre-filter) and `resolvedGroupsForLayout` (post-filter), and derive `useGroupedLayout` from the pre-filter list, per Architecture. *Testable:* hiding every group renders zero cards and does **not** fall back to the flat field list; a form with `groups` and no hidden ids still uses the grouped layout; a form without `groups` still uses the flat layout.

4. **Exclude hidden-only fields from validation gates.** Add the `hiddenGroupFieldIds` memo (ids in hidden groups minus ids in visible groups; `kind: 'customFields'` groups resolved through `cfFields`/`placedCustomFieldIds`; injected field definitions resolved through the same last-group fallback `groupsWithInjectedFields` uses, so an injected field is hidden exactly when its target group is) and consult it alongside `hiddenBaseFieldIds` in the blur validator (`~1905`) and the built-in required gate (`~2793`). *Testable:* a `required` field inside a hidden group no longer blocks submit; the same field id also present in a visible group still does.

5. **Unit coverage** in a new `packages/ui/src/backend/__tests__/CrudForm.hiddenGroups.test.tsx`, following the existing `CrudForm.groupInjectionColumn.test.tsx` / `CrudForm.sortable.test.tsx` patterns. Cases: no prop (rendering and submitted payload identical to a baseline render); one hidden group; unknown id ignored; mixed columns leaving no empty column-2 gutter; a hidden injected widget group (`widget:<id>`); a hidden `kind: 'customFields'` group; collapsible auto-expand skipping hidden groups; sortable entries excluded; validation-error focus never targeting a hidden group; and **submit semantics** — values of hidden-group fields present and unmodified in the `onSubmit` payload. *Testable:* `yarn workspace @open-mercato/ui test`.

6. **Customers example + integration coverage.** Add a focused test demonstrating `createCompanyFormGroups` rendered with `hiddenGroupIds={['profile', 'customFields']}` — the remaining `details`, `addresses` and `notes` cards render, the hidden ones do not, and a company update payload still carries the `profile` fields' loaded values. This is the FR's "without copying the page" acceptance criterion, expressed as a test rather than a new page. *Testable:* the customers package test run.

7. **Document the prop** in `apps/docs/docs/framework/admin-ui/crud-form.mdx` — the public CrudForm reference — with a prop-list entry and a short "Hiding groups by id" section covering the id-keyed contract, the presentation-only submission semantics, the schema-required caveat, and the ⚠️ hidden-widget-`onBeforeSave` rule. The prop's JSDoc carries the same contract so it is discoverable from the editor. *Testable:* the docs build.

   **Not `packages/ui/AGENTS.md`.** The `packages/ui` instruction chain is already ~33.8 KB over the 32,768-byte agent budget, and `scripts/check-agents-md-budget.mjs` fails any over-budget chain that *grows* (`overflowBytes > 0 && grewBy > 0`); at 35,352 bytes against a 35,358-byte baseline it has 6 bytes of slack, so any entry added there fails `yarn agents:check-budget`. Adding one would require freeing bytes in that chain first, or a deliberate `--update-baseline` re-record explained in the PR — neither of which this feature justifies.

8. **Refresh the standalone-app harness.** A new public `CrudForm` prop is an installed-contract change, which the root Task Router routes to `om-refresh-standalone-harness`. Run it so the standalone harness knows about `hiddenGroupIds`. *Testable:* the harness refresh reports no outstanding gap for this contract.

## 📋 Acceptance Criteria

Restating FR [#5876](https://github.com/open-mercato/open-mercato/issues/5876)'s criteria as the merge bar, each mapped to the step and coverage that satisfies it:

| # | FR acceptance criterion | Satisfied by | Verified by |
|---|---|---|---|
| AC1 | Hosts can hide groups using stable group ids | Steps 1–2 | `CrudForm.hiddenGroups.test.tsx` — one hidden group renders no card, siblings unchanged |
| AC2 | Omitting the new option preserves existing rendering and submission behavior | Steps 1–3 | Byte-for-byte baseline assertion (no prop vs `hiddenGroupIds={[]}`), plus the three-way layout-mode non-regression test |
| AC3 | Hidden groups create no empty columns, headers, sortable entries, or validation focus targets | Step 2 (chokepoint filter) + step 3 | Mixed-column test (no empty column-2 gutter), sortable-entry exclusion, collapsible auto-expand skip, autofocus scan |
| AC4 | Behavior for fields in hidden groups is explicit, documented, and covered by tests | Step 4 + Q2/Q3 + step 7 | Submit-payload test (hidden-group values present and unmodified); required-gate test; docs page |
| AC5 | Injected groups follow a documented rule and are covered | Step 2 + "Injection widgets keep their handlers" + Edge Cases | Hidden `widget:<id>` card test; documented handler-survival rule and the ⚠️ `onBeforeSave` caveat |

## Resolved assumptions (autonomous defaults)

Written under `--autonomous`; every row is a reversible default a reviewer may overturn before merge.

| # | Question | Resolved answer | Rationale |
|---|---|---|---|
| Q1 | Prop shape: id list, predicate callback, or both? | `hiddenGroupIds?: readonly string[]` only | Smallest new public surface for the stated need; serialisable and identity-stable. A predicate stays additively addable later, so this is the more reversible choice. |
| Q2 | What happens to values of fields that live only in a hidden group? | Kept and submitted unchanged; hiding is presentation-only — **including injected fields** (see below) | The only data-safe option: dropping them would null those columns under full-replace `PUT` semantics. Matches Formily's `display: 'hidden'` and RJSF's hidden widget. |
| Q3 | Do required fields in hidden groups still block submit? | Excluded from the built-in required gate; a host zod `schema` is **not** bypassed | Follows the existing `visibleWhen`/`hiddenBaseFieldIds` precedent for *validation* (`~1905`, `~2793`). Blocking on an unreachable control would strand the user with no way to fix it. |

**Submission precedent is split, and this spec picks a side deliberately.** `CrudForm`'s existing `visibleWhen` mechanism is not uniform about payloads: `hiddenBaseFieldIds` values survive into the submitted data, while `hiddenInjectedFieldIds` values are *deleted* from it (`~2860`). So Q3's alignment with that precedent covers validation gating only. For submission, `hiddenGroupIds` follows the `hiddenBaseFieldIds` half for **every** field it hides, injected fields included: an injected field living only in a hidden group keeps its value and is still submitted, even though the same field hidden by `visibleWhen` would be stripped. Group hiding is a host's layout decision about a form it does not own, so it must not silently drop another module's data; `visibleWhen` on an injected field is that module's own decision about its own field, so stripping is correct there. Different actors, different defaults.
| Q4 | Do injected widget groups and `customFields` groups participate? | Yes — one uniform rule keyed on group id, no special cases | Special-casing would make the contract harder to predict than it is to implement. Injection cards already expose stable `widget:<widgetId>` ids. |
| Q5 | Unknown ids — throw, or ignore? | Ignore, with a dev-only warning | Never white-screen a host page over a stale id after a core rename; matches the existing unknown-injection-group warning. |
| Q6 | Does hiding disturb sortable/collapsible persistence? | No new persistence; hidden ids fall out of the saved order through existing `mergeOrder` behavior | Zero new storage keys and nothing to migrate or roll back; the un-hide position reset is documented in Edge Cases. |
| Q7 | Is this one independently deployable capability, or should it be split? | One spec, one phase | The mechanism, its validation semantics and its coverage are not independently useful; splitting would ship a filter nobody can safely use. |

No assumption carries `⚠ NEEDS HUMAN CONFIRMATION`: none weakens security, tenant scoping, or a documented compatibility contract, and the largest one (Q2) is the conservative, data-preserving reading.

## 🔍 Self-review

Applied against the staff-engineer checklist:

| Item | Verdict | Justification |
|---|---|---|
| Architectural diff | ✅ | Documents only the chokepoint, the three deliberate non-filters, the all-hidden guard, and the injection-handler boundary; no re-documentation of `CrudForm` basics. |
| Scope cohesion | ✅ | One capability — hide declared groups by id. No bundled second feature (Q7). *Note: the skill's fresh-context subagent delegation for this item was not used, per this session's no-subagent policy; the check was applied inline.* |
| Canonical mechanisms | ✅ | Reuses `CrudFormGroup.id`, `logger.warn`, and `useGroupOrder` as-is, and follows the `hiddenBaseFieldIds` precedent. The one parallel construct — `hiddenGroupFieldIds` — is justified in Architecture: the existing set has no access to the custom-field resolution the group set needs. |
| Contracts and compatibility | ✅ | Additive optional prop on a `BACKWARD_COMPATIBILITY.md`-protected surface; nothing removed or renamed, so no deprecation protocol applies. |
| Reversibility | ✅ | No persisted state or migration; rollback is deleting the prop and three edits. |
| Boundaries and coupling | ✅ | Mechanism confined to `packages/ui`; no cross-module import or ORM relationship added. The customers step is test-only and the docs step touches `apps/docs` only. |
| Sensitive data | ✅ (n/a) | No PII, credential, or free-text-about-people field is introduced; hidden fields are not exfiltrated anywhere new. |
| Failure scenarios | ✅ | Fourteen cases enumerated with observable behavior, including the three genuinely surprising ones (all-hidden fallback, sortable order reset, and the hidden widget whose `onBeforeSave` still gates saving). |
| Testability | ✅ | Every step names its verification, and the FR's five acceptance criteria are mapped to steps and tests; the riskiest edit (step 3) has a dedicated non-regression assertion. |

## 📋 Final Compliance Report — 2026-09-06

Recorded at specification review (PR [#5885](https://github.com/open-mercato/open-mercato/pull/5885)); the implementation's own gate is PR [#5886](https://github.com/open-mercato/open-mercato/pull/5886).

| Area | Status | Evidence |
|---|---|---|
| Grounding against the codebase | ✅ | Every symbol and anchor in this document verified against `CrudForm.tsx`, `useGroupOrder.ts`, `InjectionSpot.tsx`, `formConfig.tsx` and `BACKWARD_COMPATIBILITY.md` at review time. |
| Backward compatibility | ✅ | Additive optional prop only; no protected surface removed, renamed, or re-specified. No deprecation protocol required. |
| Data & security | ✅ (n/a) | No entity, column, migration, endpoint, ACL feature, or tenant-scoped query is introduced. No PII surface changes. |
| i18n | ✅ (n/a) | No new user-facing string; the prop is keyed on ids, explicitly not on translated titles. |
| Design system | ✅ (n/a) | Nothing is drawn; the feature only removes cards a host names. |
| Test plan | ✅ | Steps 5–6 cover all five FR acceptance criteria, including the byte-for-byte no-prop baseline and the submit-payload assertion. |
| Documentation | ✅ | Public docs page (step 7) plus prop JSDoc; `packages/ui/AGENTS.md` deliberately excluded for the budget-ratchet reason recorded in step 7. |
| Open Questions | ✅ | Seven raised, seven resolved with reversible defaults; none carries `⚠ NEEDS HUMAN CONFIRMATION`. |

## 📋 Changelog

- **2026-09-06** — Specification review (`om-auto-review-pr` on #5885). Corrected the step 7 documentation target from `packages/ui/AGENTS.md` to `apps/docs/docs/framework/admin-ui/crud-form.mdx`, because the `packages/ui` instruction chain is over budget and its ratchet fails on any growth. Documented that injection-widget event handlers survive hiding, with the ⚠️ hidden-`onBeforeSave` rule, and softened the Risks claim that all failure modes are local. Recorded that the submission precedent is split (`hiddenInjectedFieldIds` are stripped at `~2860`) and stated the rule this feature follows for injected fields. Re-specified the all-hidden guard as the `declaredGroupsForLayout` / `resolvedGroupsForLayout` split actually implemented on #5886. Added Overview, Acceptance Criteria, Final Compliance Report and this changelog; added edge cases for `__auto-fields__`, `transformFormData`, and the `isLoadingCustomFields` autofocus gate; added the `om-refresh-standalone-harness` step; converted absolute line numbers to symbol-first `~` anchors.
- **2026-09-04** — Initial specification (`om-auto-write-spec`, FR #5876). Seven Open Questions resolved with autonomous defaults.
