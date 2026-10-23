# Security user MFA-reset section adoption

**Status:** Proposed
**Implementation ownership:** Open Mercato core team members only
**Depends on:** `.ai/specs/2026-10-22-crudform-section-overrides-framework.md`
**Related:** `.ai/specs/enterprise/2026-10-22-crudform-section-adoption.md`

## TLDR

Adopt the section-override framework on `SecurityUserForm` as one enterprise capability: display the user/MFA context and execute a sudo-authorized, audited MFA reset with a required reason. A configured invalid policy blocks every mutation control; it never restores an actionable base form.

## Overview

The form renders `summary`, `methods`, and `reset`. Only `reset` owns input (`resetReason`) and mutation; the first two jointly provide operator context for the destructive action. The page currently acquires sudo authority, posts to the legacy route, delegates through the existing command, reloads status, and shows flash feedback.

## Problem Statement

Visual replacement alone cannot prove preservation of reason validation, user binding, sudo, `security.admin.manage`, target scope, audit, `security.mfa.reset`, notifications, and reload. Hiding context can also make a destructive action unsafe unless dependency and concurrency contracts are explicit.

## Goals and Non-goals

### Goals

- Publish exact stable identity, operator-context semantics, and three sections.
- Bind reset to an additive façade that preserves the current security and effect chain.
- Define non-leaking gate precedence, current-state concurrency, and per-request delegation.
- Preserve the legacy no-policy path and block configured invalid policy mutations.

### Non-goals

- Changing MFA state models, sudo policy, reset command semantics, audit, events, or notifications.
- Adding cross-request idempotency or optimistic locking to MFA reset.
- Adopting sudo-config CRUD or any other enterprise form.

## Stable Contract

| Fact | Stable value |
|---|---|
| host | `crud-form:security.user-mfa-reset` |
| variant / operation | `detail` / `update` |
| host and mutation resource | `security.user` / target user id |
| ordered sections | `summary`, `methods`, `reset` |
| surface entry | `security.user-mfa-reset.detail.update` |
| summary data contract | `security.user-mfa-reset.summary/v1` |
| methods data contract | `security.user-mfa-reset.methods/v1` |
| destructive-action context | `security.user-mfa-reset.operator-context/v1` |
| reset capability | `security.user-mfa-reset.reset/v1` |
| reset mutation surface | `security.user-mfa-reset.reset.execute` |
| guarded façade | `POST /api/security/users/:userId/mfa/reset/section-policy` |
| delegated command | `security.admin.mfa.reset` |
| concurrency mode | action-current-state; no optimistic token |

The operator context is bound to the route `userId` and contains `email`, `recoveryCodesRemaining`, `enrolled`, `compliant`, and `methods: Array<{ type, label?, lastUsed? }>`; an empty methods array renders the localized no-methods state. The base composition provides it only while compatible summary and methods providers jointly supply every field. A replacement may provide the complete versioned operator-context contract only when it also renders, in the reset action's adjacent labelled context region, the target email (or explicit target id fallback), enrollment/compliance state, recovery-code count, and each method's type/label/last-used value or the localized no-methods state. The reset control references that region through its accessible description. Browser assertions verify both visible and accessibility-tree content. Hiding `reset` removes submit entirely.

## Proposed Solution

Enterprise-owned runtime descriptors define:

- `summary`: display-only identity, enrollment, compliance, and recovery-code context;
- `methods`: display-only active-method context;
- `reset`: in a ready policy, owns `resetReason`, trims it, requires 1–1000 characters, and owns the mutation surface. The no-policy identity path retains the current legacy trim/non-empty validator without the new maximum.

The page passes explicit host/variant/update/host-resource identity. After section validation it acquires `requireSudo('security.admin.mfa.reset')`. Cancellation creates no bound client and sends no request. A ready policy uses the immutable framework client with host/target/action facts and `x-sudo-token`; custom protected-header collisions fail locally and the server independently recomputes all facts.

The façade gate order is exact:

1. route middleware authenticates and checks `security.admin.manage`;
2. UUID parsing, `resolveSecurityUsersContext`, and `assertActorCanAccessSecurityUserTarget` establish the non-enumerating tenant/organization-scoped target;
3. the framework recomputes accepted policy, operation, and surface and independently reauthorizes the asserted host and mutation target;
4. `z.object({ reason: z.string().trim().min(1).max(1000) })` returns the established 400 shape;
5. `requireSudo(req, 'security.admin.mfa.reset')` validates step-up authority;
6. one `security.admin.mfa.reset` command executes for that accepted HTTP request.

Unauthenticated, unauthorized, missing, and out-of-scope targets never receive policy-specific 409 details. The normalized reason reaches the command, audit, event, and notification chain.

