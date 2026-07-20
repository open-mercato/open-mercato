# Customer Interaction Completion Event Reliability

## TLDR

Make the existing `customers.interaction.completed` lifecycle event a tenant- and organization-scoped persistent publication whose queue-acceptance failure is visible to the completion API and repairable by an authorized retry. Record successful acceptance in a hidden per-interaction timestamp and make normal command retries publish at most once while remaining safe under concurrent calls.

The event ID and payload remain unchanged. This specification changes only the customers module; it adds no workflow runtime, wait correlation, activity-output namespace, editor field, API route, or cross-module relationship.

## Overview

The customers module already declares and emits `customers.interaction.completed`. The current helper uses persistent event delivery but omits trusted event-bus scope and catches both event-bus resolution and publication failures, allowing the completion command to report success when the lifecycle event was never durably accepted.

The proposed command-local reliability marker closes the normal retry gap without introducing a new module or general outbox framework. It follows two principles from [AWS transactional outbox guidance](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html): surface the database/message dual-write risk and require idempotent handling because at-least-once delivery can duplicate messages. This design is deliberately not a transactional outbox; the residual crash window is documented and a general outbox remains deferred.

## Problem Statement

`customers.interactions.complete` commits the interaction status and then publishes the declared completion event. The generic lifecycle helper currently logs and suppresses event-bus resolution or enqueue errors. A caller can therefore receive success even though persistent subscribers never receive the completion.

Blindly throwing the error is insufficient. The interaction may already be completed when the caller retries, concurrent callers can both publish, and a successful enqueue can be repeated if the process fails before recording success. The command needs an explicit, scoped, idempotent publication boundary.

## Goals

- Require successful persistent queue acceptance before the completion API returns success.
- Attach trusted tenant and organization scope through event-bus options.
- Preserve the existing event ID and payload shape.
- Suppress duplicate publication across ordinary and concurrent command retries.
- Allow a failed publication to be retried after the interaction status has committed.
- Keep the delivery marker internal and out of list/detail APIs, snapshots, custom fields, and UI.
- Preserve optimistic locking for the user-editable completion transition.
- Document irreversible event and undo behavior.

## Non-Goals

- Adding a generic transactional outbox, CDC stream, or event ledger.
- Guaranteeing exactly-once delivery to subscribers.
- Changing persistent event worker retry or subscriber semantics.
- Adding or changing `WAIT_FOR_SIGNAL`, workflow correlation, or activity outputs.
- Adding an event replay UI or operator endpoint.
- Changing other customer lifecycle events in the same patch.
- Adding a new completion route, request field, response field, RBAC feature, or UI state.

## User Stories and Use Cases

- A module subscriber can rely on the completion command surfacing queue failure instead of silently losing the event.
- A client can retry after a transient event queue failure without changing the completed business state again.
- Concurrent completion requests do not intentionally enqueue duplicate completion events.
- A subscriber receives trusted tenant and organization context without trusting scope fields in the payload.
- Existing integrations continue to consume the same event ID and payload fields.

## Proposed Solution

### Existing event contract

Keep the declared event unchanged:

```text
customers.interaction.completed
```

Keep the current payload fields unchanged:

```ts
{
  id,
  organizationId,
  tenantId,
  entityId,
  interactionType,
  status,
  source,
  occurredAt,
  syncOrigin?,
}
```

Payload scope fields remain compatibility data. Subscribers that enforce access boundaries must use trusted `SubscriberContext.tenantId` and `SubscriberContext.organizationId` populated from emit options.

### Delivery marker

Add a hidden nullable timestamp to `CustomerInteraction`:

| Property | Column | Type | Purpose |
| --- | --- | --- | --- |
| `completionEventEmittedAt` | `completion_event_emitted_at` | nullable timestamp | Records successful persistent event-bus acceptance for this interaction |

The property is optional and `hidden: true`. It is not user-editable, not included in entity API responses, not added to command snapshots or undo payloads, and not exposed through custom fields.

The internal marker update must use a scoped `nativeUpdate`/query-builder update that sets only `completion_event_emitted_at`; it must not persist a managed entity or advance the user-visible `updated_at` optimistic-lock version. Completing the interaction still advances `updated_at` through the existing business mutation. Tests capture `updated_at` before the marker transaction and assert it is identical after both a successful marker write and a failed/rolled-back marker attempt.

### Existing-row migration policy

