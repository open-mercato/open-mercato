# Security user MFA-reset transaction boundary

**Status:** Proposed prerequisite
**Implementation ownership:** Open Mercato core team members only
**Related:** `.ai/specs/enterprise/2026-10-22-security-user-mfa-reset-section-adoption.md`

## TLDR

Harden the existing `security.admin.mfa.reset` command independently of any section-policy UI. The service locks and resets the target user's active MFA methods and unused recovery codes in one transaction, commits before publishing `security.mfa.reset`, and preserves an explicit command-audit and subscriber failure boundary.

## Overview

The current reset command is shared by the legacy security-user route and the proposed section-policy façade. Its service performs multiple reads and mutations without a request transaction, so concurrent enrollment/reset work can observe or apply an incoherent set. Event publication, command audit, and the current inline notification/email subscriber also need a falsifiable order before another transport relies on them.

This prerequisite changes only the existing command/service execution boundary. It is independently deployable and must land before the section-policy adopter.

## Problem Statement

Without one transaction and held row locks, a reset can partially reason over active methods and unused recovery codes while another request changes them. A transport-specific fix would leave the legacy route unsafe and duplicate concurrency logic. Treating database mutation, event publication, command audit, notification, and email as one atomic effect would also be false because no outbox spans those systems.

## Goals and Non-goals

### Goals

- Reset all rows current at the command's locked reads in one database transaction.
- Serialize overlapping resets on matching rows and define enrollment timing precisely.
- Publish the existing event only after commit and pin command-audit/subscriber failure semantics.
- Preserve the command id, legacy route, authorization, payload, response, event id, audit id, and notification id.
- Provide barrier-controlled concurrency and failure-injection coverage usable by every caller.

### Non-goals

- Adding optimistic-lock headers, cross-request idempotency, or an outbox.
- Changing MFA entities, enrollment behavior, sudo policy, UI, or route schemas.
- Adopting CrudForm sections or adding a policy façade.
- Changing `security.mfa.reset` to persistent/queued delivery, splitting its combined notification/email subscriber, or adding retry/idempotency semantics; those require a separate events/notifications spec and explicit approval for delivery-semantics changes.

## Proposed Solution

`MfaAdminService.resetUserMfa` receives the authorized tenant, organization, actor, and target ids from `security.admin.mfa.reset`. It executes the target read through `findOneWithDecryption` using the transaction manager and current tenant/organization encryption scope, then performs the active-method read, unused-recovery-code read, mutations, and flush inside the same `em.transactional` callback. Missing and out-of-scope targets retain the unified 404.

Both child queries use the transaction manager, deterministic id ordering, `LockMode.PESSIMISTIC_WRITE`, and `refresh: true`; all loaded rows remain locked through commit. `UserMfaMethod` predicates include tenant, organization, target user, active, and soft-delete scope. `MfaRecoveryCode`, which has no organization column, is constrained by the already authorized target user plus tenant and unused state. Enrollment committed before the relevant child-table query is included. A method or recovery code committed after its table query is outside that request's locked set and remains active/unused. No direct ORM relationship is added.

Overlapping resets serialize on matching rows. After the first commits, the second transaction re-evaluates current predicates and reports zero for rows already reset. A retry remains a separate accepted command under existing behavior.

The private transaction callback returns an internal, non-exported carrier containing counts plus the immutable event payload. The existing public `MfaAdminService.resetUserMfa` overloads remain `Promise<void>`: the method consumes that carrier to publish `security.mfa.reset` after commit and then resolves without a value. Only after command execution, including event publication, succeeds does the command bus persist `security.audit.mfa.reset` and return to the route.

The event call deliberately retains its current non-persistent emit options. Despite the subscriber's `persistent: true` metadata, a non-persistent emit invokes it inline; it is therefore part of event publication, delays the command response, and has no queue retry. The combined handler creates the notification and then attempts email without a deterministic dedupe key, so a failure may leave a partial subscriber effect. This prerequisite documents that behavior and does not claim durable, asynchronous, idempotent, or exactly-once delivery.

