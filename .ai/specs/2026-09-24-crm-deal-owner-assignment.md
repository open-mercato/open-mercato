# CRM Deal Owner Assignment in List and Detail Views

## TLDR

**Key Points:**
- Deal ownership (`CustomerDeal.ownerUserId`) is today writable from exactly **one** place in the product — the Pipeline (Kanban) board's bulk-actions bar. This adds owner assignment to the two surfaces users actually work in: the **Deal detail view** and the **Deals list view**.
- Owner is the *sole* recipient of deal won/lost notifications, so a deal nobody can assign is a deal whose closure notifies nobody.

**Scope:**
- Deal detail view: `ownerUserId` becomes a regular field inside `DealForm`, saved through the existing form `PUT` — inheriting optimistic locking, the undo snapshot and dirty-tracking with no new write path. The field is present in **both** the form's edit and create modes (**D7**).
- Deals list view: a second bulk action ("Reassign owner") alongside the existing "Delete", routed through the existing queued `bulk-update-owner` endpoint.
- The standalone **New deal** page gains the same field via its own component tree (**D11**), and create forms default the owner to the current user (**D10**).
- One additive, optional prop on the shared `LookupSelect` primitive so the picker can honour the no-unassignment decision (**D8**).
- No schema change, no new API endpoint, no new ACL feature.

**Concerns:**
- Honouring **D5** (no unassignment) requires a change to a shared UI primitive in `packages/ui`, widening the blast radius beyond the customers module — see **D8**. This is the only part of the plan that leaves the module.
- Unassignment stays unsupported in the UI by decision (**D5**), even though the entire backend accepts `ownerUserId: null`. This leaves a documented gap between API capability and UI capability.

## Design Decisions

Resolved at the Open Questions gate on 2026-09-24.

| # | Decision | Rationale |
|---|----------|-----------|
| **D1** | One spec covering both surfaces | They share the owner-picker component, the staff roster source and the permission gate; splitting would duplicate the design work. Delivery is still phased so each surface ships independently. |
| **D2** | Detail view: owner as a field **inside `DealForm`** | Inherits optimistic locking (`buildOptimisticLockHeader(data.deal.updatedAt)`), the command-layer undo snapshot and dirty-tracking for free. An immediate-save header chip would bypass all three. |
| **D3** | List view: a **bulk action on selected rows**, styled consistently with the existing "Delete" action | Matches the page's established interaction — the selection bar already exists; this adds a second entry to `bulkActions` rather than introducing a new interaction idiom. |
| **D4** | Detail uses the **`PUT` path**; list uses the **queued bulk path** | Single-record edits belong on the synchronous form contract that already enforces locking; multi-record edits keep the progress-tracked worker that already exists. No new endpoint either way. |
| **D5** | **No unassignment.** Behaviour unchanged | Explicit product decision. The new picker, like the existing `ChangeOwnerDialog`, requires a selected user. The existing Kanban dialog is **not** touched. |
| **D6** | Reuse `customers.deals.manage` | Settled from code, not assumption: `PUT /api/customers/deals` and `POST /api/customers/deals/bulk-update-owner` both already require it. Introducing a new feature id would add an ACL contract surface for no behavioural gain. |
| **D7** | `DealForm` exposes owner in **both** create and edit modes | Product decision: the form must behave consistently wherever it appears. `dealCreateSchema` already accepts `ownerUserId` (`:98`), so the create path works unchanged. Side benefit: deals created from a person/company detail page (`DealsSection`, `mode="create"`) can start owned, narrowing the unowned-deal problem in Problem Statement §1. |
| **D11** | The standalone **New deal** page gets the owner field too | Product decision. `/backend/customers/deals/create` renders `CreateDealForm` → `DealDetailsFields`, a component tree separate from `DealForm` that borrows only `dealFormSchema`, so **D7** does not reach it. Without this the product's primary creation page would be the only deal form without an owner — a worse inconsistency than the one D7 fixed. |
| **D10** | Create forms **default the owner to the current user** | Product decision, consistent with `QuickDealDialog:346`, which already self-assigns. Uses the existing `useCurrentUserId()` hook (as `backend/customers/deals/page.tsx:639` does). Directly narrows the unowned-deal problem in Problem Statement §1: the default creation path now produces owned deals. Applies to create mode only — edit mode always seeds from the stored `ownerUserId`. |
| **D9** | **No assignment notification**, on any surface | Product decision: match the existing Kanban bulk assignment. Verified in code — the module defines exactly two notification types, `customers.deal.won` and `customers.deal.lost` (`notifications.ts:5,26`), with subscribers bound only to those events (`subscribers/deal-{closure,lost}-notification.ts:7`). Nothing fires on owner change today, so the new surfaces stay silent too and the product remains uniform. |
| **D8** | Add an additive `allowClear?: boolean` (default `true`) to `LookupSelect`; `DealOwnerSelect` passes `allowClear={false}` | **D5** says unassignment stays unsupported, but `LookupSelect` renders *two* unconditional clear controls (`LookupSelect.tsx:398`, `:426`, both active whenever `value && !disabled`) and exposes no prop to suppress them (`LookupSelectProps`, `:23-44`). Since `dealUpdateSchema` accepts `null`, clearing would persist — silently violating D5. Defaulting the new prop to `true` keeps every existing caller unchanged. The rejected alternative — swallowing `null` inside `DealOwnerSelect` — leaves a visible button that does nothing. |

