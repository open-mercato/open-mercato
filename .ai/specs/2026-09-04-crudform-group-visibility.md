# CrudForm group visibility — hide built-in groups by stable id

## 📝 TLDR

`CrudForm` hosts that need a smaller form today have only one option: copy the whole page and rebuild the `groups` array, which couples standalone apps to core component internals just to drop a card. This spec adds one additive, optional prop — `hiddenGroupIds?: readonly string[]` — that filters groups by their stable `CrudFormGroup.id` before layout, so a host can omit built-in cards while keeping every other field, injected widget, and default behavior intact. Hiding is **presentation-only**: the submitted payload is byte-for-byte what it would have been without the prop. Absent the prop, `CrudForm` behaves exactly as it does today.

Resolves FR [#5876](https://github.com/open-mercato/open-mercato/issues/5876).

## 📝 Problem Statement

`CrudFormGroup` (`packages/ui/src/backend/CrudForm.tsx:436`) already carries a stable `id` used for sortable order persistence, collapsible state keys, and injected-field targeting. But nothing consumes that id as a visibility key. `groups` flows straight from the prop into `groupsWithInjectedFields` (line 2060) and then into `resolvedGroupsForLayout` (line 2089), which every downstream consumer derives from.

The consequence is that a consumer who wants a company form without the `profile` and `customFields` cards — the ids declared in `createCompanyFormGroups` (`packages/core/src/modules/customers/components/formConfig.tsx:1414`) — must either:

- replace the entire page through the component-replacement system and re-declare all five groups, inheriting the maintenance burden of every future core change to that array; or
- fork `createCompanyFormGroups` and drift from core silently.

Both couple the app to internals it does not otherwise care about. The ask is narrow and recurring: keep the page, drop named cards.

## 📝 Proposed Solution

Add one optional prop to `CrudFormProps`:

```ts
/**
 * Hide the groups whose `CrudFormGroup.id` appears in this list.
 *
 * Presentation-only: hidden groups are removed before layout, so they reserve
 * no column space, contribute no sortable entry, no collapsible header and no
 * validation focus target. Fields that live only in a hidden group keep their
 * current values and are still submitted unchanged — hiding a group never
 * clears data.
 *
 * Unknown ids are ignored (dev-only warning). Strictly additive: when the prop
 * is absent or empty the form behaves exactly as before.
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

`resolvedGroupsForLayout` (line 2089) is the single chokepoint. Filtering there automatically covers, with no further edits:

| Consumer | Line | Effect of filtering at the chokepoint |
|---|---|---|
| `useGroupedLayout` | 2094 | — see the all-hidden guard below |
| `defaultGroupIds` → `useGroupOrder` | 2097 | Hidden groups produce no sortable entry and no DnD target |
| Collapsible auto-expand on validation error | 2115 | Hidden groups are never expanded or scrolled to |
| `firstFieldId` autofocus scan | 2183 | Autofocus never targets a control that is not rendered |
| Two-column render + column counts | 3490–3570 | Hidden groups reserve no column space and leave no empty card |

### Where filtering deliberately does **not** apply

Three derivations stay on the **unfiltered** `groups` prop, and this is load-bearing:

- **`allFields`** (line 1853) — inline field configs declared inside a hidden group stay registered, so `values`, the zod schema shape, and the submitted payload are unchanged. This is what makes hiding presentation-only.
- **`placedCustomFieldIds`** (line 2132) — a custom field placed into a hidden group stays "placed", so it does **not** migrate into the `kind: 'customFields'` card. Hiding a group hides its custom fields; it does not relocate them.
- **The submit payload** (line 2859 onward) — untouched.

### All-hidden guard

`useGroupedLayout` is currently `resolvedGroupsForLayout.length > 0`, and the falsy branch renders the flat, ungrouped `allFields` list. Without a guard, hiding *every* group would therefore reveal *every* field ungrouped — the exact opposite of the request. The fix: remember whether groups were declared before filtering, and keep the grouped layout (rendering zero cards) when filtering emptied a non-empty set.

```ts
const declaredGroupCount =
  (groupsWithInjectedFields?.length ?? 0) + injectionGroupCards.length
const useGroupedLayout = resolvedGroupsForLayout.length > 0 || declaredGroupCount > 0
```

### Hidden-group field ids

Two validation paths iterate `allFields` and would otherwise gate submit on a control the user cannot see. `CrudForm` already has the precedent for this: `visibleWhen` produces `hiddenBaseFieldIds` (line 1804), which the blur validator (line 1905) and the built-in required gate (line 2793) both skip. This spec mirrors it exactly with a `hiddenGroupFieldIds` set — field ids that appear in a hidden group and in **no** visible group — added to those same two guards.

Fields shared between a hidden and a visible group therefore stay validated, which is the conservative reading.

## 📝 Data Model

No entity, column, migration, or persisted-schema change. The only persistence touched indirectly is the sortable-group order in `localStorage` (`om:group-order:<pageType>`), and only through existing behavior: `mergeOrder` already filters saved ids down to the current defaults and appends missing ones. See Edge Cases for the observable consequence.

## 📝 API Contracts

No HTTP endpoint, command, or event changes. The only contract change is the `CrudFormProps` addition above — additive, optional, and covered by the "MUST NOT remove existing props" rule for `CrudForm` component props in `BACKWARD_COMPATIBILITY.md:145`. Nothing is removed, renamed, or given new required semantics.

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
| Unknown / misspelled id in `hiddenGroupIds` | Ignored. In non-production a `logger.warn` names the id, mirroring the existing unknown-injection-group warning at line 2067. Never throws — a stale id after a core rename must not white-screen a host page. |
| `hiddenGroupIds` empty or absent | Identical rendering and submission to today. Guarded by a byte-for-byte regression test. |
| Every group hidden | Grouped layout is kept and renders zero cards (all-hidden guard). The flat-field fallback is never reached. |
| Hiding an injected widget group card | Supported and uniform: injection cards carry the stable id `widget:<widgetId>` (line 2041). No special case. |
| Hiding a `kind: 'customFields'` group | Supported; the custom-field controls simply do not render. Their values are still submitted. |
| Injected field targeting a hidden group | The field is injected into that group as today and hidden with it. It is not relocated — silently moving another module's field into an unrelated visible card would be more surprising than hiding it. |
| Field in a hidden group is `required` | Excluded from the built-in required gate (hidden-only fields). A host-supplied zod `schema` is **not** bypassed: a schema-required field with no value in create mode still blocks submit. Documented as host responsibility — do not hide a group whose fields the schema requires unless defaults supply them. |
| Field appears in both a hidden and a visible group | Stays validated and focusable via the visible group. |
| Hidden group participates in persisted sortable order | `mergeOrder` drops ids absent from the current defaults, so the next `reorder` write persists an order without the hidden ids. Un-hiding later restores the group at its default position (appended) rather than its previously dragged position. Acceptable and documented; ordering is a per-user convenience, not data. |
| `hiddenGroupIds` identity changes every render | The set is memoised on a stable join key so `useGroupOrder`'s content guard (documented at `useGroupOrder`'s JSDoc, re: #4386/#4691) is not disturbed. |

Failure modes are all local and non-destructive: the worst outcome of a bad id is that nothing is hidden.

## 📝 Risks & Impact Review

- **Blast radius.** One file for the mechanism (`CrudForm.tsx`), plus an opt-in example. Every existing call site passes no `hiddenGroupIds`, so the filter is a no-op set lookup on an empty set.
- **Compatibility.** Additive optional prop on a protected surface; no existing prop or `CrudFormGroup` semantic changes. No deprecation protocol needed.
- **The one real regression risk** is the `useGroupedLayout` guard, because it touches a line every grouped form already depends on. Mitigated by an explicit test asserting that a form with `groups` and no `hiddenGroupIds` still uses the grouped layout, and that a form with no `groups` at all still uses the flat layout.
- **Rollback.** Remove the prop and the three edits; there is no persisted state, no migration, and no serialized artifact to unwind. A host that had passed the prop simply renders the full form again.
- **Coupling.** None added: the mechanism is keyed on ids the host already knows, and no module gains a dependency on another.

## 📋 Phasing

One phase — the capability is not independently splittable in a way that leaves anything useful shipped halfway. The mechanism and its coverage land together; the customers-facing example is the last step and is additive documentation of the same API.

## 📋 Implementation Plan

### Phase 1 — `hiddenGroupIds` on `CrudForm`

1. **Declare the prop.** Add `hiddenGroupIds?: readonly string[]` to `CrudFormProps` with the JSDoc from Proposed Solution, and destructure it in the component signature. Export nothing new. *Testable:* typecheck passes and a host may pass the prop.

2. **Filter at the chokepoint.** Add a `hiddenGroupIdSet` memo (stable on a joined key, empty-set fast path) and filter `resolvedGroupsForLayout` by it. Emit the dev-only `logger.warn` for ids that match no declared group. *Testable:* a group named in `hiddenGroupIds` renders no card, while its siblings render unchanged.

3. **Add the all-hidden guard.** Replace `useGroupedLayout`'s definition with the `declaredGroupCount` form from Architecture. *Testable:* hiding every group renders zero cards and does **not** fall back to the flat field list; a form with `groups` and no hidden ids still uses the grouped layout; a form without `groups` still uses the flat layout.

4. **Exclude hidden-only fields from validation gates.** Add the `hiddenGroupFieldIds` memo (ids in hidden groups minus ids in visible groups, custom-fields groups resolved through `cfFields`/`placedCustomFieldIds`) and consult it alongside `hiddenBaseFieldIds` in the blur validator (line 1905) and the built-in required gate (line 2793). *Testable:* a `required` field inside a hidden group no longer blocks submit; the same field id also present in a visible group still does.

5. **Unit coverage** in a new `packages/ui/src/backend/__tests__/CrudForm.hiddenGroups.test.tsx`, following the existing `CrudForm.groupInjectionColumn.test.tsx` / `CrudForm.sortable.test.tsx` patterns. Cases: no prop (rendering and submitted payload identical to a baseline render); one hidden group; unknown id ignored; mixed columns leaving no empty column-2 gutter; a hidden injected widget group (`widget:<id>`); a hidden `kind: 'customFields'` group; collapsible auto-expand skipping hidden groups; sortable entries excluded; validation-error focus never targeting a hidden group; and **submit semantics** — values of hidden-group fields present and unmodified in the `onSubmit` payload. *Testable:* `yarn workspace @open-mercato/ui test`.

6. **Customers example + integration coverage.** Add a focused test demonstrating `createCompanyFormGroups` rendered with `hiddenGroupIds={['profile', 'customFields']}` — the remaining `details`, `addresses` and `notes` cards render, the hidden ones do not, and a company update payload still carries the `profile` fields' loaded values. This is the FR's "without copying the page" acceptance criterion, expressed as a test rather than a new page. *Testable:* the customers package test run.

7. **Document the prop** in `packages/ui/AGENTS.md` under **CrudForm Guidelines** — one entry covering the id-keyed contract, the presentation-only submission semantics, and the schema-required caveat — so the seam is discoverable without reading `CrudForm.tsx`. *Testable:* `yarn agents:check-budget` still passes.

## Resolved assumptions (autonomous defaults)

Written under `--autonomous`; every row is a reversible default a reviewer may overturn before merge.

| # | Question | Resolved answer | Rationale |
|---|---|---|---|
| Q1 | Prop shape: id list, predicate callback, or both? | `hiddenGroupIds?: readonly string[]` only | Smallest new public surface for the stated need; serialisable and identity-stable. A predicate stays additively addable later, so this is the more reversible choice. |
| Q2 | What happens to values of fields that live only in a hidden group? | Kept and submitted unchanged; hiding is presentation-only | The only data-safe option: dropping them would null those columns under full-replace `PUT` semantics. Matches Formily's `display: 'hidden'` and RJSF's hidden widget. |
| Q3 | Do required fields in hidden groups still block submit? | Excluded from the built-in required gate; a host zod `schema` is **not** bypassed | Mirrors the existing `visibleWhen`/`hiddenBaseFieldIds` precedent exactly (lines 1905, 2793). Blocking on an unreachable control would strand the user with no way to fix it. |
| Q4 | Do injected widget groups and `customFields` groups participate? | Yes — one uniform rule keyed on group id, no special cases | Special-casing would make the contract harder to predict than it is to implement. Injection cards already expose stable `widget:<widgetId>` ids. |
| Q5 | Unknown ids — throw, or ignore? | Ignore, with a dev-only warning | Never white-screen a host page over a stale id after a core rename; matches the existing unknown-injection-group warning. |
| Q6 | Does hiding disturb sortable/collapsible persistence? | No new persistence; hidden ids fall out of the saved order through existing `mergeOrder` behavior | Zero new storage keys and nothing to migrate or roll back; the un-hide position reset is documented in Edge Cases. |
| Q7 | Is this one independently deployable capability, or should it be split? | One spec, one phase | The mechanism, its validation semantics and its coverage are not independently useful; splitting would ship a filter nobody can safely use. |

No assumption carries `⚠ NEEDS HUMAN CONFIRMATION`: none weakens security, tenant scoping, or a documented compatibility contract, and the largest one (Q2) is the conservative, data-preserving reading.

## 🔍 Self-review

Applied against the staff-engineer checklist:

| Item | Verdict | Justification |
|---|---|---|
| Architectural diff | ✅ | Documents only the chokepoint, the three deliberate non-filters, and the all-hidden guard; no re-documentation of `CrudForm` basics. |
| Scope cohesion | ✅ | One capability — hide declared groups by id. No bundled second feature (Q7). *Note: the skill's fresh-context subagent delegation for this item was not used, per this session's no-subagent policy; the check was applied inline.* |
| Canonical mechanisms | ✅ | Reuses `CrudFormGroup.id`, the existing `hiddenBaseFieldIds` precedent, `logger.warn`, and `useGroupOrder` as-is. Invents nothing parallel. |
| Contracts and compatibility | ✅ | Additive optional prop on a `BACKWARD_COMPATIBILITY.md`-protected surface; nothing removed or renamed, so no deprecation protocol applies. |
| Reversibility | ✅ | No persisted state or migration; rollback is deleting the prop and three edits. |
| Boundaries and coupling | ✅ | Confined to `packages/ui`; no cross-module import or ORM relationship added; the customers step is test-only. |
| Sensitive data | ✅ (n/a) | No PII, credential, or free-text-about-people field is introduced; hidden fields are not exfiltrated anywhere new. |
| Failure scenarios | ✅ | Eleven cases enumerated with observable behavior, including the two genuinely surprising ones (all-hidden fallback, sortable order reset). |
| Testability | ✅ | Every step names its verification; the riskiest edit (step 3) has a dedicated non-regression assertion. |
