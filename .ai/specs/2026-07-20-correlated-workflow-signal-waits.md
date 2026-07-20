# Correlated Workflow Signal Waits

## TLDR

Extend the existing `WAIT_FOR_SIGNAL` step with optional event correlation. When a wait opens, the executor resolves an expected scalar from the effective workflow context, persists the subscription on the active `StepInstance`, and resumes only when a trusted persistent domain event has the same signal name, tenant, organization, payload path, and normalized value.

The runtime remains generic. It does not add a new wait type, poll external state, require the customers module, define a customer event, or change current timeout behavior. Manual signals and uncorrelated waits remain compatible.

## Overview

Open Mercato already has durable workflow pauses through `WAIT_FOR_SIGNAL`, manual signal delivery, persistent events, transition conditions, and parallel branch execution. The missing capability is an exact runtime subscription when the identifier to await becomes known only after execution starts.

The proposal follows the message-subscription model described by [Camunda 8](https://docs.camunda.io/docs/components/concepts/messages/): a message name and correlation key select an open process subscription. Unlike Camunda's buffered-message options, this MVP consumes only events delivered after the wait is durably registered.

## Problem Statement

`WAIT_FOR_SIGNAL` can pause a workflow and receive a manual signal by workflow instance identity or existing instance correlation. It cannot persist a record-specific value resolved from the current root or branch context and automatically match a later domain event against that value.

Using activity retry for this purpose would model an idle business wait as repeated execution failure, consume worker capacity, and couple the workflow to polling. Matching only by signal name would allow an unrelated record completion to advance the wrong workflow. Instance-start correlation is also insufficient because the awaited record may be created later or differ per parallel branch.

## Goals

- Add optional correlation configuration to `WAIT_FOR_SIGNAL`.
- Resolve the expected value when the root or branch enters the wait.
- Persist trusted routing data on the active step execution.
- Route persistent events within exact tenant and organization scope.
- Resume only the matching root token or parallel branch.
- Evaluate outgoing transition conditions before consuming the wait.
- Make repeated and concurrent event delivery idempotent.
- Preserve manual signal APIs and uncorrelated definitions.
- Round-trip the optional configuration through existing definition APIs and editors.

## Non-Goals

- Adding `WAIT_FOR_PROPERTY`, `WAIT_FOR_TASK`, or another step type.
- Polling APIs, database records, or context values.
- Replaying or buffering events emitted before wait registration.
- Adding or enforcing signal deadlines or timeout transitions.
- Defining or changing customer, sales, or other domain events.
- Adding a stable activity-output namespace; that is specified independently in `2026-07-20-stable-workflow-activity-outputs.md`.
- Starting workflow instances from events; the current event-trigger subscriber remains separate.
- Creating direct ORM relationships between modules.

## User Stories and Use Cases

- A workflow pauses for a later domain event about the exact record ID already present in its context.
- Two workflow instances waiting for the same event name but different record IDs advance independently.
- Two parallel branches can wait on distinct IDs without changing sibling or join state.
- A module emits an ordinary scoped persistent event without importing workflow internals.
- Existing callers continue to deliver manual signals unchanged.

## Proposed Solution

### Definition contract

Add an optional pair to the existing signal configuration:

```ts
signalConfig: {
  signalName: 'domain.record.completed',
  timeout?: 'PT5M',
  correlation?: {
    contextPath: 'record.id',
    payloadPath: 'id',
  },
}
```

- `contextPath` reads the expected value from the effective root or branch context when the wait opens.
- `payloadPath` reads the observed value from a later event payload.
- Both fields are required when `correlation` exists.
- Paths are dot-separated object keys. Empty segments, array syntax, wildcards, and prototype keys are invalid.
- Resolved values must be scalar strings, numbers, or booleans. Normalize with `String(value).trim()` and require 1–255 Unicode code points and at most 1,020 UTF-8 bytes before persistence. Apply the same normalization and limits to expected and observed values so oversized input is rejected in application code rather than by the database.
- Missing, empty, object, or array context values fail wait entry instead of creating a broad subscription.
- Definitions without `correlation` use the existing uncorrelated/manual behavior.

The context may come from any existing definition-owned path. If a preceding activity creates the awaited record, the independently specified stable activity-output contract provides the recommended path `activities.<activityId>...`; it is not required by this runtime design.

## Data Models

Add nullable routing properties to `StepInstance`:

| Property | Column | Type | Purpose |
| --- | --- | --- | --- |
| `waitSignalName` | `wait_signal_name` | `varchar(255)` | Trusted event name expected by the active wait |
| `waitCorrelationKey` | `wait_correlation_key` | `varchar(255)` | Expected scalar resolved and normalized at wait entry |
| `waitPayloadPath` | `wait_payload_path` | `varchar(500)` | Validated event payload path used for comparison |

Add a composite candidate-lookup index beginning with tenant, organization, active status, and signal name, followed by correlation key and payload path as required by the final query plan. Confirm the exact column order through the generated SQL and query-plan test before implementation is finalized.

Existing rows retain `NULL` values and need no backfill. The workflow definition remains the source for declarative paths; the step execution stores only resolved routing data needed for delivery and audit.

Correlation values are limited by documentation and validation to opaque stable identifiers, not secrets, credentials, contact fields, or free text. `varchar(255)` matches the 255-code-point contract; the explicit 1,020-byte ceiling covers the maximum four-byte UTF-8 representation deterministically. No encryption map is added, and values are not copied into application logs.

## Architecture

```text
root or branch enters correlated WAIT_FOR_SIGNAL
  -> resolve contextPath from effective context
  -> persist active StepInstance routing fields
  -> pause token

trusted persistent event
  -> generic workflows subscriber
  -> exact scoped candidate lookup
  -> lock and re-check candidate token
  -> evaluate transition with candidate signal context
  -> consume and resume once, or remain paused
```

The workflows module owns registration, routing, and execution. Domain modules only emit their declared persistent events. The new subscriber is distinct from the current event-trigger subscriber because starting an instance and resuming an active wait are separate side effects and idempotency boundaries.

### Wait registration

When a root or branch token enters a correlated wait:

1. Resolve `contextPath` against that token's effective context.
2. Validate and normalize the scalar result.
3. Persist signal name, key, and payload path on the active `StepInstance` in the same transaction as the paused token state.
4. Record the existing workflow wait audit event without copying full context or event payload into logs.
5. Pause the root instance or exact branch through the current state transition.

If resolution fails, wait entry fails through the existing workflow failure path. No partially registered broad subscription is stored.

### Persistent event routing

Add one focused auto-discovered persistent workflows subscriber:

1. Require trusted `eventName`, `tenantId`, and `organizationId` from subscriber metadata.
2. Never derive tenant or organization from event payload fields.
3. Treat payload metadata, including the existing `_workflow` object, as untrusted application data that cannot set or override scope.
4. Accept `EMIT_EVENT` as a legitimate source when the event bus attaches trusted tenant and organization options. Authoring such an emission already requires workflow-definition mutation permission; this feature does not create a stronger event-authority tier.
5. Read the distinct payload paths used by active waits for the scoped signal name.
6. Resolve each path once against the payload and query exact candidates by trusted scope, signal name, payload path, and normalized key.
7. Process each exact active match independently; multiple workflows may intentionally await the same domain event.

The subscriber does not import domain entities, commands, or module-specific event payload types.

### Atomic condition-before-consumption

Handle every candidate in a transaction:

1. Lock the workflow instance and active step, then re-check status, scope, signal name, payload path, and key.
2. For a branch wait, lock and verify the exact `WorkflowBranchInstance` and token cursor.
3. Build candidate context under `signals.<stepId>` with signal name, payload, and receipt time while preserving current compatible flat aliases.
4. Evaluate outgoing automatic transitions, including inline conditions and preconditions, against the candidate context.
5. If no transition is valid, leave the wait active and paused and do not persist the candidate payload.
6. If a transition is valid, merge namespaced signal context, complete the active step, record signal receipt, and execute the selected transition for the exact token.
7. Execute the selected transition through the existing token-aware transition handler using the subscriber-owned transactional entity manager.
8. If transition execution fails before commit, roll back the active-step exit, signal context, cursor, workflow event log, and ORM writes performed through that transaction. Do not claim rollback for HTTP calls, emitted events, accepted queue jobs, or other external activity side effects; those retain their existing activity idempotency and retry contract.

The persistent subscriber creates one database transaction per exact candidate and passes that transaction through locks, condition evaluation, step exit, event logging, and token-aware transition execution. Automatic continuation after the selected transition runs through the existing executor after commit. A continuation failure leaves the consumed wait exited and records the workflow through the existing durable failure path; it does not recreate the wait.

The locked active-step re-check is the database idempotency boundary. A concurrent or repeated delivery observes the step as inactive after the first successful commit and becomes a no-op. If transition execution rolls back before commit, the wait remains active and persistent delivery may retry; any external transition activity that completed before the rollback follows its existing idempotency requirements and is not made exactly-once by this feature.

### Manual signal compatibility

Existing instance-ID and instance-correlation signal endpoints keep their routes, request shapes, auth, scope, response contracts, and current consumption semantics. Today manual delivery merges the payload, exits the active wait, and leaves the token `RUNNING` at the current step when no automatic transition exists or qualifies. This specification deliberately preserves that observable status/history behavior even though new event-correlated delivery evaluates conditions before consumption. Aligning manual delivery would be a separate backward-compatibility change.

## API Contracts

No new HTTP route.

- Existing workflow definition create, update, and detail APIs accept and return the additive `signalConfig.correlation` object.
- Existing manual signal endpoint request/response shapes and no-valid-transition status/history behavior remain unchanged.
- Existing workflow instance-start correlation remains unchanged and distinct from step-level event correlation.

Definition schema validation rejects partial or unsafe correlation configuration with the existing validation response conventions.

## UI/UX

Both existing workflow node editors add two optional fields for `WAIT_FOR_SIGNAL`:

- **Correlation context path**, for example `activities.create_record.body.id`;
- **Event payload path**, for example `id`.

Saving either field requires the other. Clearing both removes `correlation`. Reopening a saved definition restores both exact values. Signal name and timeout controls remain unchanged.

Labels, help text, examples, and validation errors use workflow translation keys in every current locale (`en`, `de`, `es`, `pl`). The change reuses existing form fields, keyboard behavior, layout, and accessibility patterns; it adds no page, dialog, provider, status color, or design-system primitive.

## Security, Privacy, Performance, and Cache

- Trusted subscriber metadata is the only source of tenant and organization scope.
- Candidate discovery and locked re-checks include both `tenantId` and `organizationId`.
- ORM queries remain parameterized; payload paths are resolved in application objects and never interpolated as SQL identifiers.
- Full event payloads and workflow context are not logged.
- Payload `_workflow`, `tenantId`, and `organizationId` fields cannot establish trust. Only event-bus options propagated into `SubscriberContext` scope routing.
- Existing definition auth, RBAC features, mutation guards, and manual signal guards remain unchanged.
- Candidate discovery performs one scoped distinct-path query and one indexed exact lookup per distinct active path. It does not load all active waits before matching.
- Legitimate fan-out to many workflows sharing one key remains possible and is processed independently.
- Active execution state is mutable and deliberately uncached.

## Migration and Backward Compatibility

- Add three nullable `step_instances` columns and one scoped lookup index through generated workflows migrations and snapshots.
- Existing rows require no backfill.
- Uncorrelated definitions keep routing fields `NULL` and current behavior.
- Existing definition payloads and manual signal requests remain valid.
- No event ID, endpoint, RBAC feature, DI key, package export, or timeout behavior is removed or renamed.
- Parallel execution changes only the exact matched branch; sibling and join behavior is unchanged.
- Workflows remain decoupled from every event-emitting module.

## Implementation Approach

### Phase 1 — Definition and editor contract

1. Extend shared workflow validators with the optional complete correlation pair and safe path grammar.
2. Round-trip both fields through current form transforms and definition APIs.
3. Add all locale strings and focused editor tests.

This phase is testable without enabling automatic event delivery.

### Phase 2 — Persistence and registration

1. Add nullable routing fields, composite index, generated migration, and ORM snapshot.
2. Resolve and persist root and branch subscriptions at wait entry.
3. Cover missing/non-scalar context, trusted field persistence, and rollback on registration failure.

This phase produces durable paused subscriptions but does not consume events.

### Phase 3 — Scoped event delivery

1. Add the focused persistent subscriber and indexed candidate discovery.
2. Implement locked root and branch re-checks and condition-before-consumption.
3. Preserve manual signal delivery semantics and add explicit regression coverage for no-transition and rejected-transition response/status/history behavior.
4. Cover exact scope, wrong values, oversized keys, duplicates, concurrency, rejection, database rollback, external-side-effect boundaries, and module-disabled behavior.

This phase completes the generic runtime.

### Phase 4 — Integration and headed verification

1. Add self-contained API integration scenarios using a synthetic declared persistent event.
2. Verify definition create/read/update round-trip.
3. Exercise both editor fields, save/reload, and a generic correlated wait in headed QA.

No domain-specific emitter is added in this phase.

## Integration and Test Coverage

### Module coverage

- Validators accept a complete pair and reject partial, empty, non-scalar, unsafe paths, and values outside the 255-code-point/1,020-byte runtime limit.
- Form transforms round-trip both fields and remove the object when both are empty.
- Root and branch wait entry persist normalized trusted routing fields.
- Missing or non-scalar context fails wait entry without a broad subscription.
- Wrong event, tenant, organization, payload path, value, or inactive status does not resume a wait.
- Exact matches resume only the intended root or branch.
- False outgoing conditions leave the wait active and paused.
- Concurrent and repeated delivery executes at most one transition per wait.
- Transition failure rolls back wait consumption and destination effects.
- Payload fields cannot spoof trusted scope; an `EMIT_EVENT` activity with trusted event-bus scope is accepted as an ordinary authorized source.
- Existing manual root, branch, and instance-correlation signal behavior remains valid, including response, `RUNNING` status, active-step exit, and history when no transition qualifies.

### API integration coverage

Create a self-contained workflow and synthetic module event fixture:

1. Create a definition with correlated `WAIT_FOR_SIGNAL` and an initial context record ID.
2. Start two workflow instances with different expected IDs and wait until both are paused.
3. Emit a trusted persistent event for one ID and verify only its instance completes.
4. Emit the same event again and verify no duplicate transition or history advancement.
5. Emit the second event in a wrong organization and verify the remaining instance stays paused.
6. Emit it in the correct scope and verify completion.
7. Clean up all fixtures in `finally`.

Separately create, read, update, and re-read a definition to verify both paths round-trip through existing APIs.

### Key UI path

Configure a signal name and both paths in the visual editor, save, reload, and verify exact persistence. Run the generic fixture, verify an unrelated event does not advance it, then emit the matching event and confirm one durable advancement.

## Risks and Impact Review

### Cross-tenant delivery

- **Scenario**: An event payload contains an ID matching another tenant's wait.
- **Severity**: Critical
- **Affected area**: Workflow instances and branches.
- **Mitigation**: Discovery and locked re-check use trusted subscriber tenant and organization; payload scope fields are ignored.
- **Residual risk**: Future routing changes must retain explicit cross-scope tests.

### Duplicate or concurrent delivery

- **Scenario**: Persistent retries or workers process the same event more than once.
- **Severity**: High
- **Affected area**: Transitions and downstream activities.
- **Mitigation**: Transactional locks and active-step re-check make only the first commit consumptive.
- **Residual risk**: Duplicate jobs still consume worker time.

### Condition rejection or transition failure

- **Scenario**: Correlation matches but no condition passes, or destination execution fails.
- **Severity**: High
- **Affected area**: Wait consistency and recovery.
- **Mitigation**: Conditions run before correlated consumption. A subscriber-owned transaction rolls back workflow database state written through its entity manager when selected-transition execution fails before commit. Continuation after commit uses the existing durable failure path.
- **Residual risk**: External activity effects cannot be rolled back. If an external effect succeeds before a later pre-commit failure, persistent redelivery may invoke it again; activity implementations retain their existing idempotency, retry, and compensation responsibilities.

### Early event arrival

- **Scenario**: The event is emitted before the wait subscription commits.
- **Severity**: Medium
- **Affected area**: Workflows whose domain action can race wait registration.
- **Mitigation**: Document create-then-register ordering and make registration transactional.
- **Residual risk**: The MVP has no event inbox, TTL, or replay and therefore cannot recover an early event.

### Fan-out and payload-path cardinality

- **Scenario**: Many active paths or waits share one signal and key.
- **Severity**: Medium
- **Affected area**: Persistent worker latency.
- **Mitigation**: Resolve distinct paths once and use scoped indexed exact lookups.
- **Residual risk**: Intentional high fan-out remains unbounded; metrics and operational limits are deferred.

## Alternatives Considered

### New wait step type

Rejected because it would duplicate pause, signal, transition, branch, timeout, and audit behavior already owned by `WAIT_FOR_SIGNAL`.

### Retry-based polling

Rejected because retry represents failed execution rather than a durable idle wait and adds worker load and latency.

### Separate subscription entity

Rejected for the current one-active-step model. `StepInstance` already owns the wait lifecycle; a second entity would add consistency and cleanup work without another current consumer.

### Instance-level correlation only

Rejected because the expected value may be produced after start and may differ per parallel branch.

## Success Criteria

- A root or branch wait resumes only for an exact trusted scoped event match.
- Duplicate delivery cannot execute its transition twice.
- Rejected conditions and failed transitions leave a consistent durable state.
- Uncorrelated definitions and manual signal clients remain compatible.
- Correlation fields survive API and editor round-trips.
- Focused unit, integration, generation, typecheck/build, and headed UI gates pass.

## Deferred Follow-Ups

- Durable inbox or TTL replay for events emitted before registration.
- Deadline enforcement and timeout transitions.
- UI context/payload path pickers or expression builders.
- Backlog, fan-out, and delivery-latency metrics.
- Domain-specific adoption scenarios, including customer interaction completion.

## Final Compliance Report — 2026-07-20

### AGENTS.md Files Reviewed

- `AGENTS.md`
- `.ai/specs/AGENTS.md`
- `packages/core/AGENTS.md`
- `packages/core/src/modules/workflows/AGENTS.md`
- `packages/events/AGENTS.md`
- `packages/ui/AGENTS.md`
- `BACKWARD_COMPATIBILITY.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
| --- | --- | --- | --- |
| Root and core guides | Preserve public contracts and behavior | Compliant | Correlation is optional; routes, manual requests, and uncorrelated definitions remain |
| Core guide | No direct ORM relationships between modules | Compliant | Generic subscriber consumes declared persistent events only |
| Workflows and events guides | Scope every lookup by tenant and organization | Compliant | Trusted event metadata scopes discovery and locked re-check |
| Workflows guide | Respect root and branch state machines | Compliant | Exact token is locked, conditions precede consumption, and failures roll back |
| Events guide | Subscribers are focused and idempotent | Compliant | One subscriber owns one resume side effect with active-step idempotency |
| Core guide | Generate entity migrations and snapshots | Compliant | Nullable routing columns and index use repository tooling |
| Core guide | New routes require OpenAPI and auth metadata | N/A | No route is added |
| Backward compatibility | Do not remove or rename contract surfaces | Compliant | Existing signal and timeout contracts remain |
| UI guide | Reuse controls, i18n, and accessibility | Compliant | Existing node editors gain translated optional fields only |
| Cache guidance | Tenant-safe cache and invalidation | N/A | Active execution routing is deliberately uncached |
| Spec guidance | Cover affected API and UI paths | Compliant | Definition round-trip, generic execution integration, and headed editor path are specified |

### Internal Consistency Check

| Check | Status | Notes |
| --- | --- | --- |
| Data model matches routing | Pass | Definition paths resolve to three active-step routing fields |
| API matches UI | Pass | Existing APIs and both editors round-trip the same optional pair |
| Risks cover side effects | Pass | Scope, concurrency, rollback, early events, and fan-out are explicit |
| Commands | N/A | No domain mutation command is introduced |
| Cache strategy | Pass | Mutable active subscriptions remain uncached |
| Compatibility | Pass | Manual delivery, uncorrelated waits, events, and timeouts remain |

### Non-Compliant Items

None.

### Verdict

**Fully compliant** — approved for implementation after the required public claim and Core admission gates.

## Changelog

### 2026-07-20

- Initial specification for generic correlated event delivery to `WAIT_FOR_SIGNAL`.
- Added exact root/branch routing, condition-before-consumption, editor/API coverage, risk analysis, and compliance review.

### Review — 2026-07-20

- Reviewer: Agent
- Security: Passed
- Performance: Passed
- Cache: N/A
- Commands: N/A
- Risks: Passed
- Verdict: Approved