The exact failure boundary is:

1. scoped read, mutation, flush, or commit failure rolls back and emits neither event nor command audit;
2. event publication, including the inline `security:mfa-reset-notification` handler, happens after commit; because the current emit does not set `rethrowHandlerErrors`, an inline notification/email handler failure is logged and swallowed by the event bus, may leave partial notification/email effects, and does not prevent command-audit persistence or the unchanged success response;
3. no automatic retry occurs for that non-persistent emit; a caller receives success despite a swallowed handler failure, and a later explicit reset remains a new command that may repeat a prior partial subscriber effect;
4. a separate event-bus infrastructure failure outside handler delivery may reject the emit, leave the reset committed, and prevent command audit/success; command-audit persistence failure after a resolved emit likewise makes the command fail and cannot roll back the reset or subscriber effects.

This spec does not claim atomicity across the database, event bus, audit store, notification store, or email provider.

## Architecture

| Area | Change |
|---|---|
| `commands/resetUserMfa.ts` | Preserve command id/input/auth contract and await the existing public `Promise<void>` service contract |
| `MfaAdminService.resetUserMfa` | Preserve public `Promise<void>` overloads; privately consume one transaction carrier for scoped held child-row locks, mutations/flush, and post-commit event publication |
| existing legacy MFA-reset route | No transport/schema change; automatically consumes the hardened command |
| event/audit subscribers | No identifier or payload removal; retain and test the current inline, logged-and-swallowed, non-retryable, potentially partial notification/email behavior |
| focused tests | Barrier interleavings and injected read/flush/commit/event/audit failures |

The service receives its ORM/event dependencies through the existing DI container. It never creates a second entity manager or publishes from inside the transaction callback.

## Data Models

No migration or record-shape change. Existing MFA method, recovery-code, audit, notification, and user records remain authoritative. Existing timestamps/soft-delete markers continue to represent mutation state.

## API Contracts

No route, OpenAPI, request, response, metadata, or header contract changes. The existing legacy `POST /api/security/users/:userId/mfa/reset` and command input remain compatible. Success still returns the established response after command completion; failures retain the existing non-enumerating transport mapping.

The transaction callback's internal carrier is typed with reset method count, recovery-code count, `resetAt`, and existing event payload fields. It is private to the service implementation and is neither exported nor returned by `resetUserMfa`; the established public service return remains `Promise<void>` and the HTTP shape is unchanged.

The golden successful effect trace is: one `security.admin.mfa.reset` command; one transaction-scoped mutation and commit; one post-commit non-persistent `security.mfa.reset` emit with actor, target, scope, normalized reason, counts, and `resetAt`; inline `security:mfa-reset-notification` creation of notification type `security.mfa.reset` with source `security:mfa_reset/<userId>` followed by its email attempt when an email exists; command-bus persistence of audit label `security.audit.mfa.reset`, resource kind `security.user_mfa`, target user id, normalized reason payload, and source `security.admin.users`; then the caller's unchanged success response. The subscriber metadata is unchanged, but this emit is not queued and the spec makes no retry/exactly-once claim.

## UI/UX

No frontend file, interaction, loading state, provider, or browser request changes. Existing callers keep their current success/error presentation.

## Frontend Architecture Contract

Not applicable: this prerequisite changes only an enterprise command/service transaction and its backend tests. It adds no `use client` boundary, browser import, provider, render-time request, bundle code, or hydration behavior. Verification asserts that the implementation diff contains no frontend file.

## Edge Cases & Failure Scenarios