Backfill `completion_event_emitted_at = updated_at` for rows already in the completed status at migration time. This is a compatibility sentinel, not proof that an old event was delivered. It prevents deployment or a later idempotent completion call from replaying historical completion events whose downstream effects are unknowable.

Planned, canceled, and other non-completed rows remain `NULL`. The migration and snapshot are generated through repository tooling.

### Strict completion publication

Add a focused helper used only by `customers.interactions.complete`:

1. After the business mutation transaction has fully committed, open a new independent customers-module transaction and load the exact interaction by ID, tenant, organization, and `deletedAt: null` with a pessimistic write lock. Do not nest this transaction inside, or reuse the entity manager from, the business mutation transaction.
2. Re-check tenant and organization scope from the already authorized command context.
3. If `completionEventEmittedAt` is set, return without publishing.
4. Resolve the event bus without a catch-and-skip fallback.
5. Publish `customers.interaction.completed` with the existing payload and options `{ persistent: true, tenantId, organizationId }`.
6. If publication rejects, roll back the marker transaction and report failure to the command handler with the marker still `NULL`; the handler converts that failure into the structured internal delivery outcome so command-bus audit persistence can finish before the route returns an error.
7. If publication resolves, issue a scoped native update for only `completionEventEmittedAt`, verify the affected row count, and commit.

The row lock serializes normal concurrent callers from the pre-publication check through marker persistence. Event bus resolution and queue acceptance occur while the lock is held; this is a bounded network/queue wait on a single row and is covered by failure and concurrency tests.

### Command behavior

The first completion call uses this explicit sequence:

1. Validate request, record existence, tenant/organization scope, mutation guards, and optimistic-lock header.
2. In one business transaction, transition the interaction to completed, set `occurredAt`, flush, recompute the next-interaction projection, and commit. `runInTransaction` must have returned successfully before any marker/publication transaction begins.
3. Emit the existing CRUD side effects and existing next-interaction update before strict completion publication. If either fails, preserve current command failure behavior; a publication marker has not yet been written.
4. Invoke strict completion publication in its separate locked transaction and capture a structured internal delivery outcome rather than throwing past the command bus.
5. Return an internal command result containing `interactionId`, whether this was a business-state transition or marker-only repair, and the completion-event delivery outcome.
6. Let `captureAfter` and `buildLog` run. The first business transition persists exactly one existing completion audit/undo record. A marker-only repair returns `null` from `buildLog` and creates no second business mutation record.
7. After `CommandBus.execute` has persisted the operation log, the existing API route inspects the internal delivery outcome. It returns the unchanged success response when accepted and the existing internal-error response when publication failed.

If publication fails, the interaction state, CRUD/projection side effects, and completion audit record are already complete, while the marker remains `NULL`; the API reports failure only after those durable command-bus steps finish. A retry for the same scoped interaction takes an explicit idempotent path:

- if status is already completed, do not repeat the status mutation, CRUD side effects, projection, audit change, or optimistic-lock check for a business write;
- invoke strict completion publication only when the marker is `NULL`;
- make `buildLog` return `null` so repair does not create a misleading second completion audit/undo record;
- return the existing success response when the marker is already set or the retry publishes successfully, or the existing error response if queue acceptance fails again.

The idempotent path still enforces record existence, deletion, tenant scope, organization scope, auth, feature guards, and mutation guards. It bypasses the stale optimistic-lock comparison only because it does not repeat a user-editable mutation; the internal marker write remains locked and scoped.

### Delivery semantics

The contract is narrower than guaranteed eventual or exactly-once publication: the completion API requires queue acceptance for a success response, and a failed enqueue remains repairable when an authorized caller retries. There is no automatic repair worker or guarantee that a caller will retry.

- Queue rejection leaves the marker empty and is retryable.
- Queue acceptance followed by marker commit prevents ordinary and concurrent repeat publication.
- A crash after queue acceptance but before marker commit can enqueue the event again on retry.
- Persistent worker retry can redeliver the same queued event.
- Subscribers must therefore remain idempotent.

No event payload, event name, or message-level deduplication ID is added in this scope.

## Architecture

```text
customers.interactions.complete
  -> existing scoped + optimistic-lock business mutation commits
  -> existing CRUD + projection side effects
  -> lock CustomerInteraction delivery marker
      -> marker set: no-op
      -> marker null: persistent scoped emit
          -> enqueue failure: throw, marker stays null
          -> enqueue accepted: set hidden marker, commit
  -> command bus persists first mutation audit (repair writes no audit)
  -> route maps internal delivery outcome to unchanged success/error response
```

