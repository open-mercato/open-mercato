# Access-Log Overload Safety

## TLDR

Bound the two best-effort access-log in-flight registries so database slowness cannot cause unbounded process-memory growth. Overload becomes a finite, counted loss mode with backlog depth/age metrics and rate-limited warnings, while retention rotation becomes explicitly single-flight.

This is the second independently shippable implementation slice for issue [#5784](https://github.com/open-mercato/open-mercato/issues/5784). Its additive metric bridge dependency is specified in `.ai/specs/2026-08-30-runtime-saturation-observability.md` and must land first or be supplied equivalently in this implementation.

### Scope

- Replace the CRUD dispatcher and audit-log service pending sets with bounded admission trackers.
- Add pending depth, oldest age, and dropped-write metrics with fixed labels.
- Add `AUDIT_LOGS_MAX_PENDING` with a finite default of 256 per stage.
- Warn at a bounded rate when overload causes drops.
- Make retention rotation explicitly single-flight, including interval `0`.

### Out of scope

- Database-pool and Node.js runtime metrics; those belong to the companion spec.
- A durable audit queue, retries, blocking/backpressure on domain requests, or a stronger-than-best-effort access-log delivery contract.
- API/UI changes, schema changes, dashboards, alert rules, or dynamic tenant/user/record labels.

## Overview

Access logging is deliberately best-effort so observability failures do not fail domain mutations. Today, however, both layers retain every in-flight promise in an unbounded process-wide `Set`. Under sustained database slowness those promises retain rows, payloads, and closures until settlement. Removing old promises from the set would only hide the backlog because it cannot cancel their work; truthful bounding requires admission before the async operation is created.

The design introduces one shared, generic pending-work tracker and applies it at the two existing ownership boundaries:

- `packages/shared/src/lib/crud/factory.ts` owns fire-and-forget CRUD access-log dispatch.
- `packages/core/src/modules/audit_logs/services/accessLogService.ts` owns direct/batched persistence and retention rotation.

The tracker reports through the provider-neutral metrics bridge from the runtime-observability companion spec, keeping `@open-mercato/shared` and `@open-mercato/core` independent of the optional telemetry package.

## Problem Statement

### Pending writes retain unbounded memory

The CRUD dispatcher and the access-log service each insert every write promise into a module-level set. If the DB slows or stalls, request-derived objects remain reachable without a capacity limit. Neither layer exposes current depth, oldest age, or rejected work.

### A cosmetic set cap would not bound work

Deleting the oldest promise from tracking after it starts does not cancel its database operation or release captured memory. The cap must reject the newest operation before parsing, encryption, or DB work begins.

### Rotation single-flight is implicit and incomplete

The normal interval path assigns `lastRotatedAt` before its first `await`, which avoids overlap under the default interval. With `AUDIT_LOGS_ROTATE_INTERVAL_MS=0`, concurrent writes can still enter overlapping sweeps. An explicit in-flight promise makes the invariant correct and testable for every interval.

## Proposed Solution

### Add a reusable bounded pending tracker

Create a shared utility backed by `Map<Promise<unknown>, startedAtMonotonicMs>` with:

- `tryStart(factory)` that checks capacity before invoking `factory`;
- settlement cleanup that cannot delete a newer operation;
- `flush()` that waits until all accepted work present across settlement waves is empty;
- current depth and oldest monotonic age;
- a dropped counter and enabled-only 10-second sampler;
- a rate-limited drop callback, at most once per tracker/stage per 60 seconds;
- an explicit disposer for tests/reloads.

Telemetry must not be required for enforcement: admission, settlement cleanup, and flushing work identically when telemetry is off. A sampling interval exists only while an active metric runtime is available and is cleared when the tracker empties or is disposed.

### Apply finite admission at both access-log boundaries

Both stages read `AUDIT_LOGS_MAX_PENDING`, default `256`. Only positive integers are accepted; missing, invalid, zero, or negative values fall back to 256. Each stage has its own capacity and fixed label:

- `crud_dispatch`: bounds fire-and-forget dispatch initiated by CRUD route helpers.
- `service_write`: bounds direct and batched parsing/encryption/insert work in the access-log service.

When full, reject the newest write before its async body starts. The CRUD path returns its existing `skipped` result with `count: 0`; direct service calls preserve their `null`/`0` result shapes. No access-log overload error escapes into the domain mutation path.

### Make retention rotation explicitly single-flight

Maintain one module-level `rotationInFlight` promise. Interval gating and the `lastRotatedAt` claim happen synchronously. A concurrent caller awaits the same sweep; `finally` clears the slot only when it still owns that promise. Interval `0` means one sweep after each sequential write, never overlapping concurrent sweeps.

## User Stories / Use Cases

- An operator wants an access-log backlog cap so a failing DB cannot turn best-effort logging into process OOM.
- An operator wants depth, age, and drop metrics so log loss is visible and the finite cap can be tuned from evidence.
- A maintainer wants deterministic flush and rotation behavior so shutdown/tests do not race with hidden writes.

## Architecture

```text
request → logCrudAccess()
  └─ crud_dispatch.tryStart()
      ├─ full → count drop + rate-limited warning + return skipped
      └─ accepted → accessLogService.logMany()
          └─ service_write.tryStart()
              ├─ full → count drop + return 0
              └─ accepted → parse/encrypt/insert → single-flight rotate
```

- The generic tracker resides in shared telemetry utilities and has no audit-log/domain imports.
- `@open-mercato/core` consumes only the shared tracker/bridge.
- Stage, reason, and metric names are constants; no record-derived label is accepted by callers.
- No module relationships, commands, events, or generated registries change.

## Data Models

No database schema or persisted data changes. The tracker keeps only promise identity and monotonic start time in memory. Metric labels contain no tenant, organization, user, route, resource-kind, record, or payload values.

## API Contracts

### Configuration

| Variable | Default | Contract |
|---|---:|---|
| `AUDIT_LOGS_MAX_PENDING` | `256` | Positive integer maximum for each pending registry. Missing, invalid, zero, or negative values fall back to 256. |

The variable is mirrored in `apps/mercato/.env.example` and `packages/create-app/template/.env.example`.

### Metrics catalog

| Metric | Kind | Unit | Labels | Meaning |
|---|---|---:|---|---|
| `om.audit_logs.pending_writes` | gauge | `{task}` | stage=`crud_dispatch|service_write` | Accepted writes currently in flight. |
| `om.audit_logs.oldest_pending_age` | gauge | `s` | stage=`crud_dispatch|service_write` | Oldest accepted write age; zero when empty. |
| `om.audit_logs.dropped` | counter | `{task}` | stage, reason=`capacity` | Writes not started because the stage is full. |

### Existing return contracts

- CRUD access-log dispatch still resolves to its existing result union; capacity rejection is `status: 'skipped'`, `count: 0`.
- Direct `log()` retains its nullable result shape and returns `null` on capacity rejection.
- `logMany()` retains its numeric result and returns `0` on capacity rejection.
- `flushPendingCrudAccessLogs()` and `flushAccessLog()` retain their promise signatures and wait until accepted pending work empties.

There are no endpoint, response schema, UI route, or user-facing i18n changes. Manual UI QA is not applicable.

## Migration & Compatibility

- No migration, backfill, entity, route, event, ACL, or discovery change.
- Normal behavior below the configured cap is unchanged.
- Overload behavior intentionally changes from unbounded accepted work to bounded, observable best-effort loss, as requested by issue #5784.
- Raising the finite cap reduces drop sensitivity. Full rollback is a code revert; no stored state requires reversal.
- The implementation depends only on the additive, optional metric bridge; admission still works if telemetry is disabled or an older host supplies no metric method.

## Implementation Plan

### Phase 1: Shared admission primitive

1. Add the bounded tracker with capacity parsing, admission-before-factory, depth/age/drop recording, warning throttle, flush, and disposal.
2. Cover synchronous factory throws, asynchronous settlement, capacity rejection, monotonic age, repeated flush waves, disabled telemetry, and timer cleanup.

### Phase 2: Access-log integration

1. Replace the CRUD dispatcher pending set and preserve its result/flush contracts.
2. Replace the service pending set and preserve direct/batch result/flush contracts.
3. Add explicit rotation single-flight and concurrency coverage for default and zero intervals.
4. Mirror the env example through create-app template sync and document loss/tuning semantics.

### File Manifest

| File | Action | Purpose |
|---|---|---|
| `packages/shared/src/lib/telemetry/pending.ts` | Add | Generic bounded pending-work tracker. |
| `packages/shared/src/lib/telemetry/__tests__/pending.test.ts` | Add | Deterministic admission/metrics/flush coverage. |
| `packages/shared/src/lib/crud/factory.ts` | Modify | Bound CRUD access-log dispatch. |
| `packages/shared/src/lib/crud/__tests__/log-crud-access.test.ts` | Modify | Verify cap/drop/flush result behavior. |
| `packages/core/src/modules/audit_logs/services/accessLogService.ts` | Modify | Bound persistence and enforce rotation single-flight. |
| `packages/core/src/modules/audit_logs/services/__tests__/*` | Modify | Verify inner cap and concurrent rotation. |
| `apps/mercato/.env.example` | Modify | Document the cap. |
| `packages/create-app/template/.env.example` | Modify | Mirror standalone-app configuration. |
| `apps/docs/docs/user-guide/audit-logs.mdx` | Modify | Document overload loss and tuning. |
| `packages/telemetry/{README.md,AGENTS.md}` | Modify | Document backlog metrics and label guardrails. |
| `.ai/specs/2026-04-29-telemetry-and-otel.md` | Modify | Extend the implemented metric catalog/changelog. |

### Testing Strategy

- Unit tests use deferred promises and fake monotonic clocks/timers; no seeded data is required.
- Integration at the infrastructure boundary records exact metrics through an in-memory provider and exercises real access-log service return contracts with fake persistence.
- Existing audit-log API tests remain unchanged because HTTP response contracts do not change; no browser scenario is added.

## Risks & Impact Review

#### Best-effort access records are dropped under overload
- **Scenario**: A stage already has 256 unresolved writes and rejects the next write.
- **Severity**: Medium
- **Affected area**: Audit/access observability records only; domain mutations and API responses continue.
- **Mitigation**: Reject before work starts, emit a counter and rate-limited warning, expose depth/age, and permit a higher finite cap after measurement.
- **Residual risk**: Some access records are absent during sustained DB distress; this is preferable to unbounded process memory for the existing best-effort channel.

#### Nested caps obscure where loss occurred
- **Scenario**: The outer dispatcher accepts work but the service stage is full and rejects it.
- **Severity**: Low
- **Affected area**: Metric interpretation and access-log completeness.
- **Mitigation**: Fixed stage labels distinguish rejection points; each layer preserves its result contract and counts only its own rejection.
- **Residual risk**: One logical request can contribute to both depth series at different times, which is documented rather than summed as a single backlog.

#### Flush waits indefinitely under continuous producers
- **Scenario**: New accepted work arrives while shutdown/test flush is waiting.
- **Severity**: Medium
- **Affected area**: Graceful shutdown and deterministic tests.
- **Mitigation**: Preserve existing drain-until-empty semantics and bound accepted concurrency; host shutdown must stop producers before flushing.
- **Residual risk**: A host that keeps producing can delay shutdown, matching current behavior but with finite memory.

#### Rotation promise is cleared by the wrong caller
- **Scenario**: Concurrent completion paths clear a newer in-flight sweep, allowing overlap.
- **Severity**: Medium
- **Affected area**: Audit-log retention deletion work.
- **Mitigation**: Capture the owned promise and clear only when the slot identity still matches; test concurrent interval-zero calls.
- **Residual risk**: A permanently hung DB deletion keeps callers awaiting one sweep; acquisition timeouts and operational metrics expose the underlying DB fault.

#### Labels leak data or create cardinality growth
- **Scenario**: Tenant or record values are added to backlog metric attributes.
- **Severity**: High
- **Affected area**: Telemetry cost and confidentiality.
- **Mitigation**: The tracker accepts a fixed stage definition, reason is constant, exact-label tests reject dynamic values, and provider redaction remains active.
- **Residual risk**: Future contributors can change the catalog; package rules and tests remain the guardrail.

## Final Compliance Report — 2026-08-30

### AGENTS.md Files Reviewed

- `AGENTS.md` (root)
- `.ai/specs/AGENTS.md`
- `packages/shared/AGENTS.md`
- `packages/core/AGENTS.md`
- `packages/telemetry/AGENTS.md`
- `packages/create-app/AGENTS.md`
- `BACKWARD_COMPATIBILITY.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|---|---|---|---|
| root `AGENTS.md` | Preserve behavior unless issue/spec requests change. | Compliant | Only overload admission changes, explicitly requested by #5784. |
| root `AGENTS.md` | Never expose cross-tenant data. | Compliant | Metrics contain fixed stage/reason labels and no record data. |
| `packages/shared/AGENTS.md` | Shared utilities must stay domain/provider neutral. | Compliant | The tracker is generic and uses the optional runtime bridge. |
| `packages/core/AGENTS.md` | Preserve module/API/entity/event contracts. | Compliant | No route, entity, event, ACL, or discovery surface changes. |
| `packages/telemetry/AGENTS.md` | Semantic names and bounded labels. | Compliant | Names are cataloged and labels are constants. |
| `packages/create-app/AGENTS.md` | Mirror app env/template changes. | Compliant | Both examples change together and template sync is required. |
| `BACKWARD_COMPATIBILITY.md` | Do not remove, rename, or narrow contracts. | Compliant | Existing signatures remain; overload loss is a requested best-effort behavior change. |
| root data/UI rules | Preserve isolation and design-system behavior. | N/A | No tenant query, schema, API, or UI surface changes. |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Data models match API contracts | Pass | Neither changes. |
| API contracts match UI/UX section | Pass | Both are explicitly unchanged. |
| Risks cover all write operations | Pass | Admission, nested stages, flush, rotation, and telemetry labels are covered. |
| Commands defined for all mutations | N/A | No domain command is introduced. |
| Cache strategy covers all read APIs | N/A | No read API/cache change. |
| Integration coverage maps affected paths | Pass | Shared tracker and service infrastructure boundaries have focused coverage. |

### Non-Compliant Items

None.

### Verdict

**Fully compliant: Approved — ready for implementation.**

## Changelog

### 2026-08-30

- Added the access-log overload safety design for issue #5784.
- Split runtime/pool observability into its own independently shippable prerequisite specification after fresh-context scope review.
