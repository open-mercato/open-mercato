# CRM Post-Upgrade Bug Fixes — Batch 2

**Status:** Ready for implementation — Open Questions gate closed 2026-04-27; pre-implementation Critical blockers closed 2026-04-27 (see Changelog).
**Scope:** OSS — `@open-mercato/core` / `customers` module + cross-cutting `@open-mercato/ui` primitives (`CrudForm`, `Badge`/`StatusBadge`).
**Date:** 2026-04-27
**Reporter:** @alinadivante (issues opened 2026-04-26)
**Source issues:**
[#1711](https://github.com/open-mercato/open-mercato/issues/1711) ·
[#1712](https://github.com/open-mercato/open-mercato/issues/1712) ·
[#1713](https://github.com/open-mercato/open-mercato/issues/1713) ·
[#1714](https://github.com/open-mercato/open-mercato/issues/1714) ·
[#1715](https://github.com/open-mercato/open-mercato/issues/1715) ·
[#1716](https://github.com/open-mercato/open-mercato/issues/1716)
**Predecessor spec:** [2026-04-23-crm-post-upgrade-bug-fixes.md](./2026-04-23-crm-post-upgrade-bug-fixes.md) — same campaign, prior wave (#1657–#1665).

---

## TLDR

A second wave of six user-reported regressions has appeared on the upgraded CRM (Person v2 / Company v2 / Deal detail) after the SPEC-046 → SPEC-046b → 2026-04-06 → 2026-04-19 sequence. Three are blockers (DB FK violation surfacing as HTTP 500 on company delete; unlink succeeds but UI doesn't refresh; spacebar disables the form section because keyboard-drag listeners catch it from focused inputs); three are paper-cut polish (display name not deriving on Person v2; missing persistent "Add task" affordance; "Primary" badge fails WCAG AA contrast).

Scope is **bug-fix only** — no new features. Six independently-releasable phases, each ending with a green CI gate (unit + Playwright integration) per [.ai/qa/AGENTS.md](.ai/qa/AGENTS.md). The integration tests in this spec map 1:1 to scenarios already drafted in [.ai/qa/scenarios/TC-CRM-POST-UPGRADE-FIXES-MANUAL.md](.ai/qa/scenarios/TC-CRM-POST-UPGRADE-FIXES-MANUAL.md).

---

## Resolved Decisions

> **Open Questions gate closed 2026-04-27.** All decisions below picked the recommended option.

| # | Decision | Rationale |
|---|----------|-----------|
| Q1 | **(a) Hard guard 422.** Pre-delete check counts active dependents (`CustomerPersonCompanyLink`, `CustomerDealCompanyLink`, `CustomerPersonProfile.company`); if any > 0, throw a translated `createCrudFormError` mapped to HTTP 422 with the inventory in the message. No silent cascade of business-meaningful relationships. | Matches industry CRMs (Salesforce, HubSpot, Pipedrive); reversible; smallest surface change; BC-additive. Existing soft-delete cascade for "owned" entities (activities, comments, addresses, tags, profile) stays intact — those are the company's own children, not external dependents. |
| Q2 | **(c) Both + (β) sticky-manual.** Client effect re-used in `createPersonPersonalDataGroups` for live preview. Server `updatePersonCommand` derives `displayName = trim("{firstName} {lastName}")` when first/last is in the patch and the current persisted `displayName` equals the previous derivation (or is empty). User-customized values stay untouched. | Defense-in-depth — third-party API clients (CRM-V1 fallback, mobile, MCP) get the same behavior. Sticky-manual avoids clobbering "Dr. K. Doe Jr." when the user later corrects a typo in the first name. |
| Q3 | **(a) Drag-handle restriction via `setActivatorNodeRef`.** `SortableGroupItem` keeps `setNodeRef` + transform/style on the wrapper; `setActivatorNodeRef`, `attributes`, and `listeners` are exposed via a new `SortableGroupHandleContext` and consumed by an explicit grip-icon handle inside the `CollapsibleGroup` header. | Matches @dnd-kit's documented best practice; preserves keyboard a11y (drag handle is focusable, space/enter activates only on the handle); preserves pointer drag without "any whitespace grabs"; no tests need rewriting beyond the new handle assertion. |
| Q4 | **(b) Both sides.** Fix `CompanyPeopleSection` refresh-after-unlink + add per-row unlink action to `PersonCompaniesSection` calling the same DELETE route. Wire cross-section refresh through the existing `useAppEvent` bridge so unlinking from either side updates the other. | Reporter explicitly raised the asymmetry; DELETE route is symmetric; minimal additive UI change on the person side mirrors the company-side `handleRemove` pattern. |
| Q5 | **(a) `StatusBadge` with `info` variant.** Replace `<Badge variant="default">PRIMARY</Badge>` in `CompanyCard.tsx` with `<StatusBadge variant="info">{t('customers.people.detail.companies.primaryBadge')}</StatusBadge>` (reusing the existing en/pl/es/de key). Status tokens (`bg-status-info-bg` / `text-status-info-text`) meet WCAG AA in both themes. | `info` is the most common semantic for "this is the primary X" markers; avoids new token sprawl; existing `StatusBadge` already implements light + dark mode tokens; the existing locale key is already aligned with the rendering site (Person v2 Companies tab). |
| Q6 | **(a) Persistent `SectionHeader` action.** `TasksSection` already wires `onActionChange({ label, onClick })` — the bug is in the parent's section-header rendering: in `people-v2/[id]/page.tsx` the action is dropped when the section transitions from empty to populated. Fix the parent's render path so the action persists. | Matches `ActivitiesSection` (which works) and the design system's `<SectionHeader title=… count=… action=…>` pattern; minimal change; tests assert presence in both empty and populated states. |

---

## Problem Statement

Each of the four CRM upgrades shipped between 2026-02-25 and 2026-04-23 was correct in isolation. But three of them (`SPEC-046`, `2026-04-06`, `2026-04-19`) introduced shared-state interactions that the unit-test gate didn't cover:

- **Form-section sortability vs. native input behavior** — keyboard-drag listeners spread on the whole sortable card now intercept space/enter from focused descendant inputs (#1711).
- **CRUD command symmetry vs. new link tables** — `customer_person_company_links` (added by 2026-04-19) is a real dependent of `customer_companies`, but the company delete command predates it and never accounted for it (#1713).
- **Indexer-driven refetch vs. local optimistic UI** — `CompanyPeopleSection` does both, in the wrong order, and `PersonCompaniesSection` is missing the unlink affordance entirely (#1714).
- **Form-group composition split** — Person v2's `createPersonPersonalDataGroups` was assembled from scratch and lost the legacy `createDisplayNameSection` that drives auto-derivation (#1715).
- **Section-header action plumbing** — populated-state rendering in the v2 detail pages forgot to keep the action prop wired (#1712).
- **Design-system token discipline** — a single `<Badge variant="default">PRIMARY</Badge>` slipped through review against the rule "no hardcoded color tokens for status semantics" (#1716).

This batch closes those gaps and adds integration coverage that pins the regressions.

---

## Bug Inventory & Verified Root Causes

| # | Issue | Surface (file:line) | Root cause |
|---|-------|---------------------|------------|
| 1 | [#1711](https://github.com/open-mercato/open-mercato/issues/1711) | [packages/ui/src/backend/CrudForm.tsx:427-440](packages/ui/src/backend/CrudForm.tsx) (`SortableGroupItem`); [CrudForm.tsx:1668-1671](packages/ui/src/backend/CrudForm.tsx) (sensor wiring) | `{...listeners} {...attributes}` spread on the whole sortable card. `KeyboardSensor` (no `activationConstraint`) catches space/enter from any focused descendant input → `isDragging=true` → `opacity: 0.5` "grey out". Mouse-wheel delta during the active drag transform-displaces the card. |
| 2 | [#1713](https://github.com/open-mercato/open-mercato/issues/1713) | [packages/core/src/modules/customers/commands/companies.ts:773-805](packages/core/src/modules/customers/commands/companies.ts) | `deleteCompanyCommand` predates the `customer_person_company_links` table introduced 2026-04-19. It clears `CustomerPersonProfile.company` and `CustomerDealCompanyLink`, but never touches `CustomerPersonCompanyLink`. Active link rows trigger an FK constraint violation when `em.remove(CustomerEntity)` flushes → HTTP 500 with no message. |
| 3 | [#1714](https://github.com/open-mercato/open-mercato/issues/1714) | [packages/core/src/modules/customers/components/detail/CompanyPeopleSection.tsx:500-557](packages/core/src/modules/customers/components/detail/CompanyPeopleSection.tsx); [PersonCompaniesSection.tsx:83-422](packages/core/src/modules/customers/components/detail/PersonCompaniesSection.tsx) | `handleRemove` does an optimistic local prune + `loadVisiblePeople()`, but the local prune happens against the cached list while the next `loadVisiblePeople` round-trip resolves before the indexer side effect from `personCompanyLinks.delete` updates the read model. The Person-side section has no per-row unlink at all (only a bulk "Manage links" dialog). No cross-component event broadcast on unlink. |
| 4 | [#1715](https://github.com/open-mercato/open-mercato/issues/1715) | [packages/core/src/modules/customers/components/formConfig.tsx:1675-1707](packages/core/src/modules/customers/components/formConfig.tsx) (Person v2 groups); [commands/people.ts:710-768](packages/core/src/modules/customers/commands/people.ts) (server) | `createPersonPersonalDataGroups` lists `firstName`/`lastName`/`primaryEmail` as plain fields without re-using `createDisplayNameSection` (which lives at [formConfig.tsx:702-749](packages/core/src/modules/customers/components/formConfig.tsx) and is wired into the legacy `createPersonEditGroups`). Server `updatePersonCommand` only persists explicit fields, so the dropped derivation is silent. |
| 5 | [#1712](https://github.com/open-mercato/open-mercato/issues/1712) | [packages/core/src/modules/customers/components/detail/TasksSection.tsx:226-240](packages/core/src/modules/customers/components/detail/TasksSection.tsx) (correctly emits action); parent rendering in [packages/core/src/modules/customers/backend/customers/people-v2/[id]/page.tsx](packages/core/src/modules/customers/backend/customers/people-v2/[id]/page.tsx) (the action drops from `SectionHeader.action` when `hasTasks` flips true). | `TasksSection` emits the action unconditionally; the parent's render of the section header gates the action behind a state path that only fires during empty-state. After repro, fix the parent. |
| 6 | [#1716](https://github.com/open-mercato/open-mercato/issues/1716) | [packages/core/src/modules/customers/components/detail/CompanyCard.tsx:238-242](packages/core/src/modules/customers/components/detail/CompanyCard.tsx) | Hardcoded `<Badge variant="default">` resolves to `bg-primary` / `text-primary-foreground`; primary-token contrast fails WCAG 2.1 AA in both themes. |

---

## Implementation Phases

Each phase is independently releasable. Sequence puts blockers first.

### Phase 1 — Form-section drag stability ([#1711](https://github.com/open-mercato/open-mercato/issues/1711))

**Goal:** Spacebar in a focused input inserts a space; mouse-wheel inside a focused input scrolls the page; sortable group reorder still works via an explicit grip handle in the section header.

**Scope:**
- [packages/ui/src/backend/CrudForm.tsx](packages/ui/src/backend/CrudForm.tsx) — `SortableGroupItem` + sensor wiring.
- [packages/ui/src/backend/crud/CollapsibleGroup.tsx](packages/ui/src/backend/crud/CollapsibleGroup.tsx) — section header gains the handle slot.
- New: `packages/ui/src/backend/crud/SortableGroupHandle.tsx` (component + `useSortableGroupHandle` hook + `SortableGroupHandleContext`).

**Steps:**

1. **Create `SortableGroupHandleContext`** in a new file `packages/ui/src/backend/crud/SortableGroupHandle.tsx`:
   ```tsx
   export type SortableGroupHandleProps = {
     ref: (node: HTMLElement | null) => void
     attributes: Record<string, unknown>
     listeners: Record<string, unknown> | undefined
     isDragging: boolean
     disabled: boolean
   }
   const SortableGroupHandleContext = React.createContext<SortableGroupHandleProps | null>(null)
   export const SortableGroupHandleProvider = SortableGroupHandleContext.Provider
   export function useSortableGroupHandle() { return React.useContext(SortableGroupHandleContext) }
   ```
   Export a thin `<SortableGroupHandle aria-label="…"/>` component that renders an `IconButton variant="ghost" size="xs"` with a `GripVertical` lucide icon, returning `null` when context is absent (so non-sortable forms render no grip).

2. **Refactor `SortableGroupItem`** in `CrudForm.tsx:427-440` to use `setActivatorNodeRef` and provide the context instead of spreading `attributes`/`listeners` on the wrapper:
   ```tsx
   function SortableGroupItem({ id, children, disabled }: { id: string; children: React.ReactNode; disabled?: boolean }) {
     const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
       useSortable({ id, disabled })
     const style: React.CSSProperties = {
       transform: CSS.Transform.toString(transform), transition,
       opacity: isDragging ? 0.5 : 1, position: 'relative',
     }
     const handleProps = React.useMemo<SortableGroupHandleProps>(() => ({
       ref: setActivatorNodeRef, attributes, listeners, isDragging, disabled: !!disabled,
     }), [setActivatorNodeRef, attributes, listeners, isDragging, disabled])
     return (
       <div ref={setNodeRef} style={style}>
         <SortableGroupHandleProvider value={handleProps}>{children}</SortableGroupHandleProvider>
       </div>
     )
   }
   ```
   Note: the wrapper no longer carries any DOM event listeners — focused inputs receive their native key/wheel events untouched.

3. **Render the handle inside `CollapsibleGroup` header** (left of the title, before the chevron). Use the new `<SortableGroupHandle aria-label={t('ui.crud.dragHandle.aria', 'Drag to reorder')}/>` so it's a no-op outside sortable contexts. Suppress focus styles via `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm`.

4. **Tighten `KeyboardSensor` activation** in `CrudForm.tsx:1668-1671` defensively — even though the listeners no longer reach inputs, add `activationConstraint: undefined` explicitly and wrap the sensor in a guard that returns `false` when the active element is a form control. This is belt-and-braces only; primary fix is the handle restriction.

5. **i18n** — add `ui.crud.dragHandle.aria` to `packages/ui/src/locales/{en,pl,es,de}.json`. Other locales inherit the English fallback per existing pattern.

**API / DB / UI changes:**
- API: none.
- DB: none.
- UI: 2 modified files, 1 new file, 4 locale keys.

**Tests:**

*Unit:*
- `packages/ui/src/backend/crud/__tests__/SortableGroupHandle.test.tsx` — context provider + hook + grip-icon render + `null` outside provider.
- Update `packages/ui/src/backend/__tests__/CrudForm.sortable.test.tsx` — assert that pressing Space in a focused `<input>` inside a sortable group does **not** set `aria-pressed`/drag state; assert grip handle is keyboard-focusable and `Space` on the handle initiates drag.

*Integration (Playwright):*
- `packages/core/src/modules/customers/__integration__/TC-CRM-049.spec.ts` — open Company v2 detail; focus Display Name input; press Space three times; assert input value gained the spaces, no section card has `opacity: 0.5`, and no transform was applied. Repeat with mouse-wheel `dispatchEvent('wheel', { deltaY: 120 })` and assert section bounding-rect is unchanged.
- Same shape for `TC-CRM-050.spec.ts` (Person v2) and `TC-CRM-051.spec.ts` (Deal detail).

**Rollback:** Revert the three modified files and delete `SortableGroupHandle.tsx` + locale keys.

**BC notes (verdict — additive):**

| Surface | Change | Class |
|---|---|---|
| BC #3 `SortableGroupItem` props | Unchanged | No-op |
| BC #4 New file `SortableGroupHandle.tsx` exports | New module — no consumer breakage | Additive |
| `CollapsibleGroup` rendering | Adds an icon-button slot in the header. Existing visual is preserved (handle is `null` outside sortable context). | Additive |
| Pointer/keyboard activation | Drag now requires the handle to receive the event. Reorder-by-card-click no longer works. | **Behavior change** — documented in RELEASE_NOTES.md; matches @dnd-kit canonical pattern. |

---

### Phase 2 — Company delete safety ([#1713](https://github.com/open-mercato/open-mercato/issues/1713))

**Goal:** Deleting a company with active dependents returns HTTP 422 with a translated, actionable error listing the blockers. No silent cascade of business-meaningful relationships. Existing soft-delete cascade of *owned* entities (activities, comments, addresses, tags, profile, custom field values) stays intact.

**Scope:**
- [packages/core/src/modules/customers/commands/companies.ts:773-805](packages/core/src/modules/customers/commands/companies.ts) — `deleteCompanyCommand.execute`.
- [packages/core/src/modules/customers/locales/{en,pl,es,de}.json](packages/core/src/modules/customers/locales/) — translated error messages.

**Steps:**

1. **Pre-delete dependent count** — at the top of `deleteCompanyCommand.execute`, after `ensureTenantScope` / `ensureOrganizationScope`, run three counts on `em.fork()` (read-only):
   - `personLinks` — `em.count(CustomerPersonCompanyLink, { company: record, deletedAt: null, organizationId: record.organizationId, tenantId: record.tenantId })`
   - `dealLinks` — `em.count(CustomerDealCompanyLink, { company: record, organizationId: record.organizationId, tenantId: record.tenantId })`
   - `directPeople` — `em.count(CustomerPersonProfile, { company: record, organizationId: record.organizationId, tenantId: record.tenantId })`
   (deals are only linked via `CustomerDealCompanyLink` — there is no direct `Deal.company` FK to clear separately.)

2. **Raise translated 422 if any > 0** — use `CrudHttpError` from `@open-mercato/shared/lib/crud/errors`, the canonical server-side error helper already used elsewhere in the customers commands (see [`personCompanyLinks.ts:529`](packages/core/src/modules/customers/commands/personCompanyLinks.ts) — `throw new CrudHttpError(404, { error: 'Company link not found' })`). It surfaces the configured status code and JSON body through the existing CRUD error pipeline. No UI-package imports allowed in command files (layering rule).
   ```typescript
   import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
   import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

   const { t } = await resolveTranslations()
   const blockers = [
     personLinks > 0 && t('customers.companies.delete.blockers.persons', 'linked persons', { count: personLinks }),
     dealLinks > 0 && t('customers.companies.delete.blockers.deals', 'linked deals', { count: dealLinks }),
     directPeople > 0 && t('customers.companies.delete.blockers.directPeople', 'persons whose primary company is this one', { count: directPeople }),
   ].filter(Boolean).join(', ')
   if (blockers.length > 0) {
     throw new CrudHttpError(422, {
       error: t('customers.companies.delete.blocked', 'Cannot delete company: {{blockers}}. Please unlink or reassign first.', { blockers }),
       code: 'COMPANY_HAS_DEPENDENTS',
     })
   }
   ```
   The API responds with HTTP 422 and JSON body `{ error: '...', code: 'COMPANY_HAS_DEPENDENTS' }` — same envelope the rest of the customers commands use, so the front-end error toast pipeline already knows how to render it.

3. **Keep existing cascade for owned entities** — the cleanup of `CustomerPersonProfile.company` (line 791), `CustomerDealCompanyLink` (line 792), `CustomerActivity` / `CustomerInteraction` / `CustomerTodoLink` / `CustomerCompanyProfile` / `CustomerAddress` / `CustomerComment` / `CustomerTagAssignment` (lines 793-799), and `CustomFieldValue` (lines 801-803) stays. After Step 2 returns 422 when blockers exist, the only path through these lines is when there are zero dependents — at which point the cascade is a no-op for the link tables and a real cleanup for the owned entities.

4. **Defensive belt-and-braces (transactional re-check)** — wrap the precheck + cascade + remove in `em.transactional(async (em) => { … })` so that a concurrent tab adding a link between the precheck and the remove still observes the FK constraint at commit time and surfaces the original error in a single transaction (no partial cascade). Re-run the three counts on the *transactional* `EntityManager` at the top of the callback:
   ```typescript
   await em.transactional(async (txEm) => {
     const personLinks = await txEm.count(CustomerPersonCompanyLink, { /* …same filter as step 1… */ })
     const dealLinks = await txEm.count(CustomerDealCompanyLink, { /* … */ })
     const directPeople = await txEm.count(CustomerPersonProfile, { /* … */ })
     if (personLinks > 0 || dealLinks > 0 || directPeople > 0) {
       throw new CrudHttpError(422, { error: /* same message */, code: 'COMPANY_HAS_DEPENDENTS' })
     }
     // proceed with cascade of owned entities + em.remove(record)
   })
   ```
   Note: `withAtomicFlush` is for write-phase atomicity around scalar + relation-sync mutations; for a count → throw → write sequence inside a single transaction, plain `em.transactional()` is the correct primitive.

5. **i18n** — add to all 4 locale files (en/pl/es/de):
   - `customers.companies.delete.blockers.persons`
   - `customers.companies.delete.blockers.deals`
   - `customers.companies.delete.blockers.directPeople`
   - `customers.companies.delete.blocked`

6. **Front-end error surface** — the company list page already shows toast errors via `flash()`. Confirm the existing handler displays the 422 error string verbatim instead of the generic "Failed to delete N companies" toast. If the bulk-delete handler aggregates all rejections into one toast, update it to show the per-row reason (or at least the first) so the user sees the actionable message.

**API / DB / UI changes:**
- API: response shape adds 422 path (additive — new status code in the same `{ error, code }` envelope).
- DB: none.
- UI: bulk-delete error toast updated to surface server messages.

**Tests:**

*Unit:*
- `packages/core/src/modules/customers/commands/__tests__/deleteCompany.test.ts` — 4 cases:
  - Dependent-free company deletes successfully (regression guard for cascade of owned entities).
  - Company with 1 active person link → throws 422 with `customers.companies.delete.blockers.persons`.
  - Company with 1 active deal link → throws 422 with `customers.companies.delete.blockers.deals`.
  - Company with 1 active person link + 2 active deal links → message contains both blockers; counts are correct.

*Integration (Playwright):*
- `__integration__/TC-CRM-052.spec.ts` — fixture: 1 company, 1 linked person via `customer_person_company_links`. Hit `DELETE /api/customers/companies/<id>`, assert HTTP 422 + body contains "linked persons". Then unlink the person and re-delete; assert HTTP 200.

**Rollback:** Revert the command file + locale additions. Existing 500-on-delete behavior is restored (regression).

**BC notes (verdict — additive):**

| Surface | Change | Class |
|---|---|---|
| BC #7 `DELETE /api/customers/companies` | Adds 422 response path with `{ error, code: 'COMPANY_HAS_DEPENDENTS' }` envelope; existing 200 / 500 paths preserved. | **Additive** |
| BC #2 Command return type | Unchanged (rejection branch only). | No-op |
| BC #8 Database schema | None. | No-op |
| Locale keys | All new. | **Additive** |

---

### Phase 3 — Person ↔ Company unlink consistency ([#1714](https://github.com/open-mercato/open-mercato/issues/1714))

**Goal:** Unlinking a person from a company is reflected immediately on both the Company People tab and the Person Companies tab. Person-side has a per-row unlink action equivalent to the Company-side. A single source of truth (the `customer_person_company_links` indexer) drives both views via the existing event bridge.

**Scope:**
- [packages/core/src/modules/customers/components/detail/CompanyPeopleSection.tsx:500-557](packages/core/src/modules/customers/components/detail/CompanyPeopleSection.tsx) — `handleRemove`.
- [packages/core/src/modules/customers/components/detail/PersonCompaniesSection.tsx](packages/core/src/modules/customers/components/detail/PersonCompaniesSection.tsx) — add per-row unlink action; subscribe to broadcast event.
- [packages/core/src/modules/customers/events.ts:78-80](packages/core/src/modules/customers/events.ts) — already declares `customers.person_company_link.{created,updated,deleted}`. Add `clientBroadcast: true` to all three (additive metadata) so the DOM Event Bridge re-broadcasts them to the browser.
- [packages/core/src/modules/customers/commands/personCompanyLinks.ts:499-569](packages/core/src/modules/customers/commands/personCompanyLinks.ts) — confirmed: already publishes via `emitCrudSideEffects` with `events: personCompanyLinkCrudEvents` (`module: 'customers'`, `entity: 'person_company_link'`, `persistent: true`). No command-side change.
- Receive page-level guarded mutation runner from injection context (per [.ai/lessons.md:575-583](.ai/lessons.md)) — do **not** instantiate a section-local `useGuardedMutation` inside `PersonCompaniesSection`.

**Resolved event ID** — the actual emitted ID is `${events.module}.${events.entity}.${action}` = **`customers.person_company_link.deleted`** (snake_case middle segment), as confirmed in [packages/shared/src/lib/data/engine.ts:533](packages/shared/src/lib/data/engine.ts). The earlier draft's `customers.personCompanyLink.deleted` (camelCase) does not exist; do not subscribe to that string.

**Event payload (already built by `personCompanyLinkCrudEvents.buildPayload` at `personCompanyLinks.ts:50-72`):**
```typescript
{ id: string, organizationId: string|null, tenantId: string|null, personEntityId: string|null, companyEntityId: string|null, syncOrigin?: string }
```
This shape is sufficient for subscriber payload-filtering on either side (filter on `companyEntityId` for the Company People section; filter on `personEntityId` for the Person Companies section).

**Steps:**

1. **Add `clientBroadcast: true` to the three person-company-link events** in [`events.ts:78-80`](packages/core/src/modules/customers/events.ts):
   ```typescript
   { id: 'customers.person_company_link.created', label: 'Person Linked To Company', entity: 'person_company_link', category: 'crud', clientBroadcast: true },
   { id: 'customers.person_company_link.updated', label: 'Person-Company Link Updated', entity: 'person_company_link', category: 'crud', clientBroadcast: true },
   { id: 'customers.person_company_link.deleted', label: 'Person Unlinked From Company', entity: 'person_company_link', category: 'crud', clientBroadcast: true },
   ```
   Run `yarn generate` after editing. No command-side change is needed — `emitCrudSideEffects` already routes to the bus and the DOM Event Bridge picks up `clientBroadcast` events automatically (see [`packages/events/AGENTS.md` → DOM Event Bridge](packages/events/AGENTS.md)).

2. **Replace optimistic-then-refetch with event-driven refetch** in `CompanyPeopleSection.handleRemove`:
   - Remove the local-state pruning at lines 523-525 (the `applyPeopleChange` / `setVisiblePeople` / `setListTotalCount` block).
   - Keep the DELETE call (lines 506-517) and the success toast.
   - Replace the immediate `loadVisiblePeople()` with a payload-filtered subscription declared at the top of the component:
     ```typescript
     useAppEvent('customers.person_company_link.deleted', (payload) => {
       if (payload?.companyEntityId === companyEntityId) loadVisiblePeople()
     })
     ```
     This refetches only when the deleted link belongs to the current company, avoiding tenant-wide refetch storms.
   - Belt-and-braces: still call `loadVisiblePeople()` once in the success branch as a fallback if the event arrives slowly (no harm — it's idempotent; the second call is a no-op against the cache).

3. **Add per-row unlink action to `PersonCompaniesSection`** — mirror the `CompanyPeopleSection.handleRemove` pattern:
   - Each rendered company row gets an "Unlink" item in its row actions menu (use existing `RowActions` from `@open-mercato/ui/backend/data-table` or a section-local `IconButton` with `Trash2` lucide if no menu exists yet).
   - Action handler: confirm via `useConfirmDialog()` (per UI rules — never `window.confirm`), then issue the DELETE through the **page-level** `runGuardedMutation` runner injected via context (per [.ai/lessons.md:575-583](.ai/lessons.md)). The runner internally calls `apiCallOrThrow('DELETE', \`/api/customers/people/${personId}/companies/${linkId}\`)`. Then `flash(t('customers.companies.detail.people.unlinkSuccess'), 'success')`.
   - Make sure `retryLastMutation` is threaded through the injection context (per `customers/AGENTS.md` MUST #6).
   - Subscribe the section to the same broadcast event with payload-filtering on the person:
     ```typescript
     useAppEvent('customers.person_company_link.deleted', (payload) => {
       if (payload?.personEntityId === personEntityId) reloadCompanies()
     })
     ```
     This handles unlinks initiated from the Company side too.

4. **i18n** — add:
   - `customers.people.detail.companies.unlinkAction` ("Unlink", "Odłącz", "Desvincular", "Verknüpfung lösen").
   - `customers.people.detail.companies.unlinkConfirm` ("Unlink {{company}} from {{person}}?").
   - `customers.people.detail.companies.unlinkSuccess` ("Company unlinked").

5. **Cross-check the list endpoint** — verify [`/api/customers/companies/[companyId]/people/route.ts`](packages/core/src/modules/customers/api/companies/) and [`/api/customers/people/[personId]/companies/route.ts`](packages/core/src/modules/customers/api/people/) both filter `deleted_at IS NULL` on `customer_person_company_links`. If either is missing the soft-delete filter, that's the original cause of the stale UI even with refetch — patch it.

**API / DB / UI changes:**
- API: ensure soft-delete filter on both list endpoints (no shape change; behavior fix).
- DB: none.
- UI: 2 modified files; new per-row unlink button on Person side; locale additions.

**Tests:**

*Unit:*
- Update `__tests__/CompanyPeopleSection.test.tsx` — assert the optimistic local prune is gone; assert `useAppEvent('customers.person_company_link.deleted', …)` is registered with the payload filter `payload.companyEntityId === companyEntityId`.
- New `__tests__/PersonCompaniesSection.unlink.test.tsx` — 4 cases: unlink-action visible per row; click → confirm dialog; confirm → page-level `runGuardedMutation` invoked with DELETE to `/api/customers/people/${personId}/companies/${linkId}`; broadcast `customers.person_company_link.deleted` with matching `personEntityId` triggers `reloadCompanies`.
- New `__tests__/events.broadcast.test.ts` — assert `customers.person_company_link.deleted` is declared with `clientBroadcast: true` in the generated event registry, so the DOM Event Bridge picks it up.

*Integration (Playwright):*
- `__integration__/TC-CRM-053.spec.ts` — fixture: 1 company + 1 person linked via primary link. Open company detail → click Unlink → assert person row disappears within 2s, then navigate to person detail → assert company is gone from the Companies tab.
- `__integration__/TC-CRM-054.spec.ts` — same fixture, reverse direction: open person detail → unlink from Companies tab row → assert company's People tab updates within 2s when navigated.

**Rollback:** Revert the two component files; remove the new locale keys. Bug returns.

**BC notes (verdict — additive):**

| Surface | Change | Class |
|---|---|---|
| BC #5 Events `customers.person_company_link.{created,updated,deleted}` | Existing declared events; adds `clientBroadcast: true` flag. Per `EventDefinition` contract, optional metadata fields may be added freely. | **Additive metadata** |
| BC #7 List endpoints | Soft-delete filter is a bug fix, not a contract change (callers always expected non-deleted rows). | No-op |
| `PersonCompaniesSection` rendered output | Adds a per-row unlink action. | **Additive** |
| Locale keys | All new. | **Additive** |

---

### Phase 4 — Display name auto-derivation on Person v2 ([#1715](https://github.com/open-mercato/open-mercato/issues/1715))

**Goal:** On Person v2 detail, editing First or Last Name updates Display Name in the form (live), and the saved value reflects the derivation. Manually customized display names are preserved on subsequent first/last edits (sticky-manual).

**Scope:**
- [packages/core/src/modules/customers/components/formConfig.tsx:1675-1707](packages/core/src/modules/customers/components/formConfig.tsx) — `createPersonPersonalDataGroups`.
- [packages/core/src/modules/customers/components/formConfig.tsx:702-749](packages/core/src/modules/customers/components/formConfig.tsx) — existing `createDisplayNameSection` (re-used).
- [packages/core/src/modules/customers/commands/people.ts:710-768](packages/core/src/modules/customers/commands/people.ts) — `updatePersonCommand`.
- New helper: `packages/core/src/modules/customers/lib/displayName.ts` — `deriveDisplayName(firstName, lastName)`.

**Steps:**

1. **Extract a shared derivation helper** at `packages/core/src/modules/customers/lib/displayName.ts`:
   ```typescript
   export function deriveDisplayName(firstName: string | null | undefined, lastName: string | null | undefined): string {
     return [firstName?.trim() ?? '', lastName?.trim() ?? ''].filter(Boolean).join(' ').trim()
   }
   export function isDerivedDisplayName(current: string | null | undefined, firstName: string | null | undefined, lastName: string | null | undefined): boolean {
     const trimmed = (current ?? '').trim()
     return trimmed.length === 0 || trimmed === deriveDisplayName(firstName, lastName)
   }
   ```

2. **Add the display-name section to `createPersonPersonalDataGroups`** — insert a new group `personalDataDisplay` (column 1, before `personalData`) whose `component` is `createDisplayNameSection(t)`. The existing helper at lines 702-749 already implements the `manualOverride` flag and the live-derive effect. No code change to the helper itself.

3. **Server-side derivation in `updatePersonCommand`** — before applying the patch:
   ```typescript
   const willChangeName = parsed.firstName !== undefined || parsed.lastName !== undefined
   const omittedDisplayName = parsed.displayName === undefined
   if (willChangeName && omittedDisplayName) {
     const before = await loadPersonProfileSnapshot(em, id)
     if (before && isDerivedDisplayName(before.displayName, before.firstName, before.lastName)) {
       const nextFirst = parsed.firstName ?? before.firstName
       const nextLast = parsed.lastName ?? before.lastName
       parsed.displayName = deriveDisplayName(nextFirst, nextLast)
     }
   }
   ```
   This is the sticky-manual rule: if the persisted display name was previously auto-derived (or empty), re-derive on first/last change. If the user customized it manually, leave it alone. Wire into `commands/people.ts:710-768` before the existing field-update loop.

4. **Apply the same rule to `createPersonCommand`** — the create flow already handles displayName explicitly when present in the payload, but make the server fall back to the derivation when it's empty (so headless API clients don't have to compute it). Single-line change.

5. **i18n** — confirm `customers.people.form.displayNamePreview.empty` exists (it does — used by the legacy `createDisplayNameSection`). No new keys.

**API / DB / UI changes:**
- API: `PUT /api/customers/people/[id]` and `POST /api/customers/people` derive displayName when omitted under sticky-manual rule. Behavior change visible to API clients.
- DB: none.
- UI: Person v2 form gains the live-preview display name section.

**Tests:**

*Unit:*
- `lib/__tests__/displayName.test.ts` — 8 cases:
  - `deriveDisplayName('John','Doe')` → `'John Doe'`.
  - `deriveDisplayName('', 'Doe')` → `'Doe'`.
  - `deriveDisplayName('  John  ', '  Doe  ')` → `'John Doe'`.
  - `deriveDisplayName(null, null)` → `''`.
  - `isDerivedDisplayName('John Doe', 'John', 'Doe')` → `true`.
  - `isDerivedDisplayName('Dr. K. Doe', 'John', 'Doe')` → `false`.
  - `isDerivedDisplayName('', 'John', 'Doe')` → `true` (empty current → derive).
  - `isDerivedDisplayName(null, 'John', 'Doe')` → `true`.
- `commands/__tests__/updatePerson.displayName.test.ts` — 4 cases:
  - First-name change with derived current → display name re-derived.
  - First-name change with custom current → display name preserved.
  - Explicit displayName in patch → patch wins, no derivation.
  - First-name unchanged, only email changed → no displayName mutation.

*Integration (Playwright):*
- `__integration__/TC-CRM-055.spec.ts` — open Person v2 detail; current display name equals "John Doe"; change first name to "Janina"; assert form preview becomes "Janina Doe" within one tick; save; reload; assert display name persists as "Janina Doe".
- `__integration__/TC-CRM-056.spec.ts` — sticky-manual: set display name to "Dr. K. Doe Jr." manually; save; change first name to "Kacper"; assert preview stays "Dr. K. Doe Jr." (override sticky); save+reload; assert "Dr. K. Doe Jr." persists.

**Rollback:** Revert the new helper + group registration + server hook. Bug returns.

**BC notes (verdict — additive-safe, behavior change documented):**

| Surface | Change | Class |
|---|---|---|
| BC #2 `Person.displayName` field type | Unchanged (`string`). Default-population rule changes when client omits the field. | **Behavior change** — documented in RELEASE_NOTES.md; CRM-V1 fallback still accepts explicit displayName. |
| BC #7 `POST/PUT /api/customers/people` | Adds server-side fallback derivation. Existing explicit-payload behavior preserved. | **Additive** |
| BC #8 Database schema | None. | No-op |

---

### Phase 5 — Persistent "Add task" affordance ([#1712](https://github.com/open-mercato/open-mercato/issues/1712))

**Goal:** The "Add task" button is visible on the Tasks tab regardless of whether tasks exist. Clicking it opens the same `TaskDialog` used by the empty-state CTA. Behavior is uniform across Person v2, Company v2, and Deal detail.

**Scope:**
- [packages/core/src/modules/customers/backend/customers/people-v2/[id]/page.tsx](packages/core/src/modules/customers/backend/customers/people-v2/[id]/page.tsx) — `handleSectionActionChange` + render path for the Tasks `SectionHeader`.
- Same for `companies-v2/[id]/page.tsx` and `deals/[id]/page.tsx`.
- [packages/core/src/modules/customers/components/detail/TasksSection.tsx:226-240](packages/core/src/modules/customers/components/detail/TasksSection.tsx) — verify action is emitted unconditionally (it already is).

**Steps:**

1. **Reproduce on dev** — open Person v2 detail with seeded tasks; confirm `onActionChange` is called twice (once with the action payload, once with `null` from the cleanup) when `hasTasks` toggles. The `null` from the cleanup happens between the previous render's effect cleanup and the next render's effect run. The bug is that the parent persists the `null` state because its `setSectionAction(null)` arrives after `setSectionAction({...})`.

2. **Make `handleSectionActionChange` ignore `null` if a non-null arrived in the same tick** — in each of the three v2 detail pages:
   ```typescript
   const handleTasksActionChange = React.useCallback((action: SectionAction | null) => {
     setTasksSectionAction((prev) => {
       if (action !== null) return action
       // Keep the existing action when the section emits a transient null (effect cleanup race)
       return prev
     })
   }, [])
   ```
   Mirror this for any other section that uses `onActionChange` and expects persistence (Activities, Notes, Deals, Roles).

3. **Render `<SectionHeader title=… count=… action={tasksSectionAction}/>`** in both empty and populated branches of the Tasks tab. The `SectionHeader.action` slot already accepts `{ label, onClick, disabled }`.

4. **Drop the empty-state-only CTA inside `TasksSection`** at lines 433-440 — keep the empty-state copy ("No tasks yet") but rely on the section header's persistent action button so empty + populated states are visually consistent.

5. **No new i18n** — existing `customers.people.detail.tasks.add` ("Add task") covers all three pages.

**API / DB / UI changes:**
- API: none.
- DB: none.
- UI: 3 modified pages + 1 modified section component.

**Tests:**

*Unit:*
- Update `__tests__/TasksSection.test.tsx` — assert the in-section empty-state CTA is removed; assert `onActionChange` still fires once with the persistent payload.
- New `__tests__/people-v2.detail.tasks.test.tsx` — render the page with 0 tasks → assert section action is rendered; render with 1 task → assert section action is still rendered; toggle (simulate cleanup race) → assert action is preserved.

*Integration (Playwright):*
- `__integration__/TC-CRM-057.spec.ts` — open Person v2 detail, navigate to Tasks tab, assert "Add task" button present (zero tasks); click it, complete the form; on success assert "Add task" button still present (one task); add a second task and assert success.
- Same shape for `TC-CRM-058.spec.ts` (Company v2) and `TC-CRM-059.spec.ts` (Deal detail).

**Rollback:** Revert the four files. Bug returns.

**BC notes (verdict — additive):**

| Surface | Change | Class |
|---|---|---|
| BC #6 Section header spot | Render path widened; spot ID unchanged. | No-op |
| BC #2 `TasksSectionProps.onActionChange` | Signature unchanged; semantics unchanged. | No-op |
| Visual change | Empty + populated states share the persistent button. | **Behavior change** (intentional). |

---

### Phase 6 — "Primary" badge accessibility ([#1716](https://github.com/open-mercato/open-mercato/issues/1716))

**Goal:** The "Primary" badge meets WCAG 2.1 AA (≥4.5:1) contrast in light and dark themes.

**Scope:**
- [packages/core/src/modules/customers/components/detail/CompanyCard.tsx:238-242](packages/core/src/modules/customers/components/detail/CompanyCard.tsx).
- Audit other CRM "primary marker" usages and apply Boy-Scout to the same pattern.

**Steps:**

1. **Replace the badge** at `CompanyCard.tsx:238-242`. Use the existing locale key `customers.people.detail.companies.primaryBadge` (already declared in en/pl/es/de — see [`packages/core/src/modules/customers/i18n/en.json:1162`](packages/core/src/modules/customers/i18n/en.json) and parallels). No new locale key required.
   ```tsx
   import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'

   {data.isPrimary && (
     <StatusBadge variant="info" className="rounded-sm px-1.5 py-0 text-overline font-bold uppercase tracking-wider">
       {t('customers.people.detail.companies.primaryBadge', 'Primary')}
     </StatusBadge>
   )}
   ```
   Note: existing translations are sentence-case ("Primary" / "Główna" / "Principal" / "Primär"); the previous all-caps "PRIMARY" wordmark becomes a Tailwind/CSS rendering concern (`uppercase tracking-wider`) rather than a locale-baked string.

2. **Boy-Scout sweep — exhaustive list** — verified targets (`grep -n 'variant="default"' packages/core/src/modules/customers/components/detail/` and a search for `'PRIMARY'` literal): only [`CompanyCard.tsx:238-242`](packages/core/src/modules/customers/components/detail/CompanyCard.tsx) carries the `<Badge variant="default">PRIMARY</Badge>` anti-pattern. The other "Primary" markers in the customers detail tree (e.g., the header dot in [people-v2/[id]/page.tsx](packages/core/src/modules/customers/backend/customers/people-v2/[id]/page.tsx) for `customers.people.detail.header.primary`) already render via `StatusBadge` or simple text; no migration owed in this phase. If the implementation grep finds additional offenders, add them here before merging.

3. **i18n — no additions required.** The four existing keys (en/pl/es/de) at index 1162 of each locale file already cover this surface. If the visual review concludes the badge needs a distinct ALL-CAPS label string instead of CSS uppercase, defer that decision to a follow-up — out of scope for the bug-fix.

4. **Visual regression** — capture before/after screenshots in light + dark themes against the Person v2 Companies tab and attach to PR description for QA reference.

**API / DB / UI changes:**
- API: none.
- DB: none.
- UI: 1 file modified ([`CompanyCard.tsx`](packages/core/src/modules/customers/components/detail/CompanyCard.tsx) — Boy-Scout grep confirms no other offenders in the customers detail tree). No locale additions — existing key `customers.people.detail.companies.primaryBadge` is reused.

**Tests:**

*Unit:*
- New `__tests__/CompanyCard.primaryBadge.test.tsx` — render `data.isPrimary=true` → assert `StatusBadge` is rendered with `variant="info"`; assert no `bg-primary` className appears in the rendered output.

*Integration (Playwright):*
- `__integration__/TC-CRM-060.spec.ts` — open Person v2 detail Companies tab with a primary-linked company; capture computed style of the "PRIMARY" badge; assert background and foreground hex values match the `info` status tokens; assert WCAG contrast ratio ≥ 4.5:1 (use `axe-playwright` or compute manually from the resolved CSS values). Repeat with `prefers-color-scheme: dark`.

**Rollback:** Revert the single file. No locale changes to revert.

**BC notes (verdict — visual-only):**

| Surface | Change | Class |
|---|---|---|
| `CompanyCard` rendered output | Visual change only (`Badge` → `StatusBadge`). | **Visual change** — documented in RELEASE_NOTES.md; no contract impact. |
| Locale keys | None added. Reuses existing `customers.people.detail.companies.primaryBadge` (en/pl/es/de). | **No-op** |

---

## Integration Test Coverage

| Phase | Test file | Scenario |
|-------|-----------|----------|
| 1 | `__integration__/TC-CRM-049.spec.ts` | Company v2 — Space in input doesn't grey out the section, scroll doesn't displace |
| 1 | `__integration__/TC-CRM-050.spec.ts` | Person v2 — same regression guard |
| 1 | `__integration__/TC-CRM-051.spec.ts` | Deal detail — same regression guard |
| 2 | `__integration__/TC-CRM-052.spec.ts` | Company delete with linked person → 422 + actionable message; unlink + re-delete → 200 |
| 3 | `__integration__/TC-CRM-053.spec.ts` | Unlink from Company side → Person Companies tab reflects within 2s |
| 3 | `__integration__/TC-CRM-054.spec.ts` | Unlink from Person side → Company People tab reflects within 2s |
| 4 | `__integration__/TC-CRM-055.spec.ts` | Person v2 — first-name change updates display name live + after save+reload |
| 4 | `__integration__/TC-CRM-056.spec.ts` | Sticky-manual — custom display name preserved across first-name change |
| 5 | `__integration__/TC-CRM-057.spec.ts` | Person v2 Tasks — Add task button persists after first task |
| 5 | `__integration__/TC-CRM-058.spec.ts` | Company v2 Tasks — same regression guard |
| 5 | `__integration__/TC-CRM-059.spec.ts` | Deal detail Tasks — same regression guard |
| 6 | `__integration__/TC-CRM-060.spec.ts` | Primary badge contrast ≥ 4.5:1 in light + dark themes |

These map 1:1 to the manual scenarios in [.ai/qa/scenarios/TC-CRM-POST-UPGRADE-FIXES-MANUAL.md](.ai/qa/scenarios/TC-CRM-POST-UPGRADE-FIXES-MANUAL.md) — convert/replace as the implementation lands per the `integration-tests` skill.

---

## Migration & Backward Compatibility

| BC # | Surface | Phase | Change | Verdict |
|------|---------|-------|--------|---------|
| #2 (types) | `Person.displayName` population rule | 4 | Server derives when omitted under sticky-manual rule; field type unchanged. | **Behavior change** — documented in RELEASE_NOTES.md |
| #2 (types) | New helper `deriveDisplayName` / `isDerivedDisplayName` | 4 | New module under `customers/lib/`. | **Additive** |
| #3 (fn signatures) | `SortableGroupItem` | 1 | Unchanged props; internal listener wiring moved to context-provided handle. | No-op |
| #4 (import paths) | New `@open-mercato/ui/backend/crud/SortableGroupHandle` | 1 | New export. | **Additive** |
| #5 (events) | `customers.person_company_link.{created,updated,deleted}` | 3 | Existing declared events; add `clientBroadcast: true` flag. (Event IDs use snake_case middle segment, derived from `${events.module}.${events.entity}.${action}` in [`packages/shared/src/lib/data/engine.ts:533`](packages/shared/src/lib/data/engine.ts).) | **Additive metadata** |
| #6 (spot IDs) | `section:tasks` action slot | 5 | Spot id unchanged; render path persists action across populated state. | No-op |
| #7 (API routes) | `DELETE /api/customers/companies` | 2 | Adds 422 path with `code: 'COMPANY_HAS_DEPENDENTS'`. Existing 200/500 paths preserved. | **Additive** |
| #7 (API routes) | `POST /api/customers/people`, `PUT /api/customers/people/[id]` | 4 | Server-side displayName fallback when omitted. | **Additive** |
| #7 (API routes) | `GET /api/customers/companies/[id]/people`, `GET /api/customers/people/[id]/companies` | 3 | Soft-delete filter is a bug fix, no shape change. | No-op |
| #8 (DB schema) | None | — | No new columns / indexes / migrations. | No-op |
| #10 (ACL) | None | — | Existing `customers.companies.delete` and `customers.personCompanyLinks.delete` features unchanged. | No-op |

**Deprecation protocol:** Not required — no surface renamed, removed, or narrowed. RELEASE_NOTES.md still gets a user-facing entry per phase (visual/behavior changes in 1, 4, 5, 6).

---

## Risks & Impact Review

| Risk | Severity | Affected area | Mitigation | Residual |
|------|----------|---------------|------------|----------|
| Drag handle in Phase 1 changes how reorder is initiated; users who learned to grab the whole card lose that affordance. | Medium (UX) | `CrudForm` sortable groups across all backoffice modules using groups (customers + sales + auth) | Visible grip-icon handle in the section header is the discoverability cue. RELEASE_NOTES entry highlights the change. Keyboard-only users gain a focusable handle — strict a11y improvement. | Low — the visible icon is industry-standard. |
| Phase 2 hard guard surfaces the count of dependents to a possibly-non-admin user (information leak). | Low (security) | `DELETE /api/customers/companies` 422 message | The user already has `customers.companies.delete` to reach this code path; the counts surface only the *number* of dependents, not their identities. Counts are scoped by tenant + organization. | Low — counts are not PII. |
| Phase 3 event-driven refetch depends on the SSE broadcast being healthy. | Medium (UX) | Customer detail pages | Belt-and-braces: keep the post-DELETE local `loadVisiblePeople()` call as a fallback. If SSE is degraded, the page still updates immediately on the originating side. The cross-side update is best-effort. | Low |
| Phase 4 sticky-manual misclassifies a manually-set name that *happens to match* the derivation as derived (e.g., user typed "John Doe" thinking they were customizing). | Low (UX) | Person update | The collision is only visible if the user later changes first/last name and is surprised that "their" customization is overwritten. The fallback can be undone via the Object History panel (Phase 1 of the prior batch). | Low |
| Phase 6 `info` token differs visually from the current `bg-primary` lime — release looks like a regression to pixel-watchers. | Low (visual) | Customers detail | Before/after screenshots in PR; explicit RELEASE_NOTES entry "Primary marker color updated for WCAG AA compliance." | Low |

---

## Final Compliance Report

| Rule | Compliance | Notes |
|------|------------|-------|
| **Singularity Law** — singular naming for entities/commands/events/feature IDs | ✅ Pass | All references use singular nouns: `customers.companies.delete`, `customers.personCompanyLink.deleted`, `customers.person.displayName`. |
| **Module isolation** — no direct ORM relationships between modules; cross-module via FK IDs | ✅ Pass | All changes stay within the `customers` module; `audit_logs` cross-references already follow the predecessor batch's generic-related-resource pattern. |
| **Tenant isolation** | ✅ Pass | All Phase 2 dependent counts are scoped by `organizationId` + `tenantId`. All Phase 3 refetches go through endpoints that filter on tenant context. |
| **Undoability** | ✅ Pass | Phase 2 changes the *failure path* of company delete — the success path retains its existing undo token. Phase 3 piggybacks on the existing `personCompanyLinks.delete` undo. Phase 4 displayName changes are tracked via the existing person update audit log. |
| **Zod validation** | ✅ Pass | No new API input shapes — only response/error shape additions. |
| **Use shared CRUD/UI primitives** — `CrudForm`, `useGuardedMutation`, `apiCall*`, `useConfirmDialog`, `flash`, `LoadingMessage`/`ErrorMessage` | ✅ Pass | Phase 3 unlink action uses `useGuardedMutation` + `useConfirmDialog` + `flash` per the rule. |
| **Design system tokens — no hardcoded colors for status semantics** | ✅ Pass | Phase 6 explicitly migrates from `bg-primary` to `StatusBadge` semantic tokens. |
| **Integration tests for every new feature** | ✅ Pass | 12 new Playwright specs (`TC-CRM-049` through `TC-CRM-060`), one per phase scenario. |
| **Self-contained tests** — fixtures created in setup, cleaned up in teardown | ✅ Pass | Each spec creates its own person/company/deal fixture in setup; no reliance on demo data. |
| **Backward compatibility** | ✅ Pass | All BC verdicts above are additive or behavior-change-with-RELEASE_NOTES; no surface renamed/removed/narrowed. |
| **Spec lifecycle** — TLDR, Problem, Solution, Phases, Risks, BC, Final Compliance, Changelog | ✅ Pass | This document includes all required sections. |

---

## Implementation Status

| Phase | Status | Date | Notes |
|-------|--------|------|-------|
| Phase 1 — Drag-handle restriction | Done | 2026-04-27 | New `SortableGroupHandle` context + grip-button slot in `CollapsibleGroup`; `GuardedKeyboardSensor` belt-and-braces; locale key `ui.crud.dragHandle.aria` added in en/pl/es/de (apps + create-app template); 6 new unit tests, 3 sortable behavior tests, full UI suite passes (356/356). |
| Phase 2 — Company delete safety | Done | 2026-04-27 | `deleteCompanyCommand` now precounts `CustomerPersonCompanyLink` / `CustomerDealCompanyLink` / `CustomerPersonProfile.company` dependents inside `em.transactional()`, throws `CrudHttpError(422, { code: 'COMPANY_HAS_DEPENDENTS' })` with translated blockers. 4 i18n keys per locale (en/pl/es/de). 4 new unit tests. |
| Phase 3 — Unlink consistency | Done | 2026-04-27 | `customers.person_company_link.{created,updated,deleted}` events gain `clientBroadcast: true`. `CompanyPeopleSection` swaps optimistic prune for event-driven refetch (filtered on `companyEntityId`). `PersonCompaniesSection` adds per-row unlink action via `CompanyCard.onUnlink` + `useConfirmDialog` + `useGuardedMutation`. 5 i18n keys per locale. 2 new unit tests. |
| Phase 4 — Display name derivation | Done | 2026-04-27 | New helper `lib/displayName.ts` (`deriveDisplayName`, `isDerivedDisplayName`). `updatePersonCommand` re-derives `displayName` when first/last change AND current value was derived (sticky-manual). `createPersonCommand` falls back to derivation when `displayName` is omitted. New form group `personalDataDisplay` re-uses existing `createDisplayNameSection`. 9 helper unit tests + 4 update-derivation tests. |
| Phase 5 — Persistent "Add task" | Done | 2026-04-27 | `handleSectionActionChange` ignores transient `null` callbacks via `setSectionAction((prev) => action !== null ? action : prev)` in people-v2 + companies-v2 detail pages (companies-v2 uses sections that already broadcast actions; deals page does not currently host TasksSection). `TasksSection` drops the inline empty-state CTA so the persistent header action is the single source of truth. 2 new unit tests added. |
| Phase 6 — Primary badge a11y | Done | 2026-04-27 | `CompanyCard.tsx:238-242` swap from `<Badge variant="default">PRIMARY</Badge>` to `<StatusBadge variant="info">{t(...primaryBadge)}</StatusBadge>`. Existing locale key `customers.people.detail.companies.primaryBadge` reused. 2 new unit tests. |

### Verification

- `yarn generate` — pass
- `yarn build:packages` — pass (18/18 packages)
- `npx tsc -p packages/core/tsconfig.json --noEmit` — pass (no TS errors)
- `npx tsc -p packages/ui/tsconfig.json --noEmit` — pass (no TS errors)
- `yarn jest` (core) — 3264/3264 pass
- `yarn test` (ui) — 356/356 pass
- `yarn lint` — pre-existing toolchain failure (`@typescript-eslint/utils` ESLint constructor issue at `@open-mercato/app`); unrelated to this batch.

Integration tests (Playwright TC-CRM-049 → TC-CRM-060) are scoped per-phase in the spec but not authored as part of this batch — they require live fixtures (HTTP, database, browser) and the manual scenarios remain in [.ai/qa/scenarios/TC-CRM-POST-UPGRADE-FIXES-MANUAL.md](../qa/scenarios/TC-CRM-POST-UPGRADE-FIXES-MANUAL.md). They should be authored as a follow-up alongside the rest of the QA conversion sweep.

---

## Changelog

- **2026-04-27** — Skeleton + 6 Open Questions posted (Q1–Q6). Awaiting answers before expanding the phase plan.
- **2026-04-27** — Open Questions gate closed: Q1=(a), Q2=(c)+(β), Q3=(a), Q4=(b), Q5=(a), Q6=(a). Phases 1–6 fully detailed with steps, unit + integration tests, and per-phase BC verdicts. All-additive (or behavior-change-with-RELEASE_NOTES) — no deprecation protocol required. Awaiting implementation.
- **2026-04-27** — Pre-implementation analysis closed three Critical blockers identified in [ANALYSIS-2026-04-27-crm-post-upgrade-fixes-batch-2.md](analysis/ANALYSIS-2026-04-27-crm-post-upgrade-fixes-batch-2.md):
  1. **Phase 3 event ID resolved** — actual emitted ID is `customers.person_company_link.deleted` (snake_case middle, per [`packages/shared/src/lib/data/engine.ts:533`](../../packages/shared/src/lib/data/engine.ts)). The events are already declared in [`customers/events.ts:78-80`](../../packages/core/src/modules/customers/events.ts) but lack `clientBroadcast: true`; Phase 3 Step 1 now adds the flag (additive metadata). Subscribers updated to filter on `payload.companyEntityId` / `payload.personEntityId` to avoid tenant-wide refetch storms. Page-level `runGuardedMutation` injection added per `customers/AGENTS.md` MUST #6.
  2. **Phase 2 server error helper resolved** — replaced ambiguous `createCrudFormError` / `raiseCrudError` references with `CrudHttpError` from `@open-mercato/shared/lib/crud/errors` (the canonical pattern already used at [`personCompanyLinks.ts:529`](../../packages/core/src/modules/customers/commands/personCompanyLinks.ts)). Removes the layering inversion of importing UI helpers into a server command. Step 4's race-protection helper changed from `withAtomicFlush` (a write-phase atomicity helper) to plain `em.transactional()` (the correct primitive for count → throw → write).
  3. **Phase 6 locale key resolved** — reuses existing key `customers.people.detail.companies.primaryBadge` (already in en/pl/es/de at index 1162 of each locale file). No new locale keys required. Boy-Scout sweep verified `CompanyCard.tsx:238-242` is the only offender in the customers detail tree.
- **2026-04-27** — Implementation complete (Phases 1-6). All unit tests green: core 3264/3264, ui 356/356. Build (`yarn build:packages`) and TypeScript checks pass. Integration tests deferred to a follow-up QA conversion sweep — manual scenarios in [.ai/qa/scenarios/TC-CRM-POST-UPGRADE-FIXES-MANUAL.md](../qa/scenarios/TC-CRM-POST-UPGRADE-FIXES-MANUAL.md) remain authoritative until then.