| Case | Required behavior |
|---|---|
| No active methods/codes | Commit a zero-count reset, publish/audit once under existing semantics |
| Enrollment commits before methods query | Included and reset |
| Enrollment commits after methods query | Outside locked set; remains active |
| Recovery code commits before codes query | Included and invalidated |
| Recovery code commits after codes query | Outside locked set; remains unused |
| Two resets overlap | Matching rows serialize; second re-evaluates predicates and reports zero for rows reset by first |
| Scoped target/read fails | Roll back; no event/audit/subscriber effect |
| Flush or commit fails | Roll back; no event/audit/subscriber effect |
| Event-bus infrastructure publish fails outside handler delivery | Reset remains committed; command errors; no command audit |
| Inline notification creation fails | Reset remains committed; bus logs/swallows handler error; command audit and success response continue; no automatic retry |
| Email fails after notification creation | Reset and notification remain; bus logs/swallows handler error; command audit and success response continue; no automatic retry or dedupe guarantee |
| Audit persistence fails | Reset plus successful inline notification/email remain; command errors; no rollback |

## Risks & Impact Review

| Risk | Severity | Mitigation | Residual risk |
|---|---|---|---|
| Partial or incoherent reset | Critical | One transaction and held scoped child-row locks | Rows inserted after their table query remain active by design |
| Cross-tenant reset | Critical | Existing authorized scope plus tenant/org/user predicates on every query | None accepted |
| Deadlock between concurrent resets | High | Deterministic table/query/id order and focused concurrency tests | Database may still abort one contender, which returns an error safely |
| Event/subscriber/audit mistaken for atomic DB work | High | Exact inline post-commit order, swallowed-handler semantics, and failure-injection tests | Successful HTTP responses can coexist with missing/partial notification/email effects |
| Later reset after partial subscriber failure | High | Explicitly document new-command semantics and test failure between notification/email | Duplicate partial effects remain possible until a separate idempotent persistent-delivery spec lands |
| Legacy behavior regression | High | No route/schema/id change; existing route and subscriber suites stay in the gate | Timing changes because locks are intentionally held through commit |

Rollback reverts the service/command implementation commit. No data migration or public-contract rollback is required; already committed resets remain valid historical operations.

## Migration & Backward Compatibility

This is an in-place behavioral hardening of an existing command. It removes no field, identifier, route, event, audit label, notification type, DI key, import path, or service signature. Callers require no migration. The transaction carrier is a private implementation detail and MUST NOT be exported or change the existing `Promise<void>` overloads.

The prerequisite must merge before `.ai/specs/enterprise/2026-10-22-security-user-mfa-reset-section-adoption.md`. That adopter consumes this command unchanged and must not duplicate the transaction, row locks, or effect ordering.

## Phasing and Implementation Plan

1. Add barrier/failure test seams through existing DI/test facilities without a production-only bypass.
2. Move scoped target/method/code reads, mutations, and flush into one `em.transactional` callback using the transaction manager and deterministic pessimistic-write queries.
3. Return counts/event data only from the private transaction callback, consume it inside `resetUserMfa`, publish the existing event after commit, preserve the public `Promise<void>` overloads, and retain the command bus's audit step after successful command execution.
4. Add service/command/legacy-route tests for empty state, timing boundaries, overlapping resets, rollback, event-infrastructure failure, logged-and-swallowed notification failure, logged-and-swallowed email failure after notification creation, a later explicit reset after that partial effect, audit failure, and the absence of automatic queue retry.
5. Run focused enterprise build/typecheck/tests, `git diff --check`, and the configured validation gate.

## Integration Coverage

- legacy MFA-reset API success and established auth/scope/not-found behavior;
- no methods/codes and ordinary populated reset;
- enroll-before and enroll-after each child-table read;
- barrier-controlled reset/reset overlap with deterministic row ordering and zero-count second result;
- injected scoped-read, mutation, flush, commit, event-infrastructure, notification, email-after-notification, and audit-persistence failures, distinguishing rejected infrastructure emits from logged-and-swallowed handler failures;
- successful-path command/event/audit/notification ids and payload facts once per accepted command, plus explicit proof that swallowed handler failures still audit/respond successfully and a later explicit reset is a new command that may repeat a partial subscriber effect;
- proof that no UI/API schema or optimistic-lock header is introduced.
- compile-time compatibility proving both existing `resetUserMfa` overloads remain assignable to `Promise<void>` and no internal carrier is exported.

