# Scheduler Manual Trigger Audit Logging

**Status:** Implemented — 2026-08-21 (awaiting deployment, so the spec stays in `.ai/specs/` and is
listed under Pending in the index)

## TLDR

`POST /api/scheduler/trigger` was the only scheduler mutation that never reached the
`CommandBus`, so manually running a schedule left no `ActionLog` row. This spec moves the trigger
behind a new `scheduler.jobs.trigger` command that records every authenticated attempt — success and
refusal alike — against the calling user, and makes a manually triggered command schedule execute as
the person who triggered it rather than as the schedule's creator.

Related: [`2026-07-28-audit-log-read-tenant-scope-fail-closed.md`](2026-07-28-audit-log-read-tenant-scope-fail-closed.md)
covers fail-closed audit-log **reads**; this spec covers a **write** path that was missing entirely.

## Problem Statement

1. **The trigger route was unaudited.** `scheduler.jobs.create`, `.update` and `.delete` all run
   through `commands/jobs.ts` with `scheduler.audit.*` labels. The trigger route talked to the ORM and
   the queue directly, and its only trace was a `logger.info` line.

   This matters more than an ordinary missing audit row. Manual triggering is an authorised-looking
   way to make an automated job execute at a moment of the actor's choosing, against a target the
   actor did not have to author.

2. **Refusals were invisible.** Probing schedule ids, or repeatedly trying to trigger a system-scoped
   schedule without super-admin, left nothing behind at all.

3. **Manual runs named the wrong person.** `buildScheduledCommandContext` only knew
   `schedule.createdByUserId`, so a manual run of a command schedule executed under the creator's
   identity. `ExecuteSchedulePayload.triggeredByUserId` was carried on the queue payload but never
   read by the worker.

4. **A gate/identity mismatch was latent in the same code.** `assertSchedulerSafeCommandAuthorized`
   RBAC-checks a user id taken straight off the schedule row and never sees the
   `CommandRuntimeContext`. Attributing the run to the triggerer without touching the gate would have
   authorized the creator while executing as somebody else.

## Proposed Solution

### `scheduler.jobs.trigger` command

New handler in `packages/scheduler/src/modules/scheduler/commands/trigger.ts`. It owns the whole
former route body: load the schedule by id, decide access via `resolveScheduleAccess`, check the
queue strategy, enqueue.

It returns a `TriggerScheduleResult` discriminated by `outcome`
(`enqueued | not_found | forbidden | strategy_unsupported | failed`) and **never throws for an
expected refusal**. The route maps `outcome` to HTTP.

### Route as a mapper

`api/trigger/route.ts` keeps the 401 short-circuit and the zod parse, builds a
`CommandRuntimeContext`, executes the command and maps the outcome. Response bodies and status codes
are unchanged.

### Actor attribution

`resolveScheduledCommandActorUserId(schedule, { triggeredByUserId })` in `lib/commandContext.ts` is
the single definition of the precedence *triggering user → creator → nobody*. The worker resolves the
actor once and passes it to both `assertSchedulerSafeCommandAuthorized` and
`buildScheduledCommandContext`, establishing the invariant: **the identity that executes is the
identity that was authorized.**

## Design Decisions

### Outcomes, not exceptions

`CommandBus.execute` (`packages/shared/src/lib/commands/command-bus.ts`) has no `try`/`catch`. A throw
from `handler.execute` propagates straight out, skipping `captureAfter`, `buildLog`, `persistLog`,
interceptors and cache invalidation. Nothing in the codebase ever writes `executionState: 'failed'`,
and the `ActionLog` entity has no error column.

Throwing on refusal would therefore lose exactly the entries this change exists to create. Returning
an outcome is a hard requirement, not a style preference.

### The log row carries the actor's scope, on every outcome

Unlike the sibling create/update/delete handlers, which log the schedule's tenant/organization,
`buildLog` here uses the caller's. A refusal must never carry the target's tenant: that would leak
cross-tenant existence into the caller's own trail, and because `ActionLogService` filters
`organization_id` with strict equality, it would file the row where the caller's auditors could never
read it.

### A refusal discloses nothing about the row

`resolveScheduleAccess` deliberately answers `not_found` rather than `403` for another tenant's
schedule so a caller cannot confirm an id exists. For `not_found` and `forbidden` the payload's
`scheduleName`, `targetType` and `target` stay `null`; details are populated only once access has been
granted. The requested id *is* recorded, so probing is traceable.

### No undo

Registered `isUndoable: false` with no `undo`/`redo`. A queued execution runs as soon as a worker
picks it up, so an undo token would offer to reverse an enqueue that no longer exists while leaving
the run's real effects untouched; those are reversed through the entries the run itself writes. This
also keeps `TC-UNDO-001 §4` (trigger exposes no `x-om-operation` token) correct.

