# Record Locks — Unified Coverage Across CRM v2 and All OSS Lock Sites

## TLDR

**Key Points:**
- Evolve the enterprise `record_locks` module so its full experience (pessimistic locks, optimistic/action-log conflict detection, presence indicators, merge/conflict dialog) reaches **every place the OSS `updated_at` optimistic-lock guard is wired today** — starting with the CRM v2 screens that have no live locking, then fanning out module-by-module.
- Keep the existing enterprise capability set intact (no feature regression); achieve coverage with the **minimum number of integration changes** by reusing the existing widget-injection + `crudMutationGuardService` DI seam rather than rebuilding the module.

**Scope:**
- **Phase 1 — CRM v2 (deal, company, person):** make record_locks fully functional on the v2 detail screens (presence + acquire/heartbeat on load + pessimistic block + conflict/merge dialog), including the Deal screen's custom `DealForm` + custom stage/closure command endpoints which today are completely unwired.
- **Phase 2+ — one module per phase (customers-first), covering EVERY module with editable entities:** customers (subforms + deletes) → sales (documents, sub-resources, config dialogs) → catalog → auth + directory + staff + resources → platform-config modules (dictionaries, currencies, workflows, feature_toggles, business_rules) → cross-cutting delete sweep. Every entity audited by the OSS `optimistic-lock-editable-entities.test.ts` gets a record_locks decision (enabled, or intentionally exempt with a documented reason).

**Concerns:**
- Avoiding **double conflict UX** (OSS `updated_at` 409 + conflict bar AND record_locks 409 + merge dialog firing for the same save). Resolved by the **single-guard model** (Q1 = replace via DI seam).
- The Deal screen uses a bespoke mutation pipeline (not `CrudForm.updateCrud`), so it needs more than a prop flip.
- Enterprise-only module extending OSS call sites **without** creating cross-module ORM coupling or breaking the OSS-only build: all integration flows through injection spots + DI seams, never `core → enterprise` imports.

## Overview

The enterprise `record_locks` module (`packages/enterprise/src/modules/record_locks/`, SPEC-ENT-003) provides collaborative-editing safety: a `record_locks` table tracking active pessimistic/optimistic locks, a `record_lock_conflicts` table, presence/heartbeat lifecycle APIs, action-log–based conflict detection, in-app notifications, and a 1,492-line injection widget that renders presence banners and a field-level merge dialog. It opts in automatically by injecting at three spots: `backend:record:current` (priority 600, page-load presence/acquire), `backend-mutation:global` (priority 500, custom mutation error handling), and `crud-form:*` (priority 400, form-scoped locking).

In parallel, the OSS `updated_at` optimistic-lock guard (SPEC `2026-05-25-oss-optimistic-locking`, `-05-28-coverage-completion`, `-05-29-all-crudforms`, SPEC-035 mutation-guard-mechanism) was rolled out **default-ON** across every `makeCrudRoute` entity and most CRUD UIs, with two regression guard tests (`optimistic-lock-editable-entities.test.ts`, `optimistic-lock-ui-coverage.test.ts`) enforcing coverage. The result: the platform now has **two locking systems**, and record_locks reaches only a subset of the sites the OSS guard covers.

This spec unifies them: where record_locks is enabled, it becomes the **single** guard (replacing the OSS guard via the existing `crudMutationGuardService` and `createCommandOptimisticLockGuardService({ resolveExpected })` seams) and the **single** conflict surface (merge dialog supersedes the conflict bar); where it is disabled/absent, the OSS guard remains the fallback. Then it extends that unified guard to every OSS lock site, CRM v2 first.

> **Market Reference**: Studied **Atlassian Jira/Confluence** (optimistic save + edit-conflict dialog + presence avatars), **Salesforce record locking** (pessimistic record lock with admin force-unlock), and **MediaWiki edit conflicts** (3-way merge view). We **adopt** their presence-indicator + last-writer-guard + field-level merge-dialog model (already implemented in record_locks). We **reject** full operational-transform / CRDT real-time co-editing (Google Docs style) as disproportionate for back-office CRUD — the existing acquire/heartbeat + action-log diff is the right altitude.

## Problem Statement

1. **CRM v2 screens have no live locking.** The v2 detail pages render their own injection spots (`detail:customers.{person|company|deal}:header|status-badges|footer`) and embed `CrudForm`, but **none render `backend:record:current`** — so the presence/acquire/heartbeat lifecycle never starts on page load. Person/Company v2 pass `injectionSpotId="customers.person|company"`, so the *save-time* `crud-form:*` widget mounts and a conflict can surface — but there is no "Jane is editing this record" banner and no pessimistic pre-acquire.
2. **The Deal screen is fully unwired.** `DealForm` (`components/detail/DealForm.tsx`) wraps `CrudForm` with a custom `useDealMutationContext` / `runMutationWithContext` pipeline, passes **no** `injectionSpotId` and **no** `versionHistory`, so the injection context carries no `resourceKind`/`resourceId`; the record_locks widget cannot resolve the resource and the acquire call no-ops. Stage-change and Won/Lost closure go through **custom command endpoints** that send no lock headers and have no server-side guard.
3. **Two parallel systems, partial overlap.** record_locks and the OSS `updated_at` guard can both produce a 409 for the same save, yielding a double conflict surface (conflict bar + merge dialog). There is no single decision point for "which guard owns this resource."
4. **Coverage gap vs. OSS.** The OSS guard is wired (and regression-tested) across customers, sales documents + sub-resource sections, catalog, settings dialogs, and delete flows. record_locks reaches only the auto-injected `crud-form:*` subset. Sites that guard at the command layer (sales document aggregates) or via raw `useGuardedMutation` are invisible to record_locks today.

## Proposed Solution

