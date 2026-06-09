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

### Phase 2 — Customers: subforms + delete flows (customers-first)
1. Notes, interactions, activities, tasks subforms on person/company/deal detail → record-lock headers + (where a detail/presence experience exists) `backend:record:current` mount; conflicts via merge dialog.
2. Person↔company link/role subforms.
3. List-managed customer entities: tags, labels, pipelines, pipeline stages (edit dialogs/forms).
4. Delete flows for person/company/deal (and subforms) → confirm delete sends lock headers and surfaces `record.deleted` conflict state.
5. Integration + unit tests; extend the record_locks coverage guard test for the customers module.

### Phase 3 — Sales: documents, sub-resources, and config dialogs
1. Bridge the command guard seam to record_locks for `sales.order` / `sales.quote` aggregates (the `enforceSalesDocumentOptimisticLock` wrapper delegates to the guard service).
2. Sub-resource sections (lines, adjustments, returns, payments, shipments) presence/conflict coverage on the order/quote detail screens.
3. Sales config/settings dialogs: channels, channel offers, payment methods, shipping methods, tax rates, status settings, adjustment kinds.
4. Delete flows for sales entities.
5. Tests + coverage guard extension for sales.

### Phase 4 — Catalog
1. Products, variants, categories, prices, offers, price kinds, adjustment kinds: presence mount (on detail/edit screens) + unified guard.
2. Catalog edit dialogs and delete flows.
3. Tests + coverage guard extension for catalog.

### Phase 5 — Identity & org modules: auth, directory, staff, resources
1. **auth**: users, roles (edit pages) → presence + unified guard.
2. **directory**: organizations (edit page).
3. **staff**: teams, team-members, leave requests (`TeamMemberForm`, `LeaveRequestForm`).
4. **resources**: resource-types, resources (edit screens).
5. Delete flows for the above; tests + coverage guard extensions per module.

### Phase 6 — Platform-config modules: dictionaries, currencies, workflows, feature_toggles, business_rules
1. **dictionaries** + **currencies**: CRUD edit dialogs/pages.
2. **workflows**: workflow definitions and editor save paths.
3. **feature_toggles** + **business_rules**: edit forms.
4. Delete flows; tests + coverage guard extensions per module.

### Phase 7 — Cross-cutting delete sweep + completeness verdict
1. Sweep all remaining delete flows that send the OSS lock header but were not yet routed through the unified guard.
2. Final alignment of both OSS guard tests (`optimistic-lock-editable-entities.test.ts`, `optimistic-lock-ui-coverage.test.ts`) with the new record_locks coverage assertion.
3. Produce a coverage matrix proving every audited module/entity has an explicit record_locks decision (enabled → record_locks; exempt → documented reason). This is the spec's done-definition.

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
### 2026-06-09
- Initial specification. Open Questions resolved: single-guard via DI seam (Q1), full Phase-1 experience (Q2), guard Deal form + command endpoints (Q3), customers-first Phase 2+ ordering (Q4).
- Tracking issue: #2187 (CRM ↔ enterprise record-locking). Related: #2232 (command-level pessimistic locking seam), SPEC-ENT-003 (record-locking module), SPEC-035 (mutation-guard mechanism), `2026-05-25/28/29` OSS optimistic-locking specs.
