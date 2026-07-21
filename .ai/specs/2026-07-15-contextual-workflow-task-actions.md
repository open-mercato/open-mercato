# Contextual Workflow Task Actions

## TLDR

**Key points:**

- Keep the existing workflow task APIs, workflow-instance metadata, event triggers, task pages, and widget injection.
- Add a provenance-checked task-source binding that public workflow-start callers cannot activate by supplying metadata.
- Keep raw source identifiers server-side until the source-owning module authorizes the current actor.
- Ship `customers.deal` as the reference adapter: a compact task CTA on deal detail and authorized deal context on task detail.
- Reuse the secure task capabilities and durable completion response defined by the companion user-task specifications.

**Scope:** trusted event-produced source binding, one focused server-side source-query contract, two customers-owned adapter routes/widgets, and fieldless inline completion.

**Primary risks:** forged business context creating a confused-deputy action, source-record identifier disclosure, cross-module authorization bypass, and an optional widget breaking its host page.

## Overview

Users should be able to act on `Initial contact` or another human task while viewing the business record that caused it, without first understanding workflow administration. Open Mercato already has the required task lifecycle and widget surfaces. The missing contract is a trustworthy, authorization-safe association between a task and its source record.

Existing `WorkflowInstance.metadata.entityType/entityId` values are useful opaque metadata but are accepted by the public start API and therefore are not proof of provenance. This specification preserves those fields unchanged and introduces a separate task-source shape whose trusted form requires server-only provenance. Source modules then own the routes and widgets that disclose their records.

Authorization and server capabilities come from [`2026-07-15-secure-workflow-user-task-access-and-personal-inbox.md`](2026-07-15-secure-workflow-user-task-access-and-personal-inbox.md). Inline completion and its pending/applied response come from [`2026-07-15-durable-workflow-user-task-continuation.md`](2026-07-15-durable-workflow-user-task-continuation.md). This specification does not duplicate either contract.

## Current Baseline and Delta

Baseline reviewed: `open-mercato/open-mercato` `develop` at `28649ddec6dd26c15244f4b4264117c8e645a368` on 2026-07-21.

| Existing capability | Keep | Missing delta |
| --- | --- | --- |
| `WorkflowInstance.metadata.entityType/entityId` | Preserve as opaque legacy/general metadata | Never treat caller-supplied values as trusted task context |
| Public workflow start with arbitrary metadata | Preserve unchanged | Caller-provided `taskSource` remains opaque and never satisfies trusted provenance |
| Event-trigger service derives entity ID/type from trusted event context | Preserve | Pass an explicit server-only source option and persist provenance |
| `UserTask.workflowInstanceId` | Preserve | Focused scoped lookup by a trusted source binding |
| `detail:customers.deal:header` | Preserve frozen spot | Customers-owned task CTA widget |
| Task detail page | Preserve route and form | Add one frozen context injection spot that passes task identity only |
| Task claim/complete APIs | Preserve | Consume companion capabilities and durable response |
| Specialized order-approval widget | Preserve unchanged | Do not generalize its workflow-specific assumptions |