### S1 — Single-guard model (Q1: replace via DI seam)
record_locks already registers `crudMutationGuardService` in its `di.ts`, overriding the OSS CRUD-layer guard for all `makeCrudRoute` paths when the module is active. Extend the same pattern to the **command layer**: record_locks registers an override of `createCommandOptimisticLockGuardService` (the `{ resolveExpected }` seam, issue #2232) so command/action endpoints (`enforceCommandOptimisticLock` call sites) defer to record_locks' action-log conflict detection when the resource is enabled, and fall back to the OSS `updated_at` comparison otherwise. Resource enablement uses the existing `isRecordLockingEnabledForResource(settings, resourceKind)` config helper. **No new guard mechanism is invented** — only the existing seams are populated.

### S2 — Reusable presence mount, decoupled from CrudForm
The presence/acquire/heartbeat lifecycle must run on page load independent of any form. Today it depends on `backend:record:current` being rendered. **Core (OSS) pages cannot import enterprise**, so the mount is an **injection spot the core page renders** and enterprise injects into. We standardize a single helper in core/UI — `buildRecordInjectionContext({ resourceKind, resourceId, data, updatedAt, path })` — and render `<InjectionSpot spotId="backend:record:current" context={ctx} data={data} />` on each detail screen. This is the reusable primitive every Phase 2+ site adopts: one line + a context object, no enterprise dependency.

### S3 — Unified conflict surface
When record_locks is active for a resource, its merge dialog is the conflict UX; the OSS conflict bar is suppressed for that resource. `surfaceRecordConflict(err, t)` (the single OSS entry point) is taught to **defer** when a record_locks conflict payload is present (the widget's `backend-mutation:global` handler already extracts `record_lock_conflict`), so a 409 routes to exactly one surface. Where record_locks is disabled, `surfaceRecordConflict` behaves exactly as today.

### S4 — Module-by-module rollout using S2 + S1
Every OSS lock site is converted by (a) ensuring its resource is record-lock enabled, (b) rendering the `backend:record:current` mount where a detail/presence experience is wanted, and (c) confirming its write path flows through either the CRUD guard (auto) or the command guard seam (S1). The two OSS regression guard tests are extended with a parallel **record_locks coverage** assertion so new sites can't silently skip locking.

### Design Decisions
| Decision | Rationale |
|----------|-----------|
| Reuse `crudMutationGuardService` + `createCommandOptimisticLockGuardService` seams instead of new guard | Minimal change; seams already exist (SPEC-035, #2232); preserves OSS fallback |
| Presence mount = core-rendered injection spot, not an enterprise component import | Keeps `core` build enterprise-free; honors module isolation |
| Single-guard (replace) over coexistence | Eliminates double-409 / double conflict surface (Q1) |
| No new tables / no schema change | record_locks entities already model everything; lowers migration risk |
| `disableOptimisticLock` stays the per-form escape hatch | Sites guarded at command layer keep suppressing the CRUD-layer header as today |

### Alternatives Considered
| Alternative | Why Rejected |
|-------------|-------------|
| Rebuild record_locks to consume `updated_at` instead of action logs | Discards richer field-level diff + presence; large rewrite for no user gain |
| Make core pages import an enterprise `<RecordLockMount>` component | Breaks OSS-only build + module isolation (`core → enterprise` forbidden) |
| Coexistence with de-dup heuristics | Fragile; two 409 shapes, two surfaces, ordering-dependent UX |

## User Stories / Use Cases
- **A sales rep** editing a Deal **sees a banner** when a colleague opens the same Deal, so they avoid clobbering each other.
- **A CRM manager** who changes a Deal's stage while someone else edited it **gets a merge dialog** (accept incoming / keep mine) instead of a silent overwrite.
- **An admin** can **force-release** a stale lock on any company/person/deal (existing `record_locks.force_release` feature) from the presence banner.
- **A developer** adding a new detail screen renders **one injection spot** and gets presence + conflict handling for free.

## Architecture

### Guard layering (per resource, evaluated server-side)
```
Mutation request (CRUD route OR command endpoint)
        │
        ▼
 crudMutationGuardService / commandOptimisticLockGuardService  (DI-resolved)
        │
  record_locks active for resourceKind?  ── no ──▶ OSS updated_at compare ──▶ 409 optimistic_lock_conflict
        │ yes
        ▼
 record_locks.validateMutation (action-log diff, conflict record)
        │
  conflict? ── yes ──▶ 409 record_lock_conflict (+ conflict payload)
        │ no
        ▼
      proceed
```

### Client mount + conflict resolution (per detail screen)
```
Detail page (core) renders:
  <InjectionSpot spotId="backend:record:current" context={buildRecordInjectionContext({...})} data={data} />
        │ (enterprise widget injected here, pri 600)
        ▼
  acquire → presence banner + heartbeat loop
        │
  on save 409 (record_lock_conflict) → widget merge dialog (accept incoming / keep mine / keep editing)
        │
  surfaceRecordConflict(err, t) defers when record_locks payload present (single surface)
```

### Resource-kind resolution
The widget's existing `resolveResourceKind(context)` already supports `context.resourceKind`, `personId`/`companyId`/`dealId`, `entityId` with `:`, and `/backend/customers/{people|companies|deals}/…` path fallbacks. Phase 1 guarantees `resourceKind` + `resourceId` are **explicit** in the injection context for all three screens (no reliance on path heuristics).

### Commands & Events (existing — reused, not redefined)
- **Commands**: `record_locks.conflict.accept_incoming`, `record_locks.conflict.accept_mine`.
- **Events**: `record_locks.lock.acquired|released|force_released|contended`, `record_locks.participant.joined|left`, `record_locks.conflict.detected|resolved`, `record_locks.record.deleted`, `record_locks.incoming_changes.available`.
- **Deal command endpoints** (stage change, closure) accept the existing `x-om-record-lock-*` headers; no new event/command IDs are introduced.

## Data Models
**No schema changes.** Phase work reuses existing entities:
- `RecordLock` (`record_locks` table) — id, resource_kind, resource_id, token, strategy, status, locked_by_user_id, locked_at, last_heartbeat_at, expires_at, released_*, tenant_id, organization_id, base_action_log_id, timestamps.
- `RecordLockConflict` (`record_lock_conflicts` table) — conflict lifecycle, resolution, base/incoming action-log ids.

All CRM v2 entities already expose `updated_at` (camel + snake in API responses), satisfying both the OSS guard fallback and the action-log base resolution.

## API Contracts
**No new endpoints.** Reuse existing `/api/record_locks/{acquire|heartbeat|release|validate|force-release|settings}`. New behavior is server-side guard wiring only:
- Deal custom command endpoints (stage-change, closure) — read `x-om-record-lock-*` (and OSS `x-om-ext-optimistic-lock-expected-updated-at`) headers and route through the command guard seam; on conflict return the same `409` shapes already defined (`record_lock_conflict` when record_locks active, else `optimistic_lock_conflict`).
- `createCommandOptimisticLockGuardService({ resolveExpected })` — enterprise registers a `resolveExpected` that derives the expected base from the latest action log for the resource (parity with `validateMutation`).

## Internationalization (i18n)
- Reuse existing record_locks i18n keys (presence, conflict dialog, force-release) in en/de/es/pl.
- Any new banner/affordance strings added in core detail screens route through `useT('customers.*')` / framework keys; no hardcoded user-facing strings. Internal-only `throw`/`toast` prefixed `[internal]`.

## UI/UX
- **Presence banner**: existing record_locks widget banner, mounted via `backend:record:current` on each CRM v2 screen (header zone). Uses semantic status tokens + `StatusBadge`/`Alert` primitives (no hardcoded colors).
- **Merge dialog**: existing widget dialog (field-level `ChangedFieldsTable`, "Accept incoming" / "Keep my changes" / "Keep editing"), `Cmd/Ctrl+Enter` submit, `Escape` cancel.
- **Deal**: banner in `detail:customers.deal:header` zone via the standardized mount; stage-change/closure controls surface the merge dialog on 409.
- **Boy Scout**: any touched lines on v2 pages migrated to semantic tokens / shared primitives.

## Implementation Plan

> Each step results in a working, testable app. Phase 1 ships the full CRM v2 experience; Phase 2+ adds one module/lock-site per phase (customers-first per Q4).

### Phase 1 — CRM v2 (deal, company, person): full locking
1. **Core: standardized presence mount.** Add `buildRecordInjectionContext(...)` helper (UI/core) and render `<InjectionSpot spotId="backend:record:current" context={...} data={...} />` on `people-v2/[id]/page.tsx`, `companies-v2/[id]/page.tsx`, and `deals/[id]/page.tsx`, with explicit `resourceKind` (`customers.person|company|deal`), `resourceId`, `updatedAt`, and `path`.
2. **Core: Deal form injection.** Pass `injectionSpotId="customers.deal"` (and resource/version context) from `DealForm` to its embedded `CrudForm` so the `crud-form:customers.deal` widget mounts with a resolvable resource.
3. **Core: Deal command headers.** Wrap stage-change and Won/Lost closure calls (`useDealPipeline` / `useDealClosure`) in `withScopedApiRequestHeaders(buildOptimisticLockHeader(dealUpdatedAt), …)` and route 409s through `surfaceRecordConflict(err, t, { onRefresh })`.
4. **Core: Deal command server guard.** Guard the deal stage-change/closure command handlers with `enforceCommandOptimisticLock` / the command guard service (parity with sales `enforceSalesDocumentOptimisticLock`), reading the lock headers; default OSS behavior preserved when record_locks disabled.
5. **Enterprise: command guard override.** Register an override of `createCommandOptimisticLockGuardService` with a `resolveExpected` backed by the action log, scoped to enabled resources, so deal command endpoints defer to record_locks conflict detection (S1).
6. **Enterprise/UI: unified conflict surface.** Teach `surfaceRecordConflict` to defer when a `record_lock_conflict` payload is present so only the merge dialog shows (S3); verify `crudMutationGuardService` override already covers the three CRUD routes.
7. **Tests:** integration TC-LOCK-CRM-{person,company,deal} (presence on load, contended lock, save conflict → merge dialog, force-release); unit tests for the command guard seam + `surfaceRecordConflict` deferral.
8. **i18n + DS pass** on all touched screens.

> **Module coverage contract:** Phases 2–6 must collectively cover **every module audited by `optimistic-lock-editable-entities.test.ts`** — `customers`, `sales`, `catalog`, `auth`, `directory`, `staff`, `resources`, `dictionaries`, `currencies`, `workflows`, `feature_toggles`, `business_rules` — plus any module added to that audit after this spec. Each entity ends in one of two states: **record-lock enabled** (presence + unified guard) or **intentionally exempt** (append-only logs, junction/assignment rows, sub-resources guarded by a parent aggregate, state-machine rows) with a one-line reason in the coverage guard test.

> **How to read the per-phase manifests below.** Each phase lists the exact sites to touch, grouped by the three kinds of work this spec defines:
> - **Presence mount** — render `<InjectionSpot spotId="backend:record:current" …>` (S2) on a top-level **detail/edit screen** so acquire/heartbeat/presence starts on load. Today **no core page renders this spot** (it is only declared in `packages/ui/src/backend/injection/spotIds.ts` and injected by `record_locks/widgets/injection-table.ts`); every screen below that wants presence is therefore a net-new one-line mount. **Subforms inherit** the parent screen's mount — they never add their own.
> - **Guard wiring** — ensure the write path runs the unified guard: `<CrudForm>` hosts and `makeCrudRoute` entities are **auto-covered** by `crudMutationGuardService` once the resource is record-lock enabled; **custom** mutation paths (raw `apiCall`, `useGuardedMutation`, command/action endpoints) need the header on the client and the command-guard seam (S1) on the server, then route their 409 to the merge dialog via `surfaceRecordConflict` (S3).
> - **Decision** — every audited entity ends **enabled** (presence + unified guard) or **exempt** (documented reason). Junction/assignment add-remove, reorder/position writes, append-only logs, derived documents, and sub-resource lines guarded by a parent aggregate are the standard exempt classes.
>
> Paths are relative to repo root. `entityId` is the `makeCrudRoute` `indexer.entityType` (also the `crud-form:<entityId>` spot suffix). `resourceKind` is the `record_locks` resource key (`<module>.<entity>`).

### Phase 2 — Customers: subforms, links, config entities, deletes (customers-first)

Phase 1 already mounts presence and guards the header/commands on the three CRM v2 screens. Phase 2 finishes the module: the subforms those screens embed, the link/role/config entities, and every delete.

**Presence mounts:** none new — all customers subforms render inside the Phase-1 person/company/deal detail screens and inherit their `backend:record:current` mount. (Legacy v1 pages `backend/customers/people/[id]/page.tsx` and `companies/[id]/page.tsx` use custom inline `savePerson`/`saveCompany` writes that already send the OSS header; decide per Q whether to retire them or mount presence — default: **retire-track, no new mount** since v2 supersedes them.)

**Guard wiring (custom write paths — already flow through `runMutationWithContext`; add the merge-dialog surface + confirm the command guard covers the entity):**
- **Activities / interactions** — UI `components/detail/ActivitiesSection.tsx`, `ActivityForm.tsx`, `ActivityDialog.tsx`, `ScheduleActivityDialog.tsx`; commands `commands/interactions.ts`, `commands/activities.ts`; routes `api/interactions/route.ts`, `api/activities/route.ts`. State-action endpoints `api/interactions/complete/route.ts`, `api/interactions/cancel/route.ts`, `api/interactions/[id]/visibility/route.ts` are **status transitions** → guard via the command seam or mark exempt (state-machine).
- **Tasks / todos** — `components/detail/TasksSection.tsx`, `TaskForm.tsx`, `TaskDialog.tsx`; command `commands/todos.ts`; route `api/todos/route.ts`.
- **Notes** — `components/detail/notesAdapter.ts`; command `commands/comments.ts`; route `api/comments/route.ts`.
- **Addresses** — `components/detail/AddressesSection.tsx`; command `commands/addresses.ts`; route `api/addresses/route.ts`.

**Links & roles (mostly exempt; only role *attribute* edits guard against the parent entity version):**
- `components/detail/PersonCompaniesSection.tsx`, `CompanyPeopleSection.tsx`, `RolesSection.tsx`, `RoleAssignmentRow.tsx`, `AssignRoleDialog.tsx`, `DealLinkedEntitiesTab.tsx`; commands `commands/personCompanyLinks.ts`, `commands/entity-roles.ts`; routes `api/people/[id]/companies/route.ts`, `api/companies/[id]/people/route.ts`, `api/people/[id]/roles/route.ts`, `api/companies/[id]/roles/route.ts`, `api/deals/[id]/people/route.ts`, `api/deals/[id]/companies/route.ts`.
- Bulk endpoints `api/deals/bulk-update-stage/route.ts`, `api/deals/bulk-update-owner/route.ts` — multi-row writes: apply per-row skip-if-changed or mark exempt with a documented bulk policy.

**Config entities (auto-covered by CRUD guard once enabled; assignment writes exempt):**
- Tags `customers:customer_tag` — `commands/tags.ts`, `api/tags/route.ts`, UI `ManageTagsDialog.tsx`/`EntityTagsDialog.tsx`; `api/tags/assign|unassign` = junction (exempt).
- Labels `customers:customer_label` — `commands/labels.ts`, custom `api/labels/route.ts` (already uses `validateCrudMutationGuard`) + `api/labels/assign|unassign` (exempt).
- Pipelines `customers:customer_pipeline` — `commands/pipelines.ts`, `api/pipelines/route.ts`.
- Pipeline stages `customers:customer_pipeline_stage` — `commands/pipeline-stages.ts`, `api/pipeline-stages/route.ts`; `api/pipeline-stages/reorder/route.ts` = position write (exempt).

**Deletes:** person/company/deal deletes already send the header (Phase 1); confirm activity/task/address/note deletes surface the `record_locks.record.deleted` conflict state.

| Site | Files | entityId / command | Work | Decision |
|------|-------|--------------------|------|----------|
| Activities/interactions | `components/detail/ActivitiesSection.tsx`,`ActivityForm.tsx`; `commands/interactions.ts`,`activities.ts`; `api/interactions/route.ts`,`api/activities/route.ts` | `customers:customer_interaction` / `customers:customer_activity` | merge-dialog surface; status endpoints via command seam | enabled (status txn exempt) |
| Tasks | `components/detail/TasksSection.tsx`,`TaskForm.tsx`; `commands/todos.ts`; `api/todos/route.ts` | `customers:customer_todo_link` | merge-dialog surface | enabled |
| Notes | `components/detail/notesAdapter.ts`; `commands/comments.ts`; `api/comments/route.ts` | `customers:customer_comment` | merge-dialog surface | enabled |
| Addresses | `components/detail/AddressesSection.tsx`; `commands/addresses.ts`; `api/addresses/route.ts` | `customers:customer_address` | merge-dialog surface | enabled |
| Person↔company links / roles | `PersonCompaniesSection.tsx`,`CompanyPeopleSection.tsx`,`RolesSection.tsx`; `commands/personCompanyLinks.ts`,`entity-roles.ts` | role assignment routes | role-attribute edits guard vs parent | exempt (link add/remove); enabled (role fields) |
| Tags / Labels | `commands/tags.ts`,`labels.ts`; `api/tags/route.ts`,`api/labels/route.ts` | `customers:customer_tag`,`customers:customer_label` | enable on entity edit | enabled; assignment exempt |
| Pipelines / stages | `commands/pipelines.ts`,`pipeline-stages.ts`; `api/pipelines/route.ts`,`api/pipeline-stages/route.ts` | `customers:customer_pipeline`,`customers:customer_pipeline_stage` | reorder exempt | enabled; reorder exempt |

Extend the record_locks coverage guard assertion for `customers`; integration TC-LOCK-CUST-{activities,tasks,notes,tags,pipeline}.

### Phase 3 — Sales: documents, sub-resources, config dialogs, deletes

Sales is command-pattern, not `CrudForm`. The order/quote aggregate version is already enforced for most writes by `enforceSalesDocumentOptimisticLock` (in `packages/core/src/modules/sales/commands/shared.ts`, with `SALES_RESOURCE_KIND_ORDER='sales.order'` / `SALES_RESOURCE_KIND_QUOTE='sales.quote'`). The work is (a) route that wrapper through the record_locks command guard seam (S1), (b) mount presence on the document screen, and (c) **close the two verified command-guard gaps**.

**Presence mounts:**
- `backend/sales/documents/[id]/page.tsx` (the shared order/quote detail host; `orders/[id]/page.tsx` and `quotes/[id]/page.tsx` delegate to it) — render `backend:record:current` with `resourceKind` `sales.order`/`sales.quote` resolved from the document kind, `resourceId` = document id. Sub-resource sections (`components/documents/ItemsSection.tsx`, `AdjustmentsSection.tsx`, `PaymentsSection.tsx`, `ShipmentsSection.tsx`, `ReturnsSection.tsx`) inherit it.

**Guard wiring:**
- Bridge `enforceSalesDocumentOptimisticLock` → `createCommandOptimisticLockGuardService` (S1) so the aggregate check defers to record_locks' action-log diff when the resource is enabled. Already-guarded commands (verified): `commands/documents.ts` (quotes.update, quote→order convert, order/quote line upsert+delete, order/quote adjustment upsert+delete) and `commands/returns.ts` (return create).
- **Gap A — `commands/payments.ts`:** verified **zero** `enforceSalesDocumentOptimisticLock` calls. Wrap payment create/update/delete to guard the parent order's aggregate version.
- **Gap B — `commands/shipments.ts`:** verified **zero** calls. Wrap shipment create/update/delete to guard the parent order.
- **Confirm** `sales.orders.update` header update and derived `invoices`/`credit_memos` writes guard the parent; if a header path is unguarded, add it (or document derived docs as exempt).
- Sub-resource section components already build the OSS lock header on their custom `apiCall` writes (`components/documents/optimisticLock.tsx` `handleSectionMutationError`); ensure their 409 routes to the merge dialog under S3.

**Config dialogs (auto-covered `makeCrudRoute`; add no presence — they are list/dialog editors, not detail screens):**
- Channels `sales:sales_channel` (`api/channels/route.ts`; `components/channels/*`), payment methods `sales:sales_payment_method` (`api/payment-methods/route.ts`), shipping methods `sales:sales_shipping_method` (`api/shipping-methods/route.ts`), tax rates `sales:sales_tax_rate` (`api/tax-rates/route.ts`), delivery windows `sales:sales_delivery_window`, order/payment/shipment statuses + adjustment kinds (status-config routes). Enable record_locks on the three audited config entities (`SalesChannel`, `SalesPaymentMethod`, `SalesShippingMethod`); the rest are small single-admin config — **enable or exempt with reason** per the coverage guard.

| Site | Files | entityId / resourceKind | Work | Decision |
|------|-------|-------------------------|------|----------|
| Order/Quote document | `backend/sales/documents/[id]/page.tsx`; `commands/shared.ts`,`documents.ts` | `sales.order` / `sales.quote` | presence mount + S1 seam bridge | enabled |
| Lines / adjustments | `components/documents/ItemsSection.tsx`,`AdjustmentsSection.tsx`; `commands/documents.ts` | aggregate-guarded | route 409 → merge dialog | enabled (via parent aggregate) |
| Payments | `components/documents/PaymentsSection.tsx`; `commands/payments.ts` | parent `sales.order` | **add aggregate guard (Gap A)** | enabled |
| Shipments | `components/documents/ShipmentsSection.tsx`; `commands/shipments.ts` | parent `sales.order` | **add aggregate guard (Gap B)** | enabled |
| Returns | `components/documents/ReturnsSection.tsx`; `commands/returns.ts` | parent `sales.order` | route 409 → merge dialog | enabled |
| Invoices / credit memos | `commands/documents.ts` | derived | confirm parent guard | exempt (derived) or enabled |
| Config dialogs | `api/channels|payment-methods|shipping-methods|tax-rates/route.ts`; `components/*Settings.tsx` | `sales:sales_channel`/`…payment_method`/`…shipping_method` | enable on CRUD route | enabled; status enums exempt |

Extend coverage guard for `sales`; integration TC-LOCK-SALES-{order,quote,payment,shipment,channel}.

### Phase 4 — Catalog

`CrudForm`-hosted (auto-covered) entities plus one custom dialog editor and a bulk-delete worker.

**Presence mounts (top-level detail/edit screens):**
- Product — `backend/catalog/products/[id]/page.tsx` (already `crud-form:catalog.product`; add `backend:record:current`).
- Variant — `backend/catalog/products/[productId]/variants/[variantId]/page.tsx` (+ create page); **also add missing `injectionSpotId`** so `crud-form:catalog.variant` mounts.
- Category — `backend/catalog/categories/[id]/edit/page.tsx` (+ create); **add missing `injectionSpotId`** for `crud-form:catalog.product_category`.

**Guard wiring:**
- Auto-covered `makeCrudRoute` entities: products `catalog:catalog_product` (`api/products/route.ts`), variants `catalog:catalog_product_variant` (`api/variants/route.ts`), categories `catalog:catalog_product_category` (`api/categories/route.ts`), prices `catalog:catalog_product_price` (`api/prices/route.ts`), offers `catalog:catalog_offer` (`api/offers/route.ts`), price kinds `catalog:catalog_price_kind` (`api/price-kinds/route.ts`), option-schema templates `catalog:catalog_option_schema_template` (`api/option-schemas/route.ts`).
- **Custom dialog (not CrudForm):** `components/PriceKindSettings.tsx` — Dialog + raw `apiCall` POST/PUT/DELETE to `/api/catalog/price-kinds`. Ensure it sends the lock header and routes its 409 to the merge dialog.
- **Custom routes:** `api/bulk-delete/route.ts` (+ worker `workers/catalog-product-bulk-delete.ts`, `lib/bulkDelete.ts`) and `api/product-media/route.ts` — neither uses the CRUD guard contract today. Bulk delete loops `catalog.products.delete` per item: apply per-item skip-if-changed or document bulk exemption; media upload/delete = attachment side-table (exempt).

**Prices / offers / option-schemas** have no dedicated detail screen (managed inline in the product/variant forms or API-only): presence is inherited from the product screen; the entity itself stays record-lock enabled at the CRUD route.

| Site | Files | entityId | Work | Decision |
|------|-------|----------|------|----------|
| Product | `backend/catalog/products/[id]/page.tsx`; `api/products/route.ts` | `catalog:catalog_product` | presence mount | enabled |
| Variant | `backend/catalog/products/[productId]/variants/[variantId]/page.tsx`; `api/variants/route.ts` | `catalog:catalog_product_variant` | presence + add `injectionSpotId` | enabled |
| Category | `backend/catalog/categories/[id]/edit/page.tsx`; `api/categories/route.ts` | `catalog:catalog_product_category` | presence + add `injectionSpotId` | enabled |
| Price kinds | `components/PriceKindSettings.tsx`; `api/price-kinds/route.ts` | `catalog:catalog_price_kind` | header on custom dialog + 409 surface | enabled |
| Prices / offers / option schemas | `api/prices|offers|option-schemas/route.ts` | `catalog:catalog_product_price`/`…offer`/`…option_schema_template` | inherit product presence | enabled |
| Bulk delete / media | `api/bulk-delete/route.ts`,`api/product-media/route.ts` | — | per-item skip-if-changed | exempt (bulk/side-table) |

Extend coverage guard for `catalog`; integration TC-LOCK-CAT-{product,variant,category,price-kind}.

### Phase 5 — Identity & org modules: auth, directory, staff, resources

All four are `CrudForm`-hosted (directly or via thin wrappers) and auto-covered by the CRUD guard. Work is presence mounts on the edit screens + confirming custom action endpoints.

**auth** — User `auth:user` (`backend/users/[id]/edit/page.tsx`, `api/users/route.ts`), Role `auth:role` (`backend/roles/[id]/edit/page.tsx`, `api/roles/route.ts`). Presence mount on both edit pages. **Custom:** `api/users/acl/route.ts`, `api/roles/acl/route.ts` carry their **own** `updatedAt` versioning — keep separate (do not double-lock); `resend-invite`/`consents` = no entity mutation (exempt).

**directory** — Organization `directory:organization` (`backend/directory/organizations/[id]/edit/page.tsx`, `api/organizations/route.ts`), Tenant `directory:tenant` (`backend/directory/tenants/[id]/edit/page.tsx`, `api/tenants/route.ts`). Presence mounts; `organization-switcher` = UX state (exempt).

**staff** — Team `staff:staff_team` (`components/TeamForm.tsx`, `api/teams.ts`), team-member `staff:staff_team_member` (`components/TeamMemberForm.tsx`, `api/team-members.ts`), team-role `staff:staff_team_role` (`components/TeamRoleForm.tsx`, `api/team-roles.ts`), leave-request `staff:staff_leave_request` (`components/LeaveRequestForm.tsx`, `api/leave-requests.ts`). Presence mounts on edit/detail pages under `backend/staff/{teams,team-members,team-roles,leave-requests}/`. **Custom:** `api/leave-requests/accept|reject/route.ts` = approve/reject status transitions → guard via command seam (decision-state) or exempt with reason; `api/team-members/tags/assign|unassign`, `api/resources/.../tags/*` = junction (exempt). *Note:* the audit table lists `StaffTeam`/`StaffTeamRole`; team-member/leave-request edits are field edits and should be enabled too.

**resources** — ResourcesResource `resources:resources_resource` (`components/ResourceCrudForm.tsx`, `api/resources.ts`), ResourcesResourceType `resources:resources_resource_type` (`components/ResourceTypeCrudForm.tsx`, `api/resource-types.ts`). Presence mounts on `backend/resources/{resources,resource-types}/` edit screens; tag assign/unassign exempt.

| Module | Entity | Edit screen | entityId | Decision |
|--------|--------|-------------|----------|----------|
| auth | User, Role | `backend/users/[id]/edit`, `backend/roles/[id]/edit` | `auth:user`,`auth:role` | enabled; ACL routes separate |
| directory | Organization, Tenant | `backend/directory/{organizations,tenants}/[id]/edit` | `directory:organization`,`directory:tenant` | enabled |
| staff | Team, TeamRole, TeamMember, LeaveRequest | `backend/staff/{teams,team-roles,team-members,leave-requests}/…` | `staff:staff_team`,`…team_role`,`…team_member`,`…leave_request` | enabled; accept/reject = status txn |
| resources | Resource, ResourceType | `backend/resources/{resources,resource-types}/…` | `resources:resources_resource`,`…resource_type` | enabled; tags exempt |

Extend coverage guard per module; integration TC-LOCK-{AUTH-role,DIR-org,STAFF-team,RES-resource}.

### Phase 6 — Platform-config modules: dictionaries, currencies, workflows, feature_toggles, business_rules

Mixed: some custom inline/dialog editors and a bespoke visual editor that need explicit header + merge-dialog wiring.

**dictionaries** — Dictionary `dictionaries:dictionary`, DictionaryEntry `dictionaries:dictionary_entry`. **No `[id]` detail page** — editing is inline in `components/DictionariesManager.tsx` + `DictionaryEntriesEditor.tsx` (`DictionaryForm.tsx` hosts a CrudForm in a dialog). Routes: `api/route.ts` (dictionary), `api/[dictionaryId]/entries/route.ts` (entries). **Custom:** `api/[dictionaryId]/entries/reorder/route.ts` (position — exempt), `set-default/route.ts` (single-flag toggle — exempt or guard). Presence: dialog-scoped — mount `backend:record:current` on the manager when a dictionary is open, or rely on the `crud-form:` widget (decide during impl).

**currencies** — Currency `currencies:currency` (`backend/currencies/[id]/page.tsx`, `api/currencies/route.ts`), ExchangeRate `currencies:exchange_rate` (`backend/exchange-rates/[id]/page.tsx`, `api/exchange-rates/route.ts`). Both are CrudForm detail pages already sending the OSS header; add presence mounts. List-row deletes in `backend/currencies/page.tsx` / `exchange-rates/page.tsx` use raw `apiCall` with the header — route their 409 to the merge dialog.

**workflows** — WorkflowDefinition `workflows:workflow_definition`. **Two edit paths:** (1) form detail `backend/definitions/[id]/page.tsx` (CrudForm); (2) **custom visual editor** `backend/definitions/visual-editor/page.tsx` — React-Flow graph saving via raw `apiCall` PUT with a hand-built `buildOptimisticLockHeader`. Route `api/definitions/[id]/route.ts` already uses `validateCrudMutationGuard` + a generic optimistic-lock reader. Presence mount on **both** edit screens; ensure the visual editor's 409 surfaces the merge dialog (it is the highest-value record_locks target — long-lived edits). Custom `api/definitions/[id]/customize/route.ts`, `reset-to-code/route.ts` = override toggles → guard or exempt.

**feature_toggles** — FeatureToggle `feature_toggles:feature_toggle` (`backend/feature-toggles/global/[id]/edit/page.tsx`, `api/global/route.ts`) — CrudForm, auto-covered; **global (non-tenant) entity, superadmin-only** → record_locks scope must handle the null-tenant case or this stays OSS-guarded only. Overrides `api/global/[id]/override/route.ts` = per-tenant junction (exempt). Presence mount optional (single-admin surface) — **document the decision**.

**business_rules** — BusinessRule `business_rules:business_rule` (`backend/rules/[id]/page.tsx`), RuleSet `business_rules:rule_set` (`backend/sets/[id]/page.tsx`). Both pages use CrudForm but the routes (`api/rules/route.ts`, `api/rules/[id]/route.ts`, `api/sets/route.ts`, `api/sets/[id]/route.ts`) already call `enforceCommandOptimisticLock` — so they bridge to the command seam (S1) cleanly. Presence mounts on both detail pages. `RuleSetMembers.tsx` + `api/sets/[id]/members/route.ts` = junction (exempt); `api/execute/*` = read/eval (exempt).

| Module | Entity | Edit surface | entityId | Custom path | Decision |
|--------|--------|--------------|----------|-------------|----------|
| dictionaries | Dictionary, DictionaryEntry | inline `DictionariesManager`/`DictionaryEntriesEditor` | `dictionaries:dictionary`,`…dictionary_entry` | `api/route.ts`,`api/[dictionaryId]/entries/route.ts` | enabled; reorder/set-default exempt |
| currencies | Currency, ExchangeRate | `backend/currencies/[id]`,`exchange-rates/[id]` | `currencies:currency`,`…exchange_rate` | list-row raw `apiCall` delete | enabled |
| workflows | WorkflowDefinition | `definitions/[id]` + `visual-editor` | `workflows:workflow_definition` | visual editor raw PUT | enabled (visual editor = key target) |
| feature_toggles | FeatureToggle | `feature-toggles/global/[id]/edit` | `feature_toggles:feature_toggle` | global/non-tenant scope | enabled or OSS-only (scope note) |
| business_rules | BusinessRule, RuleSet | `backend/rules/[id]`,`sets/[id]` | `business_rules:business_rule`,`…rule_set` | routes already `enforceCommandOptimisticLock` | enabled; members/execute exempt |

Extend coverage guard per module; integration TC-LOCK-{DICT-entry,CUR-currency,WF-visual-editor,BR-rule}.

### Phase 7 — Cross-cutting delete sweep + completeness verdict
1. Sweep all remaining delete flows across the modules above that send the OSS lock header but were not yet routed through the unified guard/merge surface (the `optimistic-lock-ui-coverage.test.ts` `MUTATION` scan is the worklist: every file matching `deleteCrud(` / `method:'DELETE'`). Confirm each enabled resource's delete surfaces `record_locks.record.deleted`.
2. Final alignment of both OSS guard tests (`optimistic-lock-editable-entities.test.ts`, `optimistic-lock-ui-coverage.test.ts`) with the new record_locks coverage assertion — add a parallel `record_locks` decision map (enabled vs exempt+reason) keyed by the same entity universe so a new editable entity cannot ship without a record_locks decision.
3. Produce the coverage matrix below as the spec's done-definition.

### Coverage Matrix (done-definition — every audited entity has a record_locks decision)
| Module | Entity (audited) | Phase | record_locks decision |
|--------|------------------|-------|-----------------------|
| customers | CustomerEntity (person/company) | 1 | enabled (presence + unified guard) |
| customers | CustomerDeal | 1 | enabled (form + command guard) |
| customers | CustomerInteraction | 2 | enabled (status txn exempt) |
| customers | CustomerTag, CustomerLabel | 2 | enabled (entity); assignment exempt |
| customers | CustomerPipeline, CustomerPipelineStage | 2 | enabled; reorder exempt |
| sales | SalesOrder, SalesQuote | 3 | enabled (aggregate command guard) |
| sales | SalesChannel, SalesPaymentMethod, SalesShippingMethod | 3 | enabled (CRUD route) |
| catalog | CatalogProduct, CatalogProductVariant, CatalogProductCategory | 4 | enabled (presence + CRUD guard) |
| catalog | CatalogProductPrice, CatalogOffer, CatalogPriceKind, CatalogOptionSchemaTemplate | 4 | enabled (CRUD guard; inherit product presence) |
| auth | User, Role | 5 | enabled (ACL routes versioned separately) |
| directory | Organization, Tenant | 5 | enabled |
| staff | StaffTeam, StaffTeamRole | 5 | enabled (team-member/leave-request also enabled) |
| resources | ResourcesResource, ResourcesResourceType | 5 | enabled |
| dictionaries | Dictionary, DictionaryEntry | 6 | enabled; reorder/set-default exempt |
| currencies | Currency | 6 | enabled (+ ExchangeRate enabled) |
| workflows | WorkflowDefinition | 6 | enabled (form + visual editor) |
| feature_toggles | FeatureToggle | 6 | enabled or OSS-only (global/non-tenant scope note) |
| business_rules | BusinessRule, RuleSet | 6 | enabled (routes already command-guarded) |

### File Manifest (Phase 1)
| File | Action | Purpose |
|------|--------|---------|
| `packages/ui/src/backend/conflicts/index.ts` (or `optimisticLock` util) | Modify | `surfaceRecordConflict` defers on `record_lock_conflict` payload |
| `packages/ui/src/backend/injection/` (helper) | Create | `buildRecordInjectionContext(...)` shared context builder |
| `packages/core/src/modules/customers/backend/customers/people-v2/[id]/page.tsx` | Modify | Render `backend:record:current` mount |
| `packages/core/src/modules/customers/backend/customers/companies-v2/[id]/page.tsx` | Modify | Render `backend:record:current` mount |
| `packages/core/src/modules/customers/backend/customers/deals/[id]/page.tsx` | Modify | Render mount + presence context |
| `packages/core/src/modules/customers/components/detail/DealForm.tsx` | Modify | Pass `injectionSpotId` + resource/version context |
| `packages/core/src/modules/customers/components/detail/useDealPipeline.ts` / `useDealClosure.ts` | Modify | Send lock headers + surface conflicts |
| `packages/core/src/modules/customers/commands/*deal*` | Modify | Guard stage-change/closure via command guard service |
| `packages/enterprise/src/modules/record_locks/di.ts` | Modify | Register `createCommandOptimisticLockGuardService` override (`resolveExpected`) |
| `packages/core/src/__tests__/optimistic-lock-ui-coverage.test.ts` | Modify | Parallel record_locks coverage assertion |
| `packages/enterprise/src/modules/record_locks/__integration__/` | Create | TC-LOCK-CRM-{person,company,deal} |

### Testing Strategy
- **Unit**: command guard seam (`resolveExpected`), `surfaceRecordConflict` deferral, resource-kind resolution for deal.
- **Integration (Playwright)**: two concurrent sessions per CRM v2 entity — presence banner appears, contended pessimistic lock blocks, optimistic save → merge dialog with field diff, accept-incoming/accept-mine resolution, force-release. Self-contained fixtures via API; teardown deletes created records.

## Risks & Impact Review

### Data Integrity Failures
- **Concurrent deal stage-change + form save**: two writes racing on the same deal. Mitigation: command guard (Step 1.4/1.5) makes the loser get a 409 → merge dialog; action-log base ensures the second writer sees the first's change.
- **Crash mid-save**: lock left active. Mitigation: existing heartbeat expiry + background cleanup (3-day lock sweep) + admin force-release.

### Cascading Failures & Side Effects
- record_locks emits events/notifications; subscriber failure must not block the mutation. Mitigation: existing subscriber model is async/persistent; guard validation is synchronous and independent of notification fan-out.

### Tenant & Data Isolation Risks
- All lock lookups are `tenant_id`-scoped (optional `organization_id`); the new command guard seam must pass the same scope. Mitigation: `resolveExpected` derives scope from the request ctx, never global.

### Migration & Deployment Risks
- **No schema migration.** Behavior change is guard-routing + UI mounts. OSS-only deployments (no enterprise module) are unaffected: seams fall back to OSS guard; `backend:record:current` simply renders nothing.

### Operational Risks
- **Heartbeat storm** as more screens acquire locks. Mitigation: existing `heartbeatSeconds` (default 30s) config; presence acquire only on detail screens, not lists.
- **Blast radius**: enterprise-only; OSS builds unchanged.

### Risk Register

#### Double conflict surface
- **Scenario**: A save triggers both the OSS conflict bar and the record_locks merge dialog.
- **Severity**: High
- **Affected area**: All unified sites' conflict UX.
- **Mitigation**: Single-guard model (S1) — only one guard runs per enabled resource; `surfaceRecordConflict` defers on record_locks payload (S3).
- **Residual risk**: A misconfigured resource (record_locks enabled in settings but CRUD guard not overridden) could double-fire; covered by the coverage guard test.

#### `core → enterprise` coupling
- **Scenario**: A detail screen imports an enterprise component to mount presence, breaking the OSS build.
- **Severity**: High
- **Affected area**: Build integrity / module isolation.
- **Mitigation**: Mount is a core-rendered injection spot; enterprise injects via the registry. No direct import.
- **Residual risk**: None if the helper stays in UI/core.

#### Stale/false presence
- **Scenario**: A user with a dead tab keeps a lock, blocking others.
- **Severity**: Medium
- **Affected area**: CRM editing throughput.
- **Mitigation**: heartbeat expiry + force-release + background cleanup (all existing).
- **Residual risk**: Up to `timeoutSeconds` of false contention; acceptable and admin-overridable.

## Final Compliance Report — 2026-06-09

### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `packages/core/AGENTS.md`
- `packages/ui/AGENTS.md`
- `packages/shared/AGENTS.md`
- `packages/enterprise/AGENTS.md` (record_locks module)
- `BACKWARD_COMPATIBILITY.md`

### Compliance Matrix
| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | No direct ORM relationships between modules | Compliant | Integration via injection spots + DI seams + FK ids only |
| root AGENTS.md | Filter by organization_id / tenant_id | Compliant | Lock lookups + `resolveExpected` carry request scope |
| root AGENTS.md | No `core → enterprise` imports | Compliant | Presence mount is a core-rendered injection spot |
| root AGENTS.md | Optimistic locking default-ON for editable entities | Compliant | record_locks replaces guard when enabled; OSS fallback otherwise |
| packages/ui/AGENTS.md | Use `apiCall`/`useGuardedMutation`, never raw fetch | Compliant | Deal commands wrapped via `withScopedApiRequestHeaders` |
| packages/ui/AGENTS.md | Single conflict surface (`surfaceRecordConflict`) | Compliant | Deferral logic added for record_locks payloads |
| DS rules | Semantic tokens, shared primitives, dialog Cmd+Enter/Esc | Compliant | Reuses existing widget UI; Boy Scout on touched lines |
| BACKWARD_COMPATIBILITY.md | No removal of contract surfaces | Compliant | Additive: seam population, new injection-spot rendering; no event/command/route removal |
| packages/core/AGENTS.md | Command guard via existing seam (#2232) | Compliant | `createCommandOptimisticLockGuardService({ resolveExpected })` |

### Internal Consistency Check
| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | Pass | No new models/endpoints |
| API contracts match UI/UX | Pass | Existing record_locks APIs power the banner/dialog |
| Risks cover all write operations | Pass | CRUD + command + delete covered |
| Commands defined for all mutations | Pass | Reuses existing conflict commands |
| Guard coverage enforced by test | Pass | Coverage guard test extended |

### Non-Compliant Items
- None blocking. Phase 1 must verify the `crudMutationGuardService` override already covers the three CRUD routes (assumed from SPEC-ENT-003; to confirm during implementation).

### Verdict
- **Fully compliant** — approved for phased implementation, starting Phase 1 (CRM v2).

## Changelog
### 2026-06-09 (deepening)
- Expanded Phases 2–7 from high-level bullets into **file-level manifests** grounded in a full codebase audit of every editable-entity lock site. Each phase now enumerates the exact presence mounts to add, the custom write paths / command-guard seams to wire, the auto-covered `makeCrudRoute` entities (with `entityId`s), and a per-entity enabled/exempt decision.
- Verified facts now baked into the plan: **no core page renders `backend:record:current` today**; CRM v2 person/company pass `injectionSpotId` but `DealForm` does not; sales `enforceSalesDocumentOptimisticLock` already guards `documents.ts`/`returns.ts` but **`commands/payments.ts` and `commands/shipments.ts` have zero guard calls (Gap A/B)**; catalog category/variant edit pages are missing `injectionSpotId`; workflows has a bespoke visual-editor save path; business_rules routes already call `enforceCommandOptimisticLock`.
- Added a how-to-read preamble distinguishing **presence mount** vs **guard wiring** vs **decision**, and a **Coverage Matrix** done-definition listing a record_locks decision for every entity audited by `optimistic-lock-editable-entities.test.ts`.
### 2026-06-09
- Initial specification. Open Questions resolved: single-guard via DI seam (Q1), full Phase-1 experience (Q2), guard Deal form + command endpoints (Q3), customers-first Phase 2+ ordering (Q4).
- Tracking issue: #2187 (CRM ↔ enterprise record-locking). Related: #2232 (command-level pessimistic locking seam), SPEC-ENT-003 (record-locking module), SPEC-035 (mutation-guard mechanism), `2026-05-25/28/29` OSS optimistic-locking specs.