This action deliberately has no optimistic-lock token. The façade rejects an expected-version header and rechecks target access at request time. Under the existing read-committed/request transaction, the command resets methods and unused recovery codes returned by its reads: enrollment committed before a read is included; enrollment committed after the relevant read but before reset commit is not in that loaded set and remains active; enrollment committed after reset commit also remains active. Overlapping reset requests each return 200 and produce one command/audit/event/notification chain. A request reading after the first commit reports zero counts; requests that both read before either flush may report the same positive counts, matching existing non-idempotent semantics. A stale display cannot weaken authorization or narrow the server-side query. Retried HTTP requests are separate accepted requests.

## Architecture

| Area | Change |
|---|---|
| `components/SecurityUserForm.tsx` | Identity, three descriptors, 1–1000 client validation, reset binding |
| `backend/security/users/[id]/page.tsx` | Sudo challenge, immutable bound request, exact flash/reload sequence |
| enterprise security provider | Exact capability, context, dependency, and no-lock facts |
| `api/users/[id]/mfa/reset/section-policy/route.ts` | Ordered auth/scope/policy/body/sudo gates and command delegation |
| `commands/resetUserMfa.ts` | Existing command/effect chain receives normalized façade input |
| `extension-points.ts` | Provider/context/dependency/mutation facts |
| legacy `api/users/[id]/mfa/reset/route.ts` | Unchanged no-policy transport and validator |

No security-specific runtime type enters OSS packages.

## Data Models

No migration or record-shape change. Existing MFA, audit, notification, and sudo data remain authoritative.

## API Contracts

The existing `POST /api/security/users/:userId/mfa/reset` route is unchanged. With no configured policy the page continues to call it. The additive façade accepts `{ reason: string }`, trims and limits reason to 1–1000 characters server-side, requires framework policy plus `x-sudo-token` headers, rejects an optimistic-lock header, and returns exact HTTP `200` `{ "ok": true }`.

Policy mismatch returns HTTP `409` `{ "error": "extension_policy_mismatch", "code": "extension_policy_mismatch" }` before body/sudo/command but only after auth, feature, and scoped-target authorization. Other established response shapes remain unchanged.

| Resolver state | Route/action behavior |
|---|---|
| no configured policy | Complete base form; submit uses unchanged legacy route |
| configured, pending | No reset control and no request |
| configured, ready | Accepted descriptors; submit uses only the façade |
| configured, invalid | Blocking error; no reset control or fallback |
| policy removed | Next resolver load/page reload returns to legacy; prior façade carriers no longer match current facts |

## UI/UX

- no policy preserves summary, methods, reset, challenge, flashes, and reload;
- pending uses `LoadingMessage` with no reset control;
- ready renders accepted ordered descriptors;
- configured failure uses blocking `ErrorMessage` with `crud_form_section_policy_invalid` and no action;
- challenge cancellation keeps the localized error flash and sends no request.

## Edge Cases & Failure Scenarios

| Case | Required behavior |
|---|---|
| Reset hidden or context incomplete | No action, or configured policy blocks for missing context |
| Empty/whitespace reason | Both legacy and policy clients block before challenge; each route independently returns its established 400 |
| Reason exceeds 1000, no policy | Current legacy client and route behavior remains unchanged |
| Reason exceeds 1000, ready policy | Policy descriptor/façade reject; no sudo, command, or effect |
| Challenge cancelled | No client/request/command |
| Policy targets another user | Exact mismatch 409 before body/sudo/command |
| Unauthenticated plus wrong policy | Existing 401 body wins |
| Missing feature plus wrong policy | Existing feature-denial 403 body wins |
| Malformed UUID plus wrong policy | Established invalid-user-id 400 wins after auth/feature |
| Nonexistent, cross-tenant, cross-org, or denied target plus wrong policy | Same established non-enumerating 404 wins |
| Authorized target plus wrong policy | Exact policy 409 |
| Sudo invalid | Existing sudo denial; policy grants no authority |
| Reset hidden, any context topology | Accepted policy has no action and context need not block |
| Reset active, summary or methods contract missing | Entire configured policy is invalid and blocking |
| Reset active, complete conforming replacement context | Policy may be ready; visible/accessibility assertions must pass |
| Enrollment overlaps reset | Loaded-set read-committed behavior above; between-read enrollment remains active |
| Resets overlap | Both accepted requests return 200 and emit their own trace; counts follow each read snapshot |
| Command succeeds | One accepted-request effect trace, then success flash and detail reload |

## Risks & Impact Review