## Overview

CRM users assign deal ownership from the record they are looking at, or from a list when rebalancing a book of business after a territory change or a departure. Open Mercato supports neither: the only writable surface is the Kanban board, reached by selecting cards and using a bulk dialog that reports "Reassign 1 deals" for a single-record change.

This spec closes that gap on the two surfaces where the work actually happens, reusing the existing write paths rather than adding new ones.

> **Market Reference**: The dominant pattern across open-source CRMs (Odoo CRM, EspoCRM, SuiteCRM, Twenty) is a two-place model — the assigned user is an ordinary, inline-editable field on the record form, and the list view offers a mass "change assigned user" action for rebalancing. We **adopt** both halves. We **reject** two things those products carry: per-row inline editing directly in the grid (it conflicts with this codebase's single-fetch owner-name map and adds a third write path), and owner-derived record visibility (ownership here is attribution and notification routing, never an access boundary — see *Not an access boundary* below).

## Problem Statement

Ownership is assignable from one surface, and it is the surface least suited to the task.

| Surface | Owner today |
|---|---|
| Pipeline (Kanban) board | **The only writable path.** Select cards → bulk-actions bar → "Change owner" → `ChangeOwnerDialog` → `POST /api/customers/deals/bulk-update-owner` (queued job + progress) |
| Deal detail view | Read-only `HeaderChip` (`DealDetailHeader.tsx:298-302`), rendered **only when no pipeline badge is present** (`owner && !pipelineBadgeLabel`), so it is frequently invisible. `DealForm` contains zero owner references |
| Deals list view | Owner is a filterable, sortable column with an avatar — but row actions are Edit / Open in new tab / Delete, and the only bulk action is Delete (`backend/customers/deals/page.tsx:1141-1148`) |
| Map view, company/person Deals section | Display only |

Three consequences follow:

1. **Deals created outside the Kanban board start unowned and are awkward to fix.** `QuickDealDialog` self-assigns to the current user (`:346`) and card duplication copies the source owner (`pipeline/page.tsx:2263`), but `CreateDealForm` has no owner field. Such a deal must be located on the Kanban board and bulk-reassigned to get an owner at all.
2. **Closure notifications silently do nothing for unowned deals.** `deliverDealClosureNotification` returns early when `ownerUserId` is null (`lib/dealClosureNotification.ts:30`) and the owner is the only recipient (`recipientUserId: payload.ownerUserId`). A deal can be won or lost with nobody notified.
3. **Reassigning one deal is modelled as a bulk operation**, enqueuing a background job for a one-field change.

## Current Behaviour (audit)

Established by direct code trace; this is the baseline the design must respect.

**Data.** `CustomerDeal.ownerUserId` — `@Property({ name: 'owner_user_id', type: 'uuid', nullable: true })` (`data/entities.ts:349-350`). Deliberately **not** an ORM relation (the no-cross-module-relationships rule); nothing guarantees the id names a live user.

**Write path.** `commands/deals.ts` — create writes `parsed.ownerUserId ?? null` (:591); update uses `if (parsed.ownerUserId !== undefined) record.ownerUserId = parsed.ownerUserId ?? null` (:862), so an absent key leaves the value untouched while an explicit `null` clears it. The field is carried in the before/after snapshot (:282, :357, :1041), so **undo restores the previous owner**, and it is published on the deal event payload (`events.ts:19`).

**Validation.** `dealCreateSchema.ownerUserId: uuid().optional()`; `dealUpdateSchema` widens to `.optional().nullable()`; `dealsBulkUpdateOwnerSchema.ownerUserId: uuid().nullable()` with `ids` capped at 10 000 (`data/validators.ts:98, 183, 203`).

**Name resolution.** The uuid is meaningless alone. The list resolves it with a **single** call to `fetchAssignableStaffMembers` (`pageSize: 100`), building a `userId → displayName` map shared by the Owner column, the filter options and the KPI strip — commented explicitly as "No per-row fetch" (`backend/customers/deals/page.tsx:644-662`). That roster belongs to the **optional `staff` module**; `lib/assignableStaff.ts:33-45` treats its 404 as an empty page, so with `staff` disabled the CRM still renders but every owner shows as "unknown owner".

**Existing staff pickers.** `ChangeOwnerDialog` (Kanban bulk, `pageSize: 50`), `AssignRoleDialog` (paged), `RoleAssignmentRow` (inline `LookupSelect`, `pageSize: 20`, seeds the current value via `currentUserOptions`), `schedule/ParticipantsField` (paged multi-select). There is **no** shared single-owner form-field component — this spec adds one.

**Reads that depend on owner.** List filtering maps `?ownerUserId=` to `$eq`/`$in` on `owner_user_id` (`api/deals/route.ts:372-375`); `search.ts:59,126` indexes it; `api/deals/summary/route.ts` derives the "top owners" KPI by grouping on `owner_user_id` in raw SQL (`lib/dealsSummaryQueries.ts:92-95`).

**Not an access boundary.** Owner carries no ACL semantics. Deal visibility is tenant/organization scoped only; the sole owner-only privacy model in this module is CRM email integration, unrelated to deals.

## Proposed Solution

Two independent surface changes over one new shared component, with **no new endpoint, no schema change and no new ACL feature**.

1. **`DealOwnerSelect`** — a new shared, searchable single-staff picker built on the existing `LookupSelect` primitive and `fetchAssignableStaffMembers`, seeded with the current owner so the selected name renders before (and independently of) the roster page that contains it.
2. **Detail view** — `DealOwnerSelect` becomes an `ownerUserId` field in `DealForm`'s `baseFields`. It saves with the rest of the form; the existing submit handler already spreads `...payload.base` into the `updateCrud` body, so the value reaches `PUT /api/customers/deals` with no handler change.
3. **Create surfaces** — the same field on both deal-creation paths: `DealForm` in `mode="create"` (**D7**) and the standalone New deal page's separate component tree (**D11**), each defaulting to the current user (**D10**).
4. **List view** — a `reassign-owner` entry in the `DataTable` `bulkActions` array, opening the picker in a dialog and posting the selection to the existing `bulk-update-owner` endpoint, returning `BulkActionExecuteResult.progressJobId` so the table's existing progress plumbing tracks the job.

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| Inline-editable owner chip in `DealDetailHeader` | Saves immediately, bypassing the form's optimistic lock header and the dirty-tracking the header Save button depends on. Also needs its own visibility fix, since the chip currently renders only when no pipeline badge is present. |
| Per-row inline edit in the list's Owner column | Introduces a third write path and conflicts with the single-fetch owner-name map the column is built on. |
| Route single-deal detail saves through `bulk-update-owner` | Turns a synchronous one-field edit into a queued job with a progress toast, and skips optimistic locking entirely. |
| A new `customers.deals.assign` ACL feature | Adds a permanent ACL contract surface (`BACKWARD_COMPATIBILITY.md`) for no behavioural gain — both endpoints already gate on `customers.deals.manage`. |

## Architecture

### New component

`packages/core/src/modules/customers/components/detail/DealOwnerSelect.tsx`

- Wraps `LookupSelect` from `@open-mercato/ui/backend/inputs/LookupSelect`, following the `RoleAssignmentRow` pattern (`:68-81, :132`), passing `allowClear={false}` per **D8**.
- Loads options via `fetchAssignableStaffMembers(query, { pageSize: 20 })`, mapping `AssignableStaffMember → LookupSelectItem` as `{ id: userId, title: displayName, subtitle: email }`.
- Accepts an `initialOption` so the currently-assigned owner displays immediately, mirroring `RoleAssignmentRow.currentUserOptions` — this is what prevents a known-owner deal from rendering blank while the roster loads, or when the owner sits outside the fetched page.
- **Degrades with the `staff` module absent:** `fetchAssignableStaffMembers` already converts the 404 into an empty list, so the control renders empty and disabled-with-hint rather than erroring. No new error path.
- Placed in `components/detail/` because both surfaces consume it; the Kanban `ChangeOwnerDialog` stays untouched per **D5**.

### Detail view

`DealForm.baseFields` gains an `ownerUserId` entry (`type: 'custom'`, `layout: 'half'`, rendering `DealOwnerSelect`), and `DealForm` gains an `initialOwnerOption` prop — consistent with the component's existing `initialPipelineOptions` / `initialPipelineStageOptions` convention.

The detail page passes `initialOwnerOption` from the `data.owner` object it already resolves (`{ id, name, email }`). **No other detail-page change is required**: `initialValues={{ ...data.deal }}` already carries `ownerUserId` (`hooks/types.ts:37`), and `handleFormSubmit` already spreads `...payload.base` into the body (`useDealFormHandlers.ts:46-48`).

Per **D7** the field is *not* gated on `mode`, so it also appears in the create-a-deal flow rendered by `DealsSection` (`:1095`, `mode="create"`). That path posts to `POST /api/customers/deals`, where `dealCreateSchema` already accepts `ownerUserId`; no create-side handler change is needed.

### Standalone create page (D11)

`/backend/customers/deals/create` renders `CreateDealForm` → `DealDetailsFields`, a **separate** component tree that shares only `dealFormSchema`. It therefore needs its own parallel wiring:

- `dealFormTypes.ts` — add `ownerUserId: string` to `BaseValues` and `''` to `EMPTY_VALUES`.
- `DealDetailsFields.tsx` — add a `DealFormField` wrapping `DealOwnerSelect`, positioned with the other half-width attributes.
- `CreateDealForm.tsx` — seed the initial value from `useCurrentUserId()` per **D10**.

Both create surfaces (this page and `DealsSection`) default the owner to the current user and submit through the unchanged `POST /api/customers/deals`. Where that user is absent from the assignable roster, the picker labels the seeded id using the same fallback the list already applies (`ensureCurrentUserFilterOption`).

Flow: `DealForm` → `updateCrud('customers/deals', body)` under `withScopedApiRequestHeaders(buildOptimisticLockHeader(data.deal.updatedAt), …)` → `PUT /api/customers/deals` → `dealUpdateSchema` → `commands/deals.ts:862`. Optimistic locking, the undo snapshot and the deal event payload all apply unchanged.

### List view

`backend/customers/deals/page.tsx` gains:
- `reassignOwnerOpen` / `selectedOwnerRows` state and a `ReassignOwnerDialog` (thin wrapper over `DealOwnerSelect`, matching the dialog conventions of the page's existing confirm flows, including `Cmd/Ctrl+Enter` submit and `Escape` cancel).
- A second `bulkActions` entry `{ id: 'reassign-owner', label: …, icon: UserCircle2, onExecute: handleBulkReassignOwner }`, placed **before** the destructive Delete entry.
- `handleBulkReassignOwner` opens the dialog, resolves the chosen user, posts `{ ids, ownerUserId }` to `/api/customers/deals/bulk-update-owner` via `apiCallOrThrow`, and returns `{ ok: true, progressJobId }` so `DataTable` picks up the existing progress handling (`DataTable.tsx:3086-3095`).
- The mutation is wrapped in the page's existing guarded-mutation context, matching `handleBulkDelete`.

After a successful enqueue the list refreshes and the selection clears, mirroring the Kanban handler.

### Boundaries and coupling

No new cross-module coupling. The only dependency on the optional `staff` module is the pre-existing `fetchAssignableStaffMembers` helper, which already degrades to an empty roster on 404. No new ORM relationship; `owner_user_id` remains an unconstrained FK id.

## Data Models

**No schema change.** `customer_deals.owner_user_id` already exists, is nullable, and is indexed adequately for the existing owner filters. No migration, no `.snapshot-open-mercato.json` update.

**No encryption map change.** `ownerUserId` is an internal user identifier, not PII about a customer, and is consistent with the module's existing treatment of the column.

## API Contracts

**No new or changed endpoints.** Both paths already exist and already accept the payloads this feature sends.

| Path | Method | Feature | Payload | Used by |
|------|--------|---------|---------|---------|
| `/api/customers/deals` | `PUT` | `customers.deals.manage` | `{ id, ownerUserId, …other form fields }` — `dealUpdateSchema` | Detail view (via `updateCrud`) |
| `/api/customers/deals/bulk-update-owner` | `POST` | `customers.deals.manage` | `{ ids: string[], ownerUserId: string }` — `dealsBulkUpdateOwnerSchema` | List view bulk action |

Per **D5**, the UI never sends `ownerUserId: null` on either path. The schemas continue to accept it; this is a deliberate capability gap, not a contract change.

Optimistic locking on the `PUT` path is unchanged and already covered: a concurrent edit yields the standard 409, surfaced by the form's existing conflict bar.

## UI/UX

**Detail view.** Owner appears as a half-width field in the form's Details group, alongside Pipeline / Stage / Amount / Currency. It is a searchable select showing name plus email. Changing it marks the form dirty; it saves with the header Save button like every other field, and Cancel reverts it. The read-only header chip is left as-is — it now reflects a value the user can edit just below it.

**List view.** With rows selected, the selection bar shows **Reassign owner** next to **Delete**, using the same button treatment as the existing action with a `UserCircle2` icon (consistent with the Kanban bar). Choosing it opens a dialog titled with the selected count, offering a searchable staff list; confirming enqueues the job, shows a success flash naming the count, clears the selection and refreshes.

**States.** Loading → `Spinner` inside the picker; empty roster → an explanatory empty message (not an error); in-flight submit → disabled confirm. All strings go through `useT()` with fallbacks, added to `i18n/en.json` and the other four locale files. No hardcoded status colors, no arbitrary text sizes, lucide-react icons only.

## Edge Cases & Failure Scenarios

| Scenario | Behaviour |
|----------|-----------|
| `staff` module disabled (roster 404) | Picker renders an empty list with an explanatory message; existing owners still display via `initialOption`. No error toast, no broken page. |
| Current owner outside the fetched roster page (>20 results, or a departed user) | `initialOption` keeps the name visible and the value intact; saving without touching the field re-sends the same id, so no silent reassignment. |
| Concurrent edit of the same deal (detail) | Existing optimistic-lock 409 surfaces in the form's conflict bar. No new handling. |
| Bulk job fails after enqueue | Existing worker failure path marks the progress job failed; unchanged. |
| Bulk selection spans more rows than the endpoint cap (10 000) | Server rejects via `dealsBulkUpdateOwnerSchema`; surfaced through the standard error flash. |
| User lacks `customers.deals.manage` | Both endpoints already 403, and the failure surfaces through the standard error flash. **No client-side gating is added**, because the page has none today: `backend/customers/deals/page.meta.ts` gates only on `customers.deals.view`, and the existing Delete bulk action is likewise ungated in the client. The new action deliberately matches that existing behaviour rather than introducing a one-off pattern. Tightening client-side gating for *all* deal write affordances is a pre-existing gap and out of scope here. |
| Current user is not an assignable staff member, so the **D10** default names someone outside the roster | Low | The picker seeds the id and labels it via the same fallback the list already uses for this case (`ensureCurrentUserFilterOption`, `page.tsx:668-675`), so it renders as the current user rather than "unknown owner". The value is valid and overridable. |
| Owner id references a deleted user | Pre-existing condition, unchanged — renders as "unknown owner". This spec neither worsens nor fixes it. |

## Risks & Impact Review

**Blast radius — low, but no longer confined to the customers module.** No schema, no endpoint, no ACL change. Two UI files plus one new component in `customers`, **plus one additive prop on a shared `packages/ui` primitive** (**D8**).

**Shared-primitive change (`LookupSelect`).** `allowClear` defaults to `true`, so every current caller — `RoleAssignmentRow`, `AssignRoleDialog`, `ParticipantsField` and any third-party consumer — behaves exactly as before. Only `DealOwnerSelect` opts out. This is the highest-risk element of the plan purely because it touches a widely used primitive; the mitigation is the default value plus a regression test asserting that the clear controls still render when the prop is absent.

**Shared-form change (`DealForm`).** Per **D7** the owner field appears in create mode as well, which means the create-a-deal flow on person/company detail pages (`DealsSection.tsx:1095`) gains an owner control. Intended, and covered by tests; called out here because that surface was not named in the original request.

**Compatibility.** No contract surface from `BACKWARD_COMPATIBILITY.md` is broken: no auto-discovery file, event id, widget spot id, API route, DB column, DI key, ACL feature, notification id or CLI command changes. Two **additive optional props** are introduced — `DealForm.initialOwnerOption` and `LookupSelect.allowClear` — both defaulting to current behaviour. `LookupSelect` is an exported UI primitive, so its prop addition is the one item a reviewer should check against the ADDITIVE-ONLY classification; a defaulted optional prop satisfies it.

**Rollback.** Remove the `bulkActions` entry and the `baseFields` entry; the new component becomes dead code. The `LookupSelect` prop can stay (inert, defaulted) or be reverted independently. No data written by this feature needs undoing — owner changes are ordinary deal updates already covered by the command-layer undo snapshot.

### Risk Register

| Risk | Severity | Affected area | Mitigation | Residual |
|------|----------|---------------|------------|----------|
| `allowClear` regresses existing `LookupSelect` callers (`RoleAssignmentRow`, `AssignRoleDialog`, `ParticipantsField`, third-party) | **High** | `packages/ui` — shared primitive | Default `true` so omission preserves today's behaviour; dedicated regression unit test asserting both clear controls still render without the prop | Low — a caller that already passes an unrelated `allowClear`-named prop would collide; none exists today |
| Owner silently cleared, violating **D5** | Medium | Deal data | `allowClear={false}` on `DealOwnerSelect`; unit test asserts the component cannot emit `null` | Low — the API still accepts `null`, so a direct API caller can still clear; that is pre-existing and by design |
| Owner field in create mode (**D7**) surprises users of the person/company deal-create flow | Low | `DealsSection` create flow | Explicitly decided and documented; covered by unit + integration tests | Low — additive optional field, no required input |
| Stale `initialOwnerOption` shows a departed user as the owner | Low | Deal detail UI | Pre-existing condition (the roster is the source of truth); the seed only ensures the id is not silently lost | Accepted — unchanged from today |
| Bulk reassignment enqueued but worker backlog delays visibility | Low | Deals list UX | Progress job id returned to `DataTable`, which already surfaces progress | Accepted — identical to the existing Kanban flow |

## Phasing

Each phase is independently shippable and leaves the application working.

- **Phase 1 — Shared picker + detail view.** Delivers `DealOwnerSelect` and owner editing on the deal detail page. Standalone value.
- **Phase 2 — List view bulk reassignment.** Consumes the Phase 1 component. Standalone value.

## Implementation Plan

### Phase 1 — Shared picker and detail-view assignment

1. **Add `allowClear?: boolean` (default `true`) to `LookupSelect`** (`packages/ui/src/backend/inputs/LookupSelect.tsx`), guarding both clear controls (`:398`, `:426`). Unit tests: the clear controls still render when the prop is omitted (regression guard for existing callers), and are absent when `allowClear={false}`.
2. **Add `DealOwnerSelect`** (`components/detail/DealOwnerSelect.tsx`): `LookupSelect` wrapper over `fetchAssignableStaffMembers` (`pageSize: 20`), accepting `value`, `onChange`, `initialOption`, `disabled`, and passing `allowClear={false}`. Unit test: maps staff to lookup items, renders `initialOption` before the roster resolves, renders the empty state on a 404-derived empty roster, and exposes no way to emit `null`.
3. **Add the `ownerUserId` field to `DealForm.baseFields`** (`type: 'custom'`, `layout: 'half'`) and the optional `initialOwnerOption` prop. Per **D7** the field is added unconditionally — no `mode` guard. Unit tests: the field renders in **both** `mode="edit"` and `mode="create"`, seeds from `initialValues.ownerUserId`, and marks the form dirty on change.
4. **Wire the standalone create page (D11)**: add `ownerUserId` to `BaseValues` / `EMPTY_VALUES` in `dealFormTypes.ts`, render `DealOwnerSelect` via `DealFormField` in `DealDetailsFields.tsx`, and seed it from `useCurrentUserId()` in `CreateDealForm.tsx`. Unit test: the field renders and the payload carries `ownerUserId`.
5. **Default create-mode owner to the current user (D10)** in `DealForm` as well, so both create surfaces behave identically. Unit test: create mode seeds the current user; edit mode still seeds the stored owner.
6. **Pass `initialOwnerOption` from the detail page** using the already-resolved `data.owner`. No other wiring needed — `initialValues` and the submit spread already carry the field. Test: submitting after an owner change sends `ownerUserId` in the `updateCrud` body with the optimistic-lock header intact.
7. **Add i18n keys** to `i18n/en.json` + the four other locales; run `yarn i18n:check-hardcoded`.
8. **Integration test `TC-CRM-<issue>`** — detail view: load a deal, change the owner, save, assert persistence via `GET /api/customers/deals/[id]` and that a concurrent stale save still yields 409. Self-contained fixtures created and torn down in the test (`helpers/integration/crmFixtures.ts`).
9. **Integration test `TC-CRM-<issue>`** — create paths (**D7**, **D11**): create a deal with an owner selected from both the standalone New deal page and a person/company detail page, asserting `POST /api/customers/deals` persists `ownerUserId` in each case, and that an untouched form persists the **D10** current-user default.

### Phase 2 — List-view bulk reassignment

10. **Add `ReassignOwnerDialog`** to the deals list (thin wrapper over `DealOwnerSelect`), with `Cmd/Ctrl+Enter` submit and `Escape` cancel.
11. **Add the `reassign-owner` bulk action** to `bulkActions`, ordered before Delete, with `handleBulkReassignOwner` posting to `bulk-update-owner` inside the page's guarded-mutation context and returning `{ ok, progressJobId }`. Unit test: the action posts the selected ids and the chosen user, and surfaces the progress job id.
12. **Clear selection and refresh** on success; flash the count. Test: selection resets after a successful enqueue.
13. **Add i18n keys** for the new action, dialog and flashes across all five locales.
14. **Integration test `TC-CRM-<issue>`** — list view: select multiple deals, reassign, await the queued job, assert every selected deal carries the new owner and that a caller lacking `customers.deals.manage` receives 403.

### Validation

`yarn generate` is **not** required (no auto-discovery files change). `yarn build:packages` **is** required before the app picks up the `LookupSelect` change, since `packages/ui` is consumed from `dist`. Gate: `yarn build:packages`, `yarn typecheck`, `yarn lint`, `yarn test`, then the three integration specs.

## Test Coverage

| Path | Type | Phase |
|------|------|-------|
| `PUT /api/customers/deals` (owner field) | Integration | 1 |
| `POST /api/customers/deals` (owner on create, **D7**) | Integration | 1 |
| `POST /api/customers/deals/bulk-update-owner` (from list) | Integration | 2 |
| Deal detail → change owner → save | Integration (UI) | 1 |
| Create deal from person/company with owner (**D7**) | Integration (UI) | 1 |
| Standalone **New deal** page with owner (**D11**) | Integration (UI) | 1 |
| Create forms seed the current user as owner (**D10**) | Unit | 1 |
| Deals list → select → Reassign owner → confirm | Integration (UI) | 2 |
| `LookupSelect` clear controls present by default / absent with `allowClear={false}` (**D8** regression guard) | Unit | 1 |
| `DealOwnerSelect` rendering, seeding, empty roster, cannot emit `null` | Unit | 1 |
| `DealForm` owner field in edit **and** create mode; dirty-tracking and payload | Unit | 1 |
| Bulk action payload and progress-id passthrough | Unit | 2 |

## Final Compliance Report

| Rule | Status | Note |
|------|--------|------|
| Singular entity/command/event naming | ✅ | No new entities, commands or events. |
| No cross-module ORM relationships | ✅ | `owner_user_id` stays an unconstrained FK id. |
| Organization/tenant scoping | ✅ | Inherited from both existing endpoints. |
| Zod validation on all inputs | ✅ | Reuses `dealUpdateSchema` / `dealsBulkUpdateOwnerSchema` unchanged. |
| Encryption maps for sensitive columns | ✅ | N/A — internal user id, not customer PII. |
| Canonical primitives | ✅ | `CrudForm`/`DealForm`, `DataTable` `bulkActions`, `LookupSelect`, `apiCall`/`updateCrud`, guarded mutations. No raw `fetch`. |
| Optimistic locking on edit | ✅ | Detail path inherits the existing `updatedAt` header; bulk path keeps per-record locks in the worker. |
| Undo contract | ✅ | Owner already participates in the command before/after snapshot; no new undo logic needed. |
| Design System tokens | ✅ | Semantic tokens only, DS text scale, lucide-react icons, dialog `Cmd/Ctrl+Enter` / `Escape`. |
| i18n — no hardcoded user-facing strings | ✅ | All strings via `useT()` across five locales. |
| Backward compatibility | ✅ | Two additive optional props (`DealForm.initialOwnerOption`, `LookupSelect.allowClear`), both defaulting to current behaviour. `LookupSelect` is an exported primitive — additive-only classification satisfied. |
| Integration coverage for affected API + UI paths | ✅ | Listed above, shipping in the same change. |
| Optimistic locking for new editable entity | N/A | No new entity. |

## Changelog

| Date | Change |
|------|--------|
| 2026-09-24 | Skeleton created; Open Questions Q1–Q6 raised. |
| 2026-09-24 | Q1–Q5 answered by product; Q6 resolved from code (both endpoints already gate on `customers.deals.manage`). Full spec written: design decisions, architecture, phased plan, compliance report. |
| 2026-09-24 | Adversarial scope review (fresh context): verdict COHESIVE, no split required, phasing honest, no bloat. Three omissions fixed — **D8** added after verifying `LookupSelect` renders two unconditional clear controls with no suppression prop (D5 was otherwise unenforceable); the client-side permission-gating claim corrected to match the page's actual behaviour (no such gating exists today); dangling **D3** cross-reference repaired. |
| 2026-09-24 | **D7** added: product decided `DealForm` exposes owner in both create and edit modes for consistency. Plan, tests and risk register updated accordingly. |
| 2026-09-24 | **D8** confirmed by product (optional prop, non-breaking). Second gate opened — Q7–Q9 raised after discovering the standalone create page does not use `DealForm`. |
| 2026-09-24 | **D9** resolved: no assignment notification, matching the Kanban bulk path (verified — only `customers.deal.won` / `customers.deal.lost` notification types exist). |
| 2026-09-24 | **D10** resolved: create forms default the owner to the current user via `useCurrentUserId()`, matching `QuickDealDialog`. |
| 2026-09-24 | **D11** resolved: the standalone New deal page gains the field via its own component tree. All Open Questions closed; gate removed. Spec complete. |