[PR #4019](https://github.com/open-mercato/open-mercato/pull/4019) owns visual-editor persistence, [PR #4085](https://github.com/open-mercato/open-mercato/pull/4085) owns user-task form normalization, and [PR #4291](https://github.com/open-mercato/open-mercato/pull/4291) owns role selection in the editor. Implementation must re-check their live replacements/merge state. None currently provides trusted task-source provenance, source-authorized contextual routes, a generic deal CTA, or task-detail business context.

## Problem Statement

The current business flow has two UX failures and two trust-boundary traps:

- an operator must leave a deal, find workflow tasks, and interpret technical instance context;
- task detail emphasizes workflow identifiers instead of the deal/company/person context;
- caller-supplied metadata can claim an unrelated deal and mislead an otherwise authorized assignee;
- returning raw source IDs from the generic task API would disclose customer associations before customers ACL approves them.

The specialized order widget cannot become the generic solution because it is coupled to one workflow ID, sales status values, metadata names, and a particular decision form.

## Goals

1. Let an authorized task worker discover and act on a relevant task from an authorized source record.
2. Prove source association through server-authored provenance rather than caller metadata or naming inference.
3. Keep source IDs server-side until the source module authorizes record access.
4. Keep workflows independent of customers and free of cross-module ORM relationships.
5. Provide a reusable server-side lookup contract and one complete `customers.deal` reference adapter.
6. Degrade to no widget when the peer module, trusted binding, record, or permission is absent.
7. Preserve existing task and workflow-start URLs and arbitrary metadata behavior.

## Non-Goals

- Automatic source inference from workflow IDs, task names, context keys, URLs, or event-name string parsing.
- Treating existing raw `metadata.entityType/entityId` as trusted context.
- Allowing public/manual workflow starts to set trusted source bindings in this phase.
- A universal entity router, client-visible source registry, or cross-module ORM relation.
- Generic rendering of arbitrary source schemas.
- Inline rendering of task forms inside source pages.
- Refactoring the specialized order-approval widget.
- Replacing the personal inbox or task detail form.
- A database migration or backfill.

## Proposed Solution

### Design Decisions

| Decision | Rationale |
| --- | --- |
| Trusted binding combines a structured metadata value with server provenance invariants | Reuses scoped instance storage without treating mere persistence as authority |
| Public start keeps arbitrary metadata unchanged but cannot set server provenance | Preserves compatibility while preventing callers with `workflows.instances.create` from activating contextual UI |
| Server event-trigger context is the first trusted producer | Existing module commands emit scoped entity events; the trigger already starts the instance server-side |
| Raw source pair is available only through a server-side DI contract | Source adapters can query without declassifying IDs through the generic task API |
| Source module owns contextual HTTP routes | Its ACL and record scoping run before any source details reach the browser |
| Workflows owns the task-detail injection spot | Future optional source modules receive a stable host without workflow importing them |
| Customers owns both reference widgets and routes | Optional consumer owns integration glue and disappears cleanly |
| Inline Complete is limited to canonically fieldless tasks | Convenience never bypasses form validation |

### Alternatives Considered

| Alternative | Why rejected |
| --- | --- |
| Expose raw `metadata.entityType/entityId` in task responses | Public start can forge it, and task-only access does not imply source-record access |
| Add generic public source filters to `/api/workflows/tasks` | Enables record-ID association probing before the source module authorizes disclosure |
| Infer source from workflow/task/event names | Names are mutable and not an authorization contract |
| Let workflows load customer entities | Creates forbidden ownership and ORM/ACL coupling |
| Put all adapters in a workflows registry | Adds framework surface when a focused server query plus source-owned routes is sufficient |
| Copy customer summaries onto `UserTask` | Duplicates PII, becomes stale, and requires migration/backfill |

## User Stories

- As a deal owner, I see that a workflow task is waiting while I view a deal I may access.
- As an eligible role member, I can claim that task from the deal and then complete it when no input is required.
- As an assignee with an input form, I follow a direct link to the full task form.
- As a task worker who may read the deal, I see deal/company/person context and an Open deal link.
- As a task worker without customers permission, I can still perform my task but receive no deal ID or context.
- As a module author, I can add a source-owned route/widget that calls the same server-side trusted-source query contract.

## Architecture

### Ownership and Dependency Direction

```text
trusted module event
  -> workflows event-trigger service
  -> server-only trustedTaskSource option
  -> WorkflowInstance.metadata.taskSource

workflows
  |- workflowTaskSourceQuery DI service (server only)
  |- task API remains source-ID-free
  `- task detail host: detail:workflows.user_task:context

customers (optional consumer)
  |- deal-scoped contextual routes check customers ACL/record scope
  |- resolves workflowTaskSourceQuery with tryResolve
  |- deal task CTA -> detail:customers.deal:header
  `- task deal context -> detail:workflows.user_task:context
```

Workflows has no import, ORM relation, or hard `requires` edge to customers. Customers uses a documented optional DI key through `tryResolve`; absence returns an empty/not-applicable response and never breaks deal or task detail.

The new DI key is justified because browser-visible source filters would cross the customers authorization boundary. It has two current call sites in the reference adapter and replaces, rather than supplements, a public raw-ID API.

### Trusted Source Binding

```ts
type TrustedWorkflowTaskSource = {
  version: 1
  entityType: string
  entityId: string
  provenance: {
    kind: 'module_event'
    eventId: string
    triggerId: string
  }
}
```

The persisted location is `WorkflowInstance.metadata.taskSource`. Both strings are trimmed and bounded to 100/255 characters before persistence. A binding is trusted only when its provenance trigger ID matches the server-authored `metadata.initiatedBy = trigger:{id}` value and its event/entity declaration matches the generated module event catalog.

The public start schema continues accepting arbitrary metadata unchanged. Its route still overwrites `initiatedBy` with the authenticated caller and never maps client input into the server-only `trustedTaskSource` executor option. Therefore a caller may persist a lookalike `taskSource` value for backward-compatible opaque metadata use, but it cannot satisfy the trusted provenance invariant or appear in contextual lookup.

The first producer is the existing event-trigger service. It may pass `trustedTaskSource` only when the consumed event is present in the generated module event catalog, carries trusted tenant/organization scope, declares an entity, and provides the entity ID through the event contract. The producer copies the catalog identity; it does not infer type by parsing an event name. For the reference adapter, catalog-declared customers deal events produce `entityType='customers.deal'`.

Raw legacy `metadata.entityType/entityId` remains untouched for backward compatibility and specialized features, but the new contextual service ignores it.

### Server-Side Source Query Contract

The workflows module registers one optional DI service:

```ts
type WorkflowTaskSourceQuery = {
  listForSource(input: {
    actor: UserTaskActor
    source: { entityType: string; entityId: string }
    statuses: Array<'PENDING' | 'IN_PROGRESS'>
    limit: number
    order: 'createdAt:asc'
  }): Promise<{ items: AuthorizedUserTaskProjection[]; total: number }>

  resolveForTask(input: {
    actor: UserTaskActor
    taskId: string
  }): Promise<TrustedWorkflowTaskSource | null>
}
```

Both methods reuse the secure-access companion's human actor, tenant/organization scope, personal predicate, and server-derived capabilities. `listForSource` matches only a provenance-valid binding through a parameterized same-module `EXISTS` query before count/order/limit. `resolveForTask` first proves task visibility, then loads and validates its instance binding. Neither method is directly callable over HTTP and neither authorizes the source record; that remains the source route's responsibility.

### Customers Reference Routes

#### Deal task list

`GET /api/customers/deals/{id}/workflow-tasks`

1. Require a human session and customers deal-read feature.
2. Load the deal with exact tenant/organization scope; missing/invisible is `404`.
3. Resolve `workflowTaskSourceQuery` with `tryResolve`; absent returns `{ data: [], total: 0 }`.
4. Query `customers.deal/{id}`, active statuses, fixed `createdAt:asc`, and limit `10`.
5. Return task ID/name/status/due date/form summary and companion capabilities, never a source ID.

#### Task deal context

`GET /api/customers/workflow-task-context/{taskId}`

1. Require a human session and customers deal-read feature.
2. Ask `resolveForTask` for a personally visible task's trusted source.
3. Continue only for `entityType === 'customers.deal'`.
4. Load the deal in exact tenant/organization scope using customers-owned services.
5. Return authorized deal title, optional company/person summaries already allowed by customers ACL, and the canonical deal href.

All missing, wrong-type, inaccessible, and foreign-scope outcomes return the same `404`; the response never reveals whether a hidden source binding exists.

### Widget Contracts

The deal CTA maps a customers-owned widget to the frozen existing `detail:customers.deal:header` spot. It calls only the customers deal-task route. The oldest actionable task is primary; additional count links to `/backend/tasks?myTasks=true`.

Workflows adds the frozen spot:

```text
detail:workflows.user_task:context
```

Its public context contains the authorized task ID and route-local retry callback only, never source type/ID. The customers-owned widget calls its task-context route and renders `null` for `404`/absent-module/not-applicable outcomes.

### Action Rules

- `canClaim=true`: render Claim. After success, refetch; complete may become available.
- `canComplete=true` and the canonical normalized form has no user-editable fields: render confirmed Complete inline.
- `canComplete=true` and input is required: render Open task linking to `/backend/tasks/{id}`.
- `canRetryContinuation=true`: render the durable companion's non-destructive Retry continuation action.
- no capability: show status only when the task is otherwise personally visible.

All mutations use the existing workflows claim/complete APIs through `useGuardedMutation`; the server recomputes authorization. Inline completion submits `{ formData: {} }`, never invents comments, and consumes `continuation.status` from the durable companion.

## Data Models

No entity or migration is added.

| Existing data | Contract |
| --- | --- |
| `WorkflowInstance.metadata.taskSource` | New binding shape trusted only with matching server provenance |
| `WorkflowInstance.metadata.entityType/entityId` | Preserved opaque metadata; not trusted by this feature |
| `UserTask.workflowInstanceId` | Same-module scalar link used by the server query |

No customer names, company/person snapshots, or source labels are stored on workflow entities.

## API Contracts

### Existing workflows task API

No source query parameter or source record field is added. Task projections consume only the capability additions owned by the secure-access companion. Claim/complete routes and bodies remain unchanged; completion response additions are owned by the durable companion.

### Public workflow start

General metadata remains open as today. The internal executor's `trustedTaskSource` option is not part of the HTTP schema, and OpenAPI does not claim caller metadata can create contextual source identity.

### Customers contextual responses

Both new GET routes export OpenAPI schemas. The deal-task list returns a bounded task projection without source identifiers. Task-context returns only customers-authorized display fields and href. Errors use structured `400/401/403/404`; foreign/invisible/not-applicable source outcomes collapse to `404`.

## UI/UX

### Deal CTA

Render one compact operational row/banner rather than a nested card stack:

- task name and waiting/claimed state;
- optional due/overdue state using semantic tokens and `StatusBadge`;
- one primary CTA: Claim, Complete task, Retry continuation, or Open task;
- View all tasks when more than one relevant task exists.

Use `Spinner`/`LoadingMessage` for initial loading, `Alert` only for an actionable recoverable error, and `null` for a normal empty/peer-absent case. Confirmation uses `useConfirmDialog`.

### Task Context

The task detail widget renders a small `SectionHeader` context section with linked deal title, permitted company/person summaries, and Open deal. It never renders raw workflow instance or source IDs as primary context. Missing, deleted, inaccessible, untrusted, or non-deal sources produce no contextual widget; the task form remains usable.

## Frontend Architecture Contract

| Surface | Server boundary | Client island | Data source | Guardrail |
| --- | --- | --- | --- | --- |
| deal detail | existing customers route host | customers task CTA widget | customers deal-task route | optional widget, one query |
| task detail | existing workflows route host | customers context widget | customers task-context route | task ID only in injection context |

No new page-root client component or provider is introduced. Widget files use `apiCall`, React Query, shared UI primitives, localized strings, route-local guarded mutations, and existing injection-table discovery. Runtime network budget is one contextual GET per mounted widget plus requested mutations; absent peer modules do not trigger retry loops.

## Internationalization

Add deal-task and task-context strings to customers dictionaries for every supported locale. Reserved-key and structured API errors use server translation conventions. Task action/status strings owned by workflows remain in workflows dictionaries. No source, task, or record labels are hard-coded.

## Migration and Backward Compatibility

- No schema migration or backfill.
- Existing workflow/task routes, bodies, IDs, metadata, and specialized widgets remain.
- Existing raw `metadata.entityType/entityId` is not rewritten and does not gain new UI meaning.
- Existing instances without a trusted `metadata.taskSource` binding render no contextual widgets.
- Public start keeps arbitrary metadata unchanged; lookalike caller values remain opaque and fail trusted-provenance checks.
- Disabling customers leaves workflows tasks functional; disabling workflows leaves deal detail functional with no task widget.
- The new DI key and task-detail spot become frozen public extension contracts after merge.

## Performance and Cache

- Contextual responses are not server-cached because they are actor-sensitive and task state changes rapidly.
- Deal-task query applies tenant/org, trusted binding, personal task predicate, status, ascending creation order, and limit before projection.
- It uses one parameterized `EXISTS` query plus count, never an unbounded instance-ID list or cross-module join.
- Task-context uses one scoped task/instance lookup and one customers-owned deal read.
- React Query keys include deal/task IDs; workflow task events and successful mutations invalidate them.
- Implementation captures query plans at 10,000 scoped active tasks/instances; p95 target is below 250 ms per contextual GET.
- If current indexes cannot meet the target, implementation stops for a separately approved additive index proposal.

## Implementation Plan

### Phase 1: Trusted Binding and Server Query

1. Add the server-only executor option and provenance validator without narrowing public metadata.
2. Persist catalog-validated event-trigger provenance and ignore raw legacy source metadata.
3. Add the focused `workflowTaskSourceQuery` DI contract/service with scoped source/task lookup.
4. Add spoofing, provenance, scope, optional-service, query-count, and performance tests.

### Phase 2: Customers Reference Adapter

1. Add customers-owned deal-task and task-context routes with customers ACL and scoped record reads.
2. Add deal CTA and task-context widget modules and map both frozen spots.
3. Use companion capabilities and canonical form normalization for Claim/Complete/Retry/Open decisions.
4. Add all locale strings and loading/error/empty/absent-module behavior.

### Phase 3: Integration and UI Proof

1. Add self-contained customers deal event -> workflow -> user-task fixtures.
2. Exercise fieldless and input-required tasks, continuation pending/applied, and correct CTA routing.
3. Prove public metadata spoofing, API-key actors, unauthorized source readers, deleted deals, foreign scope, and missing modules fail closed.
4. Verify desktop/narrow layouts, hydration, keyboard confirmation, and network budgets.

## Expected File Manifest

| Path | Action | Purpose |
| --- | --- | --- |
| `packages/shared/src/modules/workflows/task-source.ts` / `index.ts` | Create/Modify | Frozen structural DI contract, exports, and contract tests shared by optional modules |
| `packages/core/src/modules/workflows/lib/workflow-task-source.ts` | Create | Trusted binding validation and scoped query service |
| `packages/core/src/modules/workflows/di.ts` | Modify | Register `workflowTaskSourceQuery` |
| `packages/core/src/modules/workflows/lib/workflow-executor.ts` | Modify | Server-only trusted source option/persistence |
| `packages/core/src/modules/workflows/lib/event-trigger-service.ts` | Modify | Catalog-backed module-event provenance |
| `packages/core/src/modules/workflows/api/instances/route.ts` / OpenAPI validators | Modify/Test | Preserve caller metadata while proving it cannot set trusted provenance |
| `packages/core/src/modules/workflows/backend/tasks/[id]/page.tsx` | Modify | Task-ID-only context InjectionSpot |
| `packages/core/src/modules/customers/api/deals/[id]/workflow-tasks/route.ts` | Create | Deal-authorized task list |
| `packages/core/src/modules/customers/api/workflow-task-context/[taskId]/route.ts` | Create | Task + source-authorized context |
| `packages/core/src/modules/customers/widgets/injection/workflow-deal-task-actions/**` | Create | Deal CTA adapter |
| `packages/core/src/modules/customers/widgets/injection/workflow-deal-task-context/**` | Create | Task-detail deal context adapter |
| `packages/core/src/modules/customers/widgets/injection-table.ts` | Modify | Map adapter widgets |
| customers/workflows locale files | Modify | Adapter copy |
| workflows/customers integration tests | Create/Modify | Security, API, optionality, UI, performance proof |

## Testing Strategy

| Area | Required coverage |
| --- | --- |
| Provenance | catalog-declared deal event creates trusted binding; public/raw metadata cannot |
| Public start | arbitrary/lookalike metadata remains accepted but cannot activate contextual lookup |
| Server query | trusted pair only, personal task predicate, ascending order, bounded count |
| Source disclosure | task-only actor without customers read receives no source ID/context |
| Authorization | wrong task actor and wrong source reader collapse to `404`; manager inspection grants no action |
| Principal type | API key with matching features/role cannot use contextual or task mutations |
| Scope | same IDs in foreign tenant/organization never match |
| Deal CTA | empty, claimable, directly completable fieldless, claimed, input form, retry pending |
| Task context | authorized deal/company/person summary; deleted/hidden/untrusted source renders nothing |
| Optional modules | either module disabled leaves the host route/page functional |
| UI | loading/error/retry, desktop/narrow, keyboard confirmation, locale sync |
| Performance | constant query count and representative query plan/runtime trace |

Fixtures create a deal through customers APIs, emit a real scoped customers deal event through the supported command/event path, start the workflow via its event trigger, and clean up in `finally`. A separate adversarial fixture starts a workflow through the public API with forged raw/lookalike metadata and proves it never creates contextual UI.

## Risks and Impact Review

### Forged Source Association

- **Scenario:** a caller starts a workflow with `customers.deal` metadata for an unrelated deal so another operator completes a real task under false context.
- **Severity:** Critical.
- **Affected area:** human decisions and downstream workflow effects.
- **Mitigation:** public start cannot set the server-only executor option or trigger-authored `initiatedBy`; contextual lookup requires both plus catalog-backed event provenance; raw/lookalike metadata is ignored.
- **Residual risk:** trusted module code or an incorrectly declared event contract can still bind the wrong record and requires normal code review/tests.

### Source Identifier Disclosure

- **Scenario:** a task-only actor learns customer record IDs/associations before customers ACL approves them.
- **Severity:** High.
- **Affected area:** customer metadata confidentiality and object enumeration.
- **Mitigation:** generic task API/injection context contains no source ID; source-owned routes check customers feature and scoped record before responding; hidden outcomes share `404`.
- **Residual risk:** authorized source readers can see associations by design.

### Cross-Module Authorization Bypass

- **Scenario:** a widget or route loads customer data directly from workflow metadata without customers policy.
- **Severity:** Critical.
- **Affected area:** deal/company/person data.
- **Mitigation:** customers owns both HTTP routes and record reads; workflows exposes server-only task/source lookup, not customer data; no cross-module ORM.
- **Residual risk:** future adapters must repeat this source-owned authorization pattern; frozen contract and module-decoupling tests protect it.

### Form Validation Bypass

- **Scenario:** a widget incorrectly labels a task fieldless and completes with `{}`.
- **Severity:** High.
- **Affected area:** workflow decision data.
- **Mitigation:** one canonical merged form-schema normalizer; conservative Open task fallback; server validation and authorization rerun.
- **Residual risk:** novel schema constructs may reduce convenience by routing to detail.

### Optional Integration Failure

- **Scenario:** a peer route/service is absent, slow, or errors and breaks deal/task detail.
- **Severity:** Medium.
- **Affected area:** host-page availability.
- **Mitigation:** `tryResolve`, isolated query/error boundaries, bounded requests, null/empty normal absence, no retry loop.
- **Residual risk:** transient failures may hide context until a user retry; the underlying task/record remains usable.

### Source Query Degradation

- **Scenario:** JSON metadata lookup scans large scoped instance/task sets.
- **Severity:** Medium.
- **Affected area:** deal/task page latency.
- **Mitigation:** bounded parameterized query, count/order before projection, representative plan/runtime gate.
- **Residual risk:** large tenants may require a later separately approved additive index.

## Final Compliance Report

### AGENTS.md Files Reviewed

- `AGENTS.md`
- `.ai/specs/AGENTS.md`
- `.ai/qa/AGENTS.md`
- `packages/core/AGENTS.md`
- `packages/core/src/modules/workflows/AGENTS.md`
- `packages/core/src/modules/auth/AGENTS.md`
- `packages/shared/AGENTS.md`
- `packages/ui/AGENTS.md`
- `packages/ui/src/backend/AGENTS.md`
- `packages/events/AGENTS.md`
- `BACKWARD_COMPATIBILITY.md`

### Compliance Matrix

| Rule source | Rule | Status | Notes |
| --- | --- | --- | --- |
| root/core | No cross-module ORM relationships | Compliant | Source query is workflows-owned; customers owns source reads |
| core | Optional consumer owns integration glue | Compliant | Customers owns both routes/widgets and uses `tryResolve` |
| workflows | Scope all task queries | Compliant | Human actor + tenant/org + personal policy precede source predicate |
| companion specs | Reuse access and completion contracts | Compliant | Widgets consume capabilities/status; no duplicate auth/resume logic |
| auth/security | Do not cross privilege boundaries with opaque IDs | Compliant | Source IDs remain server-side until customers authorizes the record |
| core | Stable DI/widget/API contracts | Compliant | One justified DI key, one frozen task spot, additive customers routes |
| UI/backend | `apiCall`, guarded mutations, shared states | Compliant | Reference widgets use canonical helpers |
| shared | i18n and bounded input | Compliant | Localized strings and bounded trusted binding |
| QA | Self-contained integration coverage | Compliant | Public fixtures, adversarial starts, and cleanup specified |
| backward compatibility | Preserve existing routes/IDs/metadata | Compliant | Raw metadata remains but gains no unsafe new meaning |

### Internal Consistency Check

| Check | Status | Notes |
| --- | --- | --- |
| Data model matches trust contract | Pass | Contextual lookup accepts only a binding with explicit producer provenance |
| API contracts match UI | Pass | Browser calls source-owned routes; no raw generic source API |
| Risks cover all writes | Pass | Claim/complete owned by companions; inline path covered |
| Commands defined for mutations | Pass | Widgets invoke existing guarded task APIs |
| Cache/performance covers reads | Pass | No actor-sensitive cache; bounded query and network budgets |

### Non-Compliant Items

None identified.

### Verdict

Implementation is ready for upstream review only together with both companion user-task specifications. Coding remains blocked until the merged-spec and public feature-claim admission gates are satisfied.

## Changelog

### 2026-07-21

- Refreshed the delta against current `develop` and active workflow PRs.
- Replaced caller-trusted source metadata/public raw-ID filters with provenance-checked binding and source-authorized routes.
- Added explicit API-key, spoofing, identifier-disclosure, and confused-deputy protections.
- Kept the three-spec split: access, durable continuation, and contextual actions remain independently owned.

### 2026-07-16

- Expanded the approved skeleton into a complete source, adapter, UI, compatibility, test, and risk design.

### 2026-07-15

- Initial skeleton.