| Risk | Severity | Mitigation | Residual risk |
|---|---|---|---|
| Policy leaks target/policy state or bypasses security | Critical | Ordered auth/feature/scope gates and compound-invalid tests | None accepted |
| Destructive action loses operator context | High | Exact combined context contract | Approved replacement may intentionally redesign display |
| Duplicate reset effects | High | One delegation per accepted request and explicit retry semantics | A retry is a new request under existing behavior |
| Stale display changes action scope | High | Current-state server transaction and fresh target authorization | Post-transaction enrollment remains active by design |
| Invalid policy restores base reset | Critical | Blocking configured-host failure | Removing policy deliberately restores legacy after reload |

Rollback removes only host eligibility and façade advertisement. The legacy route/form remain; published ids/routes stay compatible or follow deprecation.

## Migration & Backward Compatibility

All additions are optional. Existing form props, route, command, section ids, auth/sudo/audit behavior, events, and responses remain. The 1000-character limit applies only to the façade and does not silently alter the legacy endpoint. New identities and façade become stable after publication.

The golden success trace is: one `security.admin.mfa.reset` command; audit label `security.audit.mfa.reset`, resource kind `security.user_mfa`, target user id, normalized reason payload, and source `security.admin.users`; service mutation of all current active methods and unused recovery codes; one `security.mfa.reset` event with actor, target, scope, normalized reason, counts, and `resetAt`; HTTP 200 `{ ok: true }`; success flash; then parallel reloads of `/api/security/users/:userId/mfa/status` and `/api/security/users/mfa/compliance`. Persistent subscriber `security:mfa-reset-notification` asynchronously creates notification type `security.mfa.reset` for the target user with source `security:mfa_reset/<userId>` and emails that user when an email exists. Mutation flush precedes event emission; response follows command completion; notification delivery need not precede the response.

## Phasing and Implementation Plan

1. Add stable facts/descriptors, combined context semantics, explicit identity, and no-policy golden fixtures.
2. Add the ordered façade and bind reset only after a successful sudo challenge.
3. Add `components/__tests__/SecurityUserForm.sections.test.tsx`, `api/users/__tests__/mfa-reset-section-policy.route.test.ts`, and service/subscriber cases for state-specific length, visible context, dependencies, compound-invalid precedence, policy/resource mismatch, auth/target/sudo denial, every pinned concurrency interleaving, per-request command count, and the exact effect trace.
4. Add self-contained `__integration__/TC-SEC-009.spec.ts` browser coverage for hide/replace/accessibility/pending/failure/reset success/cancellation with fixture cleanup.
5. Run the focused Jest paths above plus existing `api/users/__tests__/mfa-reset.route.test.ts`, `services/__tests__/MfaAdminService.test.ts`, and `subscribers/__tests__/notifications.test.ts`; then run `yarn workspace @open-mercato/enterprise build`, `yarn typecheck`, `yarn crud-form-sections:inventory:check`, `git diff --check`, and each configured validation command with recorded evidence.

## Integration Coverage

- exact legacy no-policy path versus ready façade request/result;
- accepted/missing/stale/wrong-user/wrong-surface policy and compound-invalid precedence;
- permission, target scope, tenant/org, sudo success/cancel/failure;
- reason trim/empty/max, audit record, event payload, subscriber/recipient, response/flash/reload order;
- enroll-before-read, enroll-between-read-and-commit, enroll-after-commit, and overlapping reset/reset behavior without an optimistic token;
- browser hidden/replaced/context dependency/pending/blocking-failure paths.

## Acceptance Criteria

1. Exact stable facts and operator context are published only from enterprise security.
2. No façade reset executes without ready policy, auth, feature, target scope, sudo, and a normalized 1–1000-character reason.
3. Hiding reset removes submit; invalid configured policy exposes no mutation control.
4. Each accepted request delegates once and preserves the pinned command, audit, event, notification, response, flash, reload, and error contracts; retries are separate requests.
5. Current-state concurrency and the absence of an optimistic token are tested.
6. Focused unit/API/browser and named validation gates pass.
7. Implementation and review are performed by Open Mercato core team members.

## Final Compliance Report

| Area | Status | Evidence required before implementation PR approval |
|---|---|---|
| Scope cohesion | Ready | One MFA-reset form/action capability |
| Security | Ready | Ordered auth/target/sudo/policy matrix |
| Side effects | Ready | Exact per-request command/audit/event/notification/response/reload trace |
| Concurrency | Ready | Current-state commit-order proof; no lock token |
| Compatibility | Ready | Legacy/no-policy golden evidence |
| Ownership | Ready | Core-team-only implementation and review |

## Changelog

- **2026-10-22:** Split user MFA-reset adoption from sudo-config CRUD and pinned identity, context, façade precedence, current-state concurrency, effect trace, failure states, and core-team-only ownership.
