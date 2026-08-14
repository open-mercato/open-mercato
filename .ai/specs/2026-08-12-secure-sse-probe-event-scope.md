# Secure SSE probe event scope and persistent side-effect isolation

## TLDR

**Key Points:**

- The authenticated example SSE probe may emit real `example.todo.*` ids for browser tests, but it must not accept caller-forged tenant, organization, user, role, record, or sync-origin claims.
- A new additive `EmitOptions.skipPersistentSubscribersInline` option lets this non-persistent probe preserve ephemeral/browser delivery without invoking persistent business subscribers inline.
- Trusted DOM-bridge tenant and organization scope travels in `EmitOptions`; marked invalid scope fails closed locally and across the PostgreSQL bridge.
- The optional customer-sync subscriber and worker independently revalidate trusted scope before queueing or executing the privileged customer-interaction delete command.

**Scope:**

- `packages/events`: additive inline-suppression option, trusted DOM-bridge scope selection, and cross-process marker serialization.
- `apps/mercato/src/modules/example`: authenticated probe authorization and integration coverage.
- `apps/mercato/src/modules/example_customers_sync`: subscriber and worker scope guards.
- `packages/create-app/template`: mandatory mirrors of the app-specific changes.

**MVP boundary:**

- Secure the example probe and its reachable destructive sync path without changing event ids, route URLs, queue names, or default event-bus behavior.
- Migrating all legacy payload-scoped `clientBroadcast` producers to trusted options is deferred to follow-up module-by-module work.

**Concerns:**

- `EmitOptions` is an additive-only public contract surface.
- An immediate global removal of payload-scope fallback would break established DOM broadcasts.

## Overview

`POST /api/example/assignees` is an authenticated integration-test utility that emits the same
`example.todo.created|updated|deleted` event ids used by real CRUD flows. Those events are both
`clientBroadcast` transports and inputs to persistent subscribers. Before this change, a caller
could supply audience/scope fields and arbitrary nested payload data; a delete-shaped probe could
therefore reach `example_customers_sync` and its privileged customer-interaction command.

This specification separates a test transport from business side effects while preserving the
existing browser-test contract. It also treats trusted transport scope as metadata rather than
payload data wherever the producer opts into the stronger contract.

> **Market Reference**: N/A. This is a repository-specific trust-boundary correction, not a new
> product capability or externally selected architecture.

## Problem Statement

The vulnerable path crossed four boundaries:

1. The probe route merged arbitrary payload fields and accepted caller-selected organization,
   user, and role audiences.
2. `EventBus.emit(..., { persistent: false })` still invoked persistent subscribers inline, which
   is the intentional legacy default for non-persistent emits.
3. The sync subscriber copied payload scope into a durable job, and the sync worker trusted the
   scope-selected mapping before calling `customers.interactions.delete`.
4. The DOM bridge fell back to payload tenant/organization. A naive strict-options fix would drop
   most existing broadcasts, while an own `tenantId: undefined` marker would disappear during JSON
   serialization and silently re-enable the legacy fallback in another process.

The security property required is: an authenticated actor may generate only a browser probe scoped
to that actor, and a probe must never become a durable business mutation. A legitimate scoped CRUD
event must continue through the persistent subscriber, queue, and worker.

## Proposed Solution

### 1. Canonicalize and authorize the probe route

The route derives tenant, organization, subject, and roles from authenticated request context.

- A requested organization must equal `auth.orgId`.
- A requested user recipient must equal `auth.sub`.
- Every requested role recipient must be present in `auth.roles`.
- Nested payload keys capable of impersonating scope, audience, a record, or sync origin are
  rejected: `id`, tenant/organization/user/role recipient fields, and `syncOrigin`.
- The emitted payload writes canonical tenant and organization values after validation.
- The emitted options write the same trusted tenant/organization values, set `persistent: false`,
  and opt into persistent-subscriber suppression.

The response keeps the existing `{ ok, eventId, payload }` shape.

### 2. Add probe-only persistent-subscriber suppression

Add the optional public contract:

```ts
type EmitOptions = {
  skipPersistentSubscribersInline?: boolean
}
```

Its complete delivery matrix is:

| Emit shape | Inline ephemeral subscribers | Inline persistent subscribers | Queue behavior |
| --- | --- | --- | --- |
| Option absent/`false`, `persistent` absent/`false` | Run | Run (legacy behavior) | No job |
| Option `true`, `persistent` absent/`false` | Run | Skip | No job; suppression is intentional and probe-only |
| Option absent/`false`, `persistent: true` | Existing single-delivery rules | Existing single-delivery rules | Enqueue exactly as before |
| Option `true`, `persistent: true` | Run unless `deliverInline: false` | Skip | Enqueue with `persistentDeliveredInline: false`; the worker owns persistent delivery |