The customers command remains the only mutation boundary. The event package provides the existing persistent queue and trusted scope options. No subscriber or workflow module is imported by customers.

## Data Models

Only `CustomerInteraction` changes. The new timestamp is internal command state, nullable for interactions that have never completed, and backfilled for already completed rows to prevent historical replay.

No direct ORM relationship, new entity, custom entity, extension, cache record, or search field is added.

## API Contracts

No route, method, request, response, OpenAPI, RBAC, or error-envelope shape changes.

`POST /api/customers/interactions/complete` can now return its existing internal-error response when persistent completion-event publication fails. The command bus first records the completed business mutation and its existing undo metadata, then the route maps the internal delivery outcome to that error. Repeating the same authorized completion request repairs publication and returns the existing HTTP response without repeating the business mutation or creating another audit/undo record.

The marker does not appear in interaction list/detail responses. The lifecycle event keeps its existing ID and payload fields.

## UI/UX

No component, form, data table, dialog, translation, loading state, or visual treatment changes. Existing completion UI already surfaces command failure through the shared mutation error path; a retry uses the same action.

## Commands, Side Effects, and Undo

`customers.interactions.complete` remains the command and audit boundary. Its existing auth, feature, mutation-guard, tenant/organization, optimistic-lock, CRUD indexing/event, projection, and operation-log contracts remain in place for the first business-state transition. The handler's internal result gains a delivery outcome consumed by its current API route; no public response field is added.

Persistent publication and any downstream handling are irreversible side effects. Undoing completion restores the business snapshot through the existing undo command but does not clear `completionEventEmittedAt`, retract a queued/delivered event, or reverse subscriber effects. Re-completing the same interaction after undo therefore does not republish this lifecycle event. A new event occurrence model would require a separate event ledger and is out of scope.

The hidden marker is excluded from before/after command snapshots so undo cannot accidentally re-arm delivery.

## Security, Privacy, Performance, and Cache

- Event-bus options receive tenant and organization from the scoped entity/command context, not from caller-provided payload fields.
- Marker lookup and update include interaction ID, tenant, organization, and non-deleted state and run under a pessimistic write lock.
- Existing route auth, RBAC feature checks, mutation guards, and record scope remain unchanged on first execution and idempotent retry.
- The payload contains only fields already emitted by the event; no new PII or secret is introduced.
- One additional nullable timestamp adds negligible row storage. The completed-row migration backfill is a bounded one-time write and requires deployment review for table size and lock duration.
- Normal completion adds one locked point lookup and marker update plus the existing queue enqueue. Concurrent calls serialize on one interaction row, not a tenant-wide lock.
- No cache is added. Existing customer command invalidation and index side effects remain unchanged.

## Migration and Backward Compatibility

- Add one hidden nullable timestamp through a generated customers migration and ORM snapshot.
- Backfill already completed rows with `updated_at` as a no-replay compatibility sentinel.
- Existing event ID, payload, route, response, RBAC, audit, undo, and UI contracts remain.
- Existing subscribers continue to receive persistent events and must remain idempotent.
- Other lifecycle events retain their current best-effort helper behavior; broad reliability changes require a separate specification.
- No workflow package, editor, definition schema, or step persistence changes.

## Implementation Approach

### Phase 1 — Marker contract and migration

1. Add the hidden optional entity property.
2. Generate the customers migration and snapshot.
3. Add the completed-row no-replay backfill and verify its SQL scope.
4. Cover API/snapshot invisibility and unchanged optimistic-lock version behavior.

This phase adds internal state only and does not change publication behavior.

### Phase 2 — Strict scoped publication

1. Add the completion-specific locked publication helper.
2. Pass persistent, tenant, and organization options to the event bus.
3. Propagate event-bus resolution and enqueue failures.
4. Record the marker only after the emit promise resolves, using a scoped native update that cannot advance `updated_at`.

This phase makes queue acceptance observable to the command.

### Phase 3 — Idempotent command retry

1. Detect already-completed interactions after full scope and guard checks.
2. Skip repeated business mutation/side effects and repair only a missing marker publication.
3. Lock and re-check the marker for concurrent calls.
4. Return a structured internal delivery outcome, persist the first audit/undo log before route error mapping, and return no log metadata for repair-only calls.
5. Keep public operation metadata and API contracts unchanged.

This phase completes normal failure recovery and duplicate suppression.