### Key-only callers keep acting as the creator

`triggeredByUserId` is populated from `resolveCommandActorUserId`, which reads `auth.userId` **before**
it considers `auth.isApiKey`. So an API key issued on a user's behalf resolves to that user and the run
is attributed to — and authorized as — them, which is the correct actor. Only a key-only context (no
bound user) yields `null`: a bare key id is not a user id, so an RBAC lookup against it could never
succeed, and falling back to the creator preserves today's behavior for that caller class.

### Command id

`scheduler.jobs.trigger` matches the `scheduler.jobs.<verb>` convention of the existing three command
ids. It is textually identical to the ACL feature id in `acl.ts`, which lives in a separate registry —
no functional collision, but grepping that string now returns both.

## API Contracts

`POST /api/scheduler/trigger` — **unchanged**. Same request schema, same response bodies, same status
codes:

| outcome | status | body |
| --- | --- | --- |
| `enqueued` | 200 | `{ ok, jobId, message }` |
| `not_found` | 404 | `{ error }` |
| `forbidden` | 403 | `{ error }` |
| `strategy_unsupported` | 400 | `{ error, message }` |
| `failed` | 400 | `{ error }` |
| no actor | 401 | `{ error }` |

Only the `openApi` description text changed, to record that attempts are audited.

New action-log rows: `commandId: 'scheduler.jobs.trigger'`, `resourceKind: 'scheduler.job'`,
`resourceId` = the requested schedule id, `actionLabel` from `scheduler.audit.trigger`, and a
`commandPayload` carrying `scheduleName`, `targetType`, `target`, `outcome`, `queueJobId`, `error`.

## Risks & Impact Review

| Risk | Severity | Area | Mitigation | Residual |
| --- | --- | --- | --- | --- |
| The audit write happens after the enqueue and the bus does not guard it, so a failing audit store returns an error for a job that *was* queued; a user retry could double-run the schedule | Medium | `api/trigger` | Not swallowed — silently losing the row is the failure this change exists to prevent. The route logs the failure at error level so the run stays traceable | A retry after an audit-store outage can enqueue twice |
| Gating the effective actor **narrows** access: a user holding only `scheduler.jobs.trigger` can no longer manually run a command schedule authored by someone with broader features | Medium | worker RBAC | Intended — that path was privilege escalation through another user's authorization. Blast radius is one allowlisted command (`scheduler.test.echo`) | Deployments relying on that escalation see a refusal |
| Gating the effective actor **widens** access where the triggerer holds features the creator lacks | Low | worker RBAC | Intended and consistent with the invariant | None |
| Queue-strategy and enqueue failures now also produce audit rows | Low | audit volume | Bounded by the trigger's own feature gate | Slightly more rows |
| A refused trigger writes a row naming a schedule id the caller cannot see | Low | `audit_logs` | Only the id is recorded, scoped to the caller's tenant; no attribute of the row is included | None |

Not changed: database schema, ACL features, event ids, DI keys, response shapes.

## Testing

- `commands/__tests__/trigger.test.ts` — every outcome (`enqueued`, `not_found`, foreign-tenant
  `not_found`, `forbidden`, super-admin system-scope success, `strategy_unsupported`, `failed`),
  queue closed on both the success and failure paths, a close failure not failing a completed enqueue,
  API-key fallback, and `buildLog` output for a success and a refusal.
- `lib/__tests__/commandContext.test.ts` — triggering user wins, falls back to creator, then to the
  system actor; direct coverage of `resolveScheduledCommandActorUserId` including blank ids.
- `workers/__tests__/execute-schedule.worker.test.ts` — a manual run gates and executes as the
  triggerer; an unattended run still gates the creator; a triggering user on a `scheduled` payload is
  ignored; a triggerer lacking the target features is refused even when the creator holds them.
- `__integration__/TC-SCHED-009.spec.ts` — a manual trigger and a refused trigger each write an
  action-log row naming the caller. Independent of `QUEUE_STRATEGY`, because refusals are logged too.

## Backward Compatibility

No contract surface changes. The command id and the `scheduler.audit.trigger` i18n key are additive;
the route's request/response shapes, status codes and feature gate are untouched. The behavior changes
are confined to which identity a manually triggered command schedule runs as, and which identity the
scheduler-safe-command gate authorizes — both described under Risks above.

## Changelog

- **2026-08-21** — Initial spec and implementation: `scheduler.jobs.trigger` audit command returning
  outcomes rather than throwing, trigger route reduced to an outcome→HTTP mapper, manual runs
  attributed to and authorized as the triggering user, `scheduler.audit.trigger` added to all five
  locales, unit coverage for every outcome plus `TC-SCHED-009`.