The option is narrower than `deliverInline: false`, which suppresses all inline handlers and only
affects persistent emits. The default deliberately stays unchanged: `persistent: false` has never
meant "ephemeral subscribers only" for ordinary callers.

The production-consumer audit is closed. The only production use is the example probe route plus
its mandatory create-app template mirror. Other search hits are the type, implementation, and tests.
Future production callers must be probe/test transports whose contract forbids durable side effects;
normal business emitters must not opt in.

### 3. Mark trusted DOM-bridge scope without breaking legacy producers

An own `EmitOptions.tenantId` property selects trusted mode:

- A non-empty string is authoritative.
- Explicit `null` or `undefined` fails closed and does not fall back to payload scope.
- In trusted mode, organization scope comes only from `EmitOptions.organizationId`.
- With no own tenant marker, the established payload tenant/organization fallback remains active.

Cross-process JSON serialization drops `undefined` values. Before publishing an envelope, the
bridge therefore normalizes an own `tenantId: undefined` to `tenantId: null`, preserving the
fail-closed marker in remote SSE processes.

The compatibility audit found 62 monorepo `clientBroadcast` event definitions. Nine Data Engine
CRUD definitions already carry trusted emit options; 53 direct module event types still obtain
tenant/organization scope from payload data. Removing fallback in this patch would break progress,
notifications, messages, communication channels, checkout, webhooks, AI sharing, customer accounts,
and customer email broadcasts. Their migration is independent follow-up work. A marked envelope
never permits conflicting payload data to override trusted scope.

### 4. Revalidate scope at subscriber and worker boundaries

The optional `example_customers_sync` inbound subscriber:

- requires string `ctx.tenantId` and `ctx.organizationId`;
- rejects payload tenant/organization claims that differ;
- resolves flags using trusted tenant context; and
- enqueues only trusted context scope.

The inbound worker looks up the mapping using queued scope, then returns before any command unless
the selected mapping's tenant, organization, and Todo id exactly match the queued job. Legitimate
same-scope deletion continues through `customers.interactions.delete`, preserving command guards,
side effects, audit behavior, and loop protection.

### Design Decisions

| Decision | Rationale |
| --- | --- |
| Add an explicit option instead of redefining `persistent: false` | Preserves every existing emitter's inline behavior. |
| Keep the option probe-only by policy and consumer audit | Prevents accidental loss of durable business side effects. |
| Use own-property presence as trusted marker | Distinguishes an intentionally missing trusted scope from a legacy producer that supplied no options. |
| Preserve unmarked payload fallback | Avoids a broad breaking migration across 53 event types in a security patch. |
| Guard route, subscriber, and worker | No single public or queue boundary is the sole protection for a privileged mutation. |

### Alternatives Considered

| Alternative | Why Rejected |
| --- | --- |
| Make every `persistent: false` emit skip persistent subscribers | Breaking behavior change for existing callers and subscribers. |
| Emit a new probe-only event id | Changes the existing integration contract and no longer exercises the real browser event definitions. |
| Require trusted options for every DOM broadcast immediately | Drops most current direct-module broadcasts. |
| Trust route validation alone | Leaves direct emitters, durable queue jobs, and stale/mis-scoped mappings without defense in depth. |

## User Stories / Use Cases

- An integration test author can emit a same-scope browser event without triggering durable business
  subscribers.
- An authenticated user cannot target another tenant, organization, user, or unowned role through
  the probe.
- An operator running app and SSE processes separately receives the same fail-closed trusted-scope
  behavior as a single-process deployment.
- A legitimate same-scope Todo deletion still removes the mapped canonical interaction through the
  persistent sync pipeline.

## Architecture

```text
Authenticated probe request
  -> route authorization + reserved-key rejection
  -> EventBus emit (non-persistent, skip persistent inline, trusted options)
     -> ephemeral subscribers / DOM bridge
     -> persistent sync subscribers skipped

Legitimate Todo CRUD deletion
  -> persistent event job
  -> events worker
  -> sync subscriber (trusted context/payload equality)
  -> inbound sync queue (trusted scope)
  -> sync worker (mapping scope/Todo equality)
  -> customers.interactions.delete command
```

### Commands & Events