### Phase 4 — Integration verification

1. Add command and event-bus unit coverage.
2. Add a self-contained integration scenario that captures trusted subscriber scope and payload.
3. Verify failure, retry, duplicate, concurrency, migration, undo, and API invisibility behavior.

No workflow integration is added; workflow adoption belongs to the independent correlated-wait specification.

## Integration and Test Coverage

### Module coverage

- Event declaration retains `customers.interaction.completed` and its payload contract.
- Successful first completion emits with `{ persistent: true, tenantId, organizationId }` and stores the marker.
- Missing event bus and queue rejection produce a failed internal delivery outcome, leave the marker `NULL`, and make the route return its existing error only after the first completion audit log is persisted.
- Retry of an already completed row with a missing marker publishes once without repeating CRUD/projection side effects or creating another audit/undo record.
- Retry with an existing marker is a no-op publication and returns success.
- Concurrent retries serialize and produce one normal publication.
- Wrong tenant, organization, deleted record, auth, feature, and mutation-guard cases remain rejected.
- The first business mutation still enforces optimistic locking; scoped native marker success and failed/rolled-back attempts do not advance `updated_at`.
- Undo does not clear the marker or republish; re-completion remains publication-idempotent.
- Marker is absent from snapshots, serializers, list/detail API fields, search, and custom-field contracts.
- Migration backfills completed rows only and leaves other statuses `NULL`.

### API integration coverage

Create a self-contained interaction fixture and registered test subscriber:

1. Complete the interaction through the existing API.
2. Assert one captured event with the unchanged payload and trusted subscriber tenant/organization context.
3. Read the interaction and verify no marker field is exposed.
4. Repeat completion and verify no second normal publication or repeated operation-log mutation.
5. Inject queue failure for a separate fixture, assert the API reports failure after exactly one completion audit/undo record and all existing CRUD/projection effects, restore the queue, retry, and assert one accepted event, unchanged completed business state, and no second audit record.
6. Clean up all fixtures and test subscribers in `finally`.

### Key UI path

N/A. No UI changes. Existing task/interactions completion controls exercise the unchanged API and shared error surface; automated API integration is the authoritative acceptance path.

## Risks and Impact Review

### Database/message dual-write window

- **Scenario**: The queue accepts the event but the process or marker transaction fails before the marker commits.
- **Severity**: High
- **Affected area**: Persistent subscribers.
- **Mitigation**: Row lock prevents concurrent normal duplicates; marker suppresses completed retries; consumers remain idempotent.
- **Residual risk**: A retry can enqueue a duplicate. A transactional outbox or stable message deduplication key is required to eliminate this window.

### Committed state with publication failure

- **Scenario**: Interaction completion commits, but the persistent queue rejects publication.
- **Severity**: High
- **Affected area**: Caller-visible command result and downstream subscribers.
- **Mitigation**: Complete existing CRUD/projection effects and persist exactly one audit/undo record, surface the failed delivery outcome at the route, keep the marker empty, and provide a scoped idempotent retry path that does not repeat business side effects or require the stale optimistic-lock version.
- **Residual risk**: Until an authorized caller retries successfully, the interaction is complete but downstream processing is pending; no automatic repair worker or eventual-publication guarantee is added.

### Historical replay

- **Scenario**: Existing completed interactions have no trustworthy delivery marker at deployment.
- **Severity**: Medium
- **Affected area**: Existing integrations and subscribers.
- **Mitigation**: Backfill a no-replay sentinel from `updated_at` for rows completed before migration.
- **Residual risk**: A historically suppressed event is not repaired automatically because delivery cannot be distinguished safely.

### Lock duration and queue latency

- **Scenario**: Slow queue acceptance holds the interaction row lock.
- **Severity**: Medium
- **Affected area**: Concurrent writes to the same interaction.
- **Mitigation**: Lock only one scoped row and perform no scans; rely on existing queue timeouts and measure focused command latency.
- **Residual risk**: An unhealthy queue delays completion/retry for that interaction, which is preferable to silent event loss.

### Irreversible undo boundary

- **Scenario**: Completion is undone after subscribers have acted.
- **Severity**: Medium
- **Affected area**: Downstream systems and later re-completion.
- **Mitigation**: Preserve the marker, document that undo cannot retract the event, and keep downstream compensation separate.
- **Residual risk**: Business state can be planned again while downstream completion effects remain; existing command undo already cannot reverse external systems.

## Alternatives Considered