## Acceptance Criteria

1. Every reset uses one transaction for scoped target/method/code reads, mutations, and flush.
2. Child rows use deterministic `PESSIMISTIC_WRITE` queries through the transaction manager and remain locked through commit.
3. Overlap and enrollment timing match the documented predicates and barrier tests.
4. Database failure emits no event/audit; inline handler failures are logged/swallowed while audit and success continue; event-infrastructure and audit failures preserve the exact documented post-commit state; no path claims an automatic retry.
5. Existing route, command, event, audit, notification, response, authorization, and public `resetUserMfa(...): Promise<void>` contracts remain compatible.
6. No optimistic token, outbox, frontend change, or cross-module ORM relationship is added.
7. Focused and configured validation gates pass.
8. Implementation and review are performed by Open Mercato core team members.

## Final Compliance Report — 2026-10-27

### AGENTS.md Files Reviewed

- `AGENTS.md`
- `.ai/specs/AGENTS.md`
- `packages/enterprise/AGENTS.md`
- `packages/core/AGENTS.md`
- `packages/core/src/modules/notifications/AGENTS.md`
- `packages/events/AGENTS.md`
- `packages/shared/AGENTS.md`
- `BACKWARD_COMPATIBILITY.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|---|---|---|---|
| root security/data rules | Preserve tenant/org scope, DI, and non-leaking behavior | Compliant | Every read/write retains authorized scope and uses the injected transaction manager |
| root mutation/event rules | Preserve command side effects and define failure boundaries | Compliant | Commit, non-persistent emit, logged/swallowed inline handler, audit, and response order is explicit and tested |
| `packages/events/AGENTS.md` | Do not silently change persistent delivery; persistent retries require focused idempotent subscribers and trusted scope | Compliant | This prerequisite retains the non-persistent emit, claims no queue retry, and defers any persistent redesign to a separate approved spec |
| notifications guide | Keep notification type/id and centralized creation/delivery behavior stable | Compliant | Existing type/create/email behavior is unchanged; logged/swallowed partial inline failures are documented rather than presented as atomic/idempotent |
| enterprise architecture | Keep enterprise security logic in enterprise | Compliant | All implementation and tests remain inside the enterprise security module |
| `.ai/specs/AGENTS.md` | One independently deployable capability with integration coverage | Compliant | Only MFA reset transaction/effect hardening is included |
| `BACKWARD_COMPATIBILITY.md` | Preserve stable routes, ids, payloads, and DI surfaces | Compliant | No public contract is removed or renamed |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Data models match API contracts | Pass | No schema or HTTP shape changes |
| API contracts match UI/UX | Pass | Existing transport/UI remains unchanged |
| Risks cover all write/effect paths | Pass | Reads, locks, flush, commit, swallowed inline subscriber partial effects, later explicit reset, infrastructure failure, and audit are covered |
| Commands defined for all mutations | Pass | Existing `security.admin.mfa.reset` is the only command |
| Cache strategy covers all read APIs | N/A | No cache contract changes |
| Frontend architecture contract is measurable | N/A | No frontend file may change |

### Non-Compliant Items

None.

### Verdict

- **Fully compliant**: Approved — ready for implementation as the MFA section adopter's prerequisite.

## Changelog

- **2026-10-27:** Kept the typed transaction result private and explicitly preserved the exported `resetUserMfa(...): Promise<void>` service contract.
- **2026-10-27:** Split MFA reset transaction-held locking and post-commit effect ordering from the section-policy adopter; pinned the existing non-persistent inline logged-and-swallowed notification/email failure boundary without claiming queue retry or exactly-once delivery.