- Events remain `example.todo.created`, `example.todo.updated`, and `example.todo.deleted`.
- The privileged mutation remains `customers.interactions.delete`.
- Queue and subscriber ids remain unchanged.

## Data Models

No entities, columns, indexes, migrations, or persistence formats change. Existing queued event
`options` already serialize optional fields; older jobs without the new option deserialize unchanged.

## API Contracts

### Example SSE probe

- `POST /api/example/assignees`
- Authentication: required; `example.todos.manage` remains required by metadata.
- Request:
  - `eventId`: one of the three existing `example.todo.*` CRUD ids.
  - `payload`: optional record of transport data; reserved authority/business keys are forbidden.
  - `organizationId|organizationIds`: optional, but every value must equal the authenticated org.
  - `recipientUserId|recipientUserIds`: optional, but every value must equal the actor.
  - `recipientRoleId|recipientRoleIds`: optional, but every value must be owned by the actor.
- Success: `200 { ok: true, eventId, payload }` with canonical tenant/organization in payload.
- Errors: `400` malformed schema, `401` missing authentication/tenant, `403` missing org or any
  out-of-scope/reserved claim.

The URL, methods, event ids, and success schema remain stable. Only previously accepted authority
forgery is narrowed.

## Internationalization

N/A. The route uses existing minimal machine-facing error tokens and adds no UI copy.

## UI/UX

N/A. No rendered component changes; browser delivery remains observable through the existing DOM
Event Bridge.

## Migration & Backward Compatibility

- `skipPersistentSubscribersInline` is an optional additive `EmitOptions` member. Omitted/`false`
  preserves the legacy inline matrix exactly, including persistent subscribers running for a
  non-persistent emit.
- A suppressed `persistent: true` emit still enqueues one durable job and leaves persistent delivery
  to the worker. A suppressed non-persistent probe enqueues no job by design.
- Trusted DOM scope is marker-based and additive. Marked invalid scope fails closed; unmarked
  producers retain payload routing until migrated independently.
- No event id, route URL, request field, success field, subscriber id, queue name, command id,
  database schema, or exported signature is removed or renamed.
- No data migration, queue drain, deployment coordination, or feature flag is required. Optional
  fields keep old queued jobs compatible across rollout order.
- Previously accepted out-of-scope probe requests may now receive `403`; this is the intended
  security-compatible narrowing.

## Implementation Plan

### Phase 1: Public event and DOM-bridge contract

1. Add the optional inline-suppression type and implement its delivery matrix.
2. Select trusted SSE scope by own marker and serialize explicit missing scope across processes.
3. Add focused unit regressions for local delivery, SSE matching, and bridge serialization.

### Phase 2: Probe and sync defense in depth

1. Authorize/canonicalize the probe and mirror it into create-app.
2. Require trusted subscriber context and mapping equality before a privileged sync command.
3. Add mirrored unit tests and a monorepo end-to-end queue regression.

### File Manifest

| File area | Action | Purpose |
| --- | --- | --- |
| `packages/events/src/{types,bus,bridge}.ts` | Modify | Additive delivery option and serializable trusted marker. |
| `packages/events/src/modules/events/api/stream/route.ts` | Modify | Trusted/legacy audience selection. |
| `apps/mercato/src/modules/example/api/assignees/` | Modify/test | Canonical probe authorization and delivery options. |
| `apps/mercato/src/modules/example_customers_sync/lib/` | Modify/test | Subscriber/worker scope guards. |
| `packages/create-app/template/src/modules/...` | Mirror | Standalone parity. |
| `packages/core/src/modules/customers/__integration__/TC-CRM-028.spec.ts` | Modify | Full destructive-path regression. |

### Testing Strategy

- Event bus unit test: opt-in non-persistent emit runs ephemeral but not persistent subscribers;
  default behavior remains unchanged.
- SSE unit tests: legacy payload-only scope works; trusted missing scope fails closed; conflicting
  payload cannot override trusted options.
- Bridge unit test: own `tenantId: undefined` serializes as `null`.
- Route unit tests and template mirror: foreign org/user/role and reserved nested claims return 4xx;
  same-scope input emits canonical data/options.
- Sync unit tests and template mirrors: context/payload mismatch never enqueues; mapping
  tenant/org/Todo mismatch never executes delete; matching scope remains functional.
- Playwright API/queue test: enable sync, create a scoped canonical interaction and mapped Todo,
  reject a forged delete probe, allow a safe same-scope browser probe, drain events/inbound queues
  and prove no mutation, then delete the Todo through its legitimate API and prove the queues remove
  the canonical interaction and mapping.