### Keep logging and swallowing publication errors

Rejected because command success would continue to hide durable event loss.

### Throw without a marker or idempotent retry path

Rejected because retries and concurrent calls could intentionally publish the same event multiple times and stale optimistic-lock state could block repair.

### General transactional outbox

Deferred because it is a cross-package platform capability with migration, worker, ordering, cleanup, and operational scope far beyond one existing event. The narrow marker surfaces the dual-write limitation and satisfies the current command retry need.

### Put delivery state in workflow tables

Rejected because event reliability is owned by the emitting customers command and must remain useful when workflows are disabled.

## Success Criteria

- The completion API cannot report success when persistent queue acceptance fails.
- Successful normal and concurrent retries do not intentionally republish after the marker commits.
- Trusted subscriber scope matches the interaction tenant and organization.
- Event ID, payload, API, UI, audit, undo, and optimistic-lock business contracts remain compatible.
- Historical completed rows are not replayed by deployment or later idempotent calls.
- Focused unit, migration, integration, typecheck/build, and generation gates pass.

## Deferred Follow-Ups

- Generic transactional outbox or stable event-message deduplication IDs.
- Automated repair/monitoring for completed interactions with an empty marker.
- A separate event occurrence model if undo and re-completion must publish a new lifecycle occurrence.
- End-to-end adoption by correlated workflow waits after that independent capability is approved and merged.

## Final Compliance Report — 2026-07-20

### AGENTS.md Files Reviewed

- `AGENTS.md`
- `.ai/specs/AGENTS.md`
- `packages/core/AGENTS.md`
- `packages/core/src/modules/customers/AGENTS.md`
- `packages/events/AGENTS.md`
- `BACKWARD_COMPATIBILITY.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
| --- | --- | --- | --- |
| Root and core guides | Preserve public contracts and existing behavior | Compliant | Event ID/payload and command route/response remain; enqueue failure becomes observable |
| Customers guide | Domain writes use commands, guards, audit, and undo | Compliant | First completion persists one audit/undo record before route error mapping; repair creates none |
| Root and core guides | Scope all reads and writes by tenant/organization | Compliant | Marker lock/update and trusted emit options use scoped entity data |
| Core guide | New editable entities require optimistic locking | Compliant | Existing interaction lock remains for business mutation; hidden marker is not user-editable and does not advance its version |
| Core guide | Generate migrations and snapshots | Compliant | One nullable timestamp and bounded completed-row backfill use repository tooling |
| Events guide | Persistent subscribers and emitters are retry-safe | Compliant | Queue failure becomes caller-visible after command logging, normal retries are marked, and duplicates remain explicitly possible |
| Events guide | Trusted scope comes from emit options | Compliant | Payload scope remains compatibility data only |
| Backward compatibility | Do not remove or rename contract surfaces | Compliant | Existing ID, payload, API, UI, audit, and undo surfaces remain |
| Core guide | No direct ORM relationships between modules | Compliant | Customers emits its event without importing subscribers |
| Cache guidance | Tenant-safe cache and invalidation | N/A | No cache change; existing command invalidation remains |
| UI guide | User-facing strings and design system | N/A | No UI or translation change |
| Spec guidance | Cover affected API and UI paths | Compliant | Self-contained completion API/event integration is specified; UI is explicitly N/A |

### Internal Consistency Check

| Check | Status | Notes |
| --- | --- | --- |
| Data model matches command | Pass | Hidden timestamp records successful queue acceptance and controls retry |
| API matches implementation | Pass | Internal delivery outcome is mapped by the current route after command-bus logging; public response shapes do not change |
| Risks cover side effects | Pass | Dual write, pending repair, locks, historical rows, and undo are explicit |
| Command and undo | Pass | Business mutation retains guards; marker is irreversible internal side-effect state |
| Cache strategy | Pass | No new cached state |
| Compatibility | Pass | Event and command contracts remain while silent failure is corrected |

### Non-Compliant Items

None.

### Verdict

**Fully compliant** — approved for implementation after the required public claim and Core admission gates.

## Changelog

### 2026-07-20

- Initial specification for reliable scoped publication of customer interaction completion events.
- Added marker migration policy, idempotent retry semantics, dual-write analysis, integration coverage, and compliance review.

### Review — 2026-07-20

- Reviewer: Agent
- Security: Passed
- Performance: Passed
- Cache: N/A
- Commands: Passed
- Risks: Passed
- Verdict: Approved