## Risks & Impact Review

### Probe-only option used by a business emitter

- **Scenario**: A normal producer opts in on a non-persistent emit, suppressing a required persistent
  subscriber with no queue recovery.
- **Severity**: High
- **Affected area**: Event-driven integrations, workflows, webhooks, and sync subscribers.
- **Mitigation**: Legacy-compatible default, probe-only contract, sole-consumer audit, explicit name,
  and delivery-matrix tests.
- **Residual risk**: A future caller can misuse any public option; code review remains a control.

### Strict trusted scope breaks legacy broadcasts

- **Scenario**: Unmarked payload-scoped producers are treated as trusted-option-only and their
  browser updates disappear.
- **Severity**: High
- **Affected area**: 53 audited event types across multiple modules.
- **Mitigation**: Own-property marker selects trusted mode; unmarked envelopes retain fallback.
- **Residual risk**: Legacy producers still rely on payload correctness until separately migrated.

### Cross-process serialization erases fail-closed intent

- **Scenario**: Own `tenantId: undefined` disappears in JSON and a remote process trusts payload
  tenant scope.
- **Severity**: Critical
- **Affected area**: Multi-process DOM Event Bridge deployments.
- **Mitigation**: Normalize own undefined to null and regression-test the envelope.
- **Residual risk**: Alternate bridge implementations must preserve the same options contract.

### Mis-scoped mapping reaches a privileged delete

- **Scenario**: Forged/stale queue data selects a mapping outside the queued tenant, organization,
  or Todo, then executes `customers.interactions.delete`.
- **Severity**: Critical
- **Affected area**: `example_customers_sync` inbound delete processing.
- **Mitigation**: Subscriber context equality, trusted queue scope, worker mapping equality, command
  preservation, unit tests, and end-to-end queue coverage.
- **Residual risk**: A separately compromised queue backend remains an operational trust boundary.

No cache, database, UI, bulk, or query behavior changes. Added work is constant-time validation and
does not create a meaningful performance, storage, or noisy-neighbor cost.

## Final Compliance Report — 2026-08-12

### AGENTS.md Files Reviewed

- `AGENTS.md` (root)
- `packages/events/AGENTS.md`
- `packages/create-app/AGENTS.md`
- `packages/create-app/template/AGENTS.md`
- `.ai/qa/AGENTS.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
| --- | --- | --- | --- |
| Root `AGENTS.md` / `BACKWARD_COMPATIBILITY.md` | Public contracts remain additive | Compliant | Optional member; stable defaults, ids, URLs, schemas, and queued jobs. |
| Root `AGENTS.md` | Never expose cross-tenant data or trust payload scope | Compliant | Route canonicalization, marked fail-closed options, subscriber context equality, and worker mapping equality. |
| `packages/events/AGENTS.md` | Explicit persistent/ephemeral delivery semantics | Compliant | Full new-option/persistence matrix and queue ownership are specified. |
| `packages/create-app/AGENTS.md` | Template equivalents stay synchronized | Compliant | App route, tests, and sync guards have template mirrors. |
| `.ai/qa/AGENTS.md` | Integration fixtures are self-contained and cleaned | Compliant | Flags and scoped source/target fixtures are restored or deleted in hooks/`finally`. |
| Root `AGENTS.md` | Side effects use canonical commands | Compliant | Legitimate deletion retains `customers.interactions.delete`. |

### Internal Consistency Check

| Check | Status | Notes |
| --- | --- | --- |
| Data models match API contracts | Pass | No schema change; mapping guard uses existing fields. |
| API contracts match UI/UX section | Pass | Stable machine API; no rendered UI. |
| Risks cover all write operations | Pass | Probe, SSE, queue, and privileged delete boundaries covered. |
| Commands defined for all mutations | Pass | Existing customer command remains the only target mutation. |
| Cache strategy covers all read APIs | N/A | No cache/read contract change. |

### Non-Compliant Items

None.

### Verdict

Fully compliant: Approved — ready for implementation.

## Changelog

### Review — 2026-08-12

- **Reviewer**: Agent
- **Security**: Passed
- **Performance**: Passed
- **Cache**: N/A — no cache behavior changes
- **Commands**: Passed
- **Risks**: Passed
- **Verdict**: Approved

### 2026-08-12

- Initial specification for issue #5178 after fresh-context scope review split it from the existing
  events-worker subscriber-registry specification.
