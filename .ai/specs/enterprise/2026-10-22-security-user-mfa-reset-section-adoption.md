# Security user MFA-reset section adoption

**Status:** Proposed
**Implementation ownership:** Open Mercato core team members only
**Depends on:** `.ai/specs/2026-10-22-crudform-section-overrides-framework.md`, `.ai/specs/2026-10-22-crudform-section-adoption-inventory.md`, `.ai/specs/enterprise/2026-10-27-security-user-mfa-reset-transaction-boundary.md`
**Related:** `.ai/specs/enterprise/2026-10-22-crudform-section-adoption.md`

## TLDR

Adopt the section-override framework on `SecurityUserForm` as one enterprise capability: display the user/MFA context and execute a sudo-authorized, audited MFA reset with a required reason through the separately hardened reset command. A configured invalid policy blocks every mutation control; it never restores an actionable base form.

## Overview

The form renders `summary`, `methods`, and `reset`. Only `reset` owns input (`resetReason`) and mutation; the first two jointly provide operator context for the destructive action. The page currently acquires sudo authority, posts to the legacy route, delegates through the existing command, reloads status, and shows flash feedback.

## Problem Statement

Visual replacement alone cannot prove preservation of reason validation, user binding, sudo, `security.admin.manage`, target scope, audit, `security.mfa.reset`, notifications, and reload. Hiding context can also make a destructive action unsafe unless dependency contracts are explicit. Transaction/concurrency hardening belongs to the independently deployable prerequisite and is not implemented here.

## Goals and Non-goals

### Goals

- Publish exact stable identity, operator-context semantics, and three sections.
- Bind reset to an additive façade that preserves the current security and effect chain.
- Define non-leaking gate precedence, consume the hardened command prerequisite, and preserve one delegation per request.
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
4. strict route/body/header schemas validate UUID `userId`, `{ reason: z.string().trim().min(1).max(1000) }`, the framework headers, and the signed two-segment base64url `x-sudo-token` of at most 4096 characters, returning the established 400 shape;
5. the mandatory façade helper collects `getAllMutationGuardInstances()`, appends `bridgeLegacyGuard(container)`, and runs `runMutationGuards(...)` as `update` with `{ userFeatures }`; a block returns the stable HTTP 422 `mutation_guard_rejected` envelope with the registered body under `details`, while `modifiedPayload` is merged and revalidated by the strict reason schema, active `reset` leaf contract, user binding, and complete command schema;
6. `requireSudo(req, 'security.admin.mfa.reset')` validates step-up authority against the post-guard request;
7. one `security.admin.mfa.reset` command executes for that accepted HTTP request;
8. every guard `afterSuccessCallbacks` item runs once after command success; callback failure is reported and logged without changing the committed HTTP 200 result.

Unauthenticated, unauthorized, missing, and out-of-scope targets never receive policy-specific 409 details. The normalized reason reaches the command, audit, event, and notification chain.

This action deliberately has no optimistic-lock token. The façade rejects an expected-version header, rechecks target access at request time, and delegates once to the command contract implemented by `.ai/specs/enterprise/2026-10-27-security-user-mfa-reset-transaction-boundary.md`. That prerequisite exclusively owns transaction-held child-row locking, concurrent enrollment/reset semantics, post-commit event ordering, command-audit failure boundaries, and their service tests. This adopter neither duplicates nor weakens them; retries remain separate accepted requests.

## Architecture

| Area | Change |
|---|---|
| `components/SecurityUserForm.tsx` | Identity, three descriptors, 1–1000 client validation, reset binding |
| `backend/security/users/[id]/page.tsx` | Sudo challenge, immutable bound request, exact flash/reload sequence |
| enterprise security provider | Exact capability, context, dependency, and no-lock facts |
| `api/users/[id]/mfa/reset/section-policy/route.ts` | Ordered auth/scope/policy/body/mutation-guard/sudo gates, strict metadata/OpenAPI, and command delegation |
| `commands/resetUserMfa.ts` / `MfaAdminService` | Unchanged dependency supplied by the separately landed transaction-boundary prerequisite |
| `extension-points.ts` | Provider/context/dependency/mutation facts |
| legacy `api/users/[id]/mfa/reset/route.ts` | Unchanged no-policy transport and validator |

No security-specific runtime type enters OSS packages.

## Data Models

No migration or record-shape change. Existing MFA, audit, notification, and sudo data remain authoritative.

## API Contracts

The existing `POST /api/security/users/:userId/mfa/reset` route is unchanged. With no configured policy the page continues to call it. The additive façade accepts at most 4 KiB of `application/json`; a larger body returns 413 before parsing. Its `[id]` route params schema is `z.object({ id: z.string().uuid() }).strict()` and binds that id as semantic `userId`; its body schema is `z.object({ reason: z.string().trim().min(1).max(1000) }).strict()`, and all TypeScript types derive from those schemas. It requires the framework protected-header schemas plus `x-sudo-token: z.string().min(3).max(4096).regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)`, matching the existing signed token format, rejects duplicate/comma-joined protected or sudo headers and any optimistic-lock header, and returns exact HTTP `200` `{ "ok": true }`.

The route exports `metadata = { POST: { requireAuth: true, requireFeatures: ['security.admin.manage'] } }` and `openApi` with the strict path/body/success schemas and exact `200/400/401/403/404/409/413/422/500` matrix. The only 409 is framework policy mismatch (optimistic-lock headers are rejected as 400); 403 covers feature/sudo denial, 404 retains the non-enumerating target shape, and 422 is the framework's stable `{ error: 'mutation_guard_rejected', code: 'mutation_guard_rejected', details?: unknown }` guard envelope. A registered guard's original body is preserved under `details`; its arbitrary `errorStatus` is diagnostic-only at this façade boundary, so runtime guard registration cannot change the static OpenAPI status set.

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

## Frontend Architecture Contract

- add no page-root client boundary, global-provider import, or route-specific component to shared bootstrap; descriptors remain lazy enterprise-owned leaves;
- keep policy resolution and mutation binding in the existing form/page split, use `apiCall` through the framework client, and add no raw `fetch` or ambient header state;
- add no render-time network request beyond the framework's single resolver request for a configured host; the no-policy path remains allocation-light and request-equivalent;
- pending/failed rendering uses shared `LoadingMessage`/`ErrorMessage`, and the existing localized flash/reload flow remains the only success/error navigation path;
- Strict Mode tests prove resolver subscription cleanup, one challenge/request per submit, no duplicate command/callback, and no editable base-form flash during hydration;
- keep net MFA-specific form/page integration under 100 LOC by placing generic resolution, guard, and header behavior in the framework prerequisite; record the browser-chunk diff and `yarn check:client-boundaries` result.

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
| Mutation guard blocks | Stable 422 guard envelope with registered body under `details`; no sudo validation, command, transaction, event, audit, or callback |
| Mutation guard rewrites reason or target facts | Reason is normalized/revalidated; target/policy facts cannot be changed; invalid output is 400/409 before sudo/command |
| Guard success callback fails | Failure is reported/logged once; committed reset and HTTP 200 remain successful |
| Reset hidden, any context topology | Accepted policy has no action and context need not block |
| Reset active, summary or methods contract missing | Entire configured policy is invalid and blocking |
| Reset active, complete conforming replacement context | Policy may be ready; visible/accessibility assertions must pass |
| Hardened reset command rejects/fails | Façade propagates the established error and does not retry or synthesize success; exact persistence/effect state is owned by the transaction-boundary prerequisite |
| Command succeeds | One accepted-request effect trace, then success flash and detail reload |

## Risks & Impact Review

| Risk | Severity | Mitigation | Residual risk |
|---|---|---|---|
| Policy leaks target/policy state or bypasses security | Critical | Ordered auth/feature/scope gates and compound-invalid tests | None accepted |
| Destructive action loses operator context | High | Exact combined context contract | Approved replacement may intentionally redesign display |
| Duplicate reset effects | High | One delegation per accepted request and explicit retry semantics | A retry is a new request under existing behavior |
| Stale display changes action scope | High | Fresh scoped target authorization plus the hardened command prerequisite | Concurrency semantics remain owned and tested by that prerequisite |
| Command failure is mistaken for façade retry/success | High | One delegation, no automatic retry, and prerequisite failure-contract tests | Post-commit reconciliation remains a prerequisite concern |
| Invalid policy restores base reset | Critical | Blocking configured-host failure | Removing policy deliberately restores legacy after reload |

Rollback removes only host eligibility and façade advertisement. The legacy route/form remain; published ids/routes stay compatible or follow deprecation.

## Migration & Backward Compatibility

All additions are optional. Existing form props, route, command, section ids, auth/sudo/audit behavior, events, and responses remain. The 1000-character limit applies only to the façade and does not silently alter the legacy endpoint. New identities and façade become stable after publication.

The façade success trace is: one `security.admin.mfa.reset` command that satisfies the transaction-boundary prerequisite; HTTP 200 `{ ok: true }`; success flash; then parallel reloads of `/api/security/users/:userId/mfa/status` and `/api/security/users/mfa/compliance`. Event, audit, notification, email, concurrency, and post-commit failure ordering are referenced from—not redefined by—the prerequisite.

## Phasing and Implementation Plan

1. Add stable facts/descriptors, combined context semantics, explicit identity, and no-policy golden fixtures.
2. Add the ordered façade and bind reset only after a successful sudo challenge.
3. Add `components/__tests__/SecurityUserForm.sections.test.tsx` and `api/users/__tests__/mfa-reset-section-policy.route.test.ts` cases for state-specific length, visible context, dependencies, compound-invalid precedence, strict schemas/body limits/metadata/OpenAPI, policy/resource mismatch, auth/target/sudo denial, mutation-guard block/modify/legacy/callback behavior, per-request command count, and exact success/error propagation from the prerequisite command.
4. Add self-contained `__integration__/TC-SEC-009.spec.ts` browser coverage for hide/replace/accessibility/pending/failure/reset success/cancellation with fixture cleanup.
5. Run the focused Jest paths above plus the prerequisite's command/service gate as a dependency check; then run `yarn workspace @open-mercato/enterprise build`, `yarn typecheck`, `yarn crud-form-sections:inventory:check`, `git diff --check`, and each configured validation command with recorded evidence.

## Integration Coverage

- exact legacy no-policy path versus ready façade request/result;
- accepted/missing/stale/wrong-user/wrong-surface policy and compound-invalid precedence;
- permission, target scope, tenant/org, sudo success/cancel/failure;
- reason trim/empty/max, one command delegation, established command success/error propagation, and response/flash/reload order;
- strict params/body/header parsing, oversized body, metadata/OpenAPI parity, mutation-guard block/modify/legacy/after-success/callback-failure behavior;
- prerequisite-command success/error propagation with exactly one façade delegation and no automatic retry;
- browser hidden/replaced/context dependency/pending/blocking-failure paths.

## Acceptance Criteria

1. Exact stable facts and operator context are published only from enterprise security.
2. No façade reset executes without ready policy, auth, feature, target scope, strict input, successful mutation guards, sudo, and a normalized 1–1000-character reason.
3. Hiding reset removes submit; invalid configured policy exposes no mutation control.
4. Each accepted request delegates once, runs guard success callbacks once, and preserves the pinned command, audit, event, notification, response, flash, reload, and error contracts; retries are separate requests.
5. The façade rejects optimistic-lock headers and its dependency gate proves the separately landed transaction-boundary prerequisite remains green.
6. Strict route schemas, raw-body limits, metadata, OpenAPI, and the measurable frontend contract pass their named gates.
7. Focused unit/API/browser and named validation gates pass.
8. Implementation and review are performed by Open Mercato core team members.

## Final Compliance Report — 2026-10-27

### AGENTS.md Files Reviewed

- `AGENTS.md`
- `.ai/specs/AGENTS.md`
- `packages/enterprise/AGENTS.md`
- `packages/core/AGENTS.md`
- `packages/shared/AGENTS.md`
- `packages/ui/AGENTS.md`
- `packages/ui/src/backend/AGENTS.md`
- `BACKWARD_COMPATIBILITY.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|---|---|---|---|
| root security rules | Preserve auth, immutable feature checks, tenant/org scope, sudo, audit, and non-enumerating errors | Compliant | Gate order and compound-invalid precedence are exact; policy grants no authority |
| root mutation/event rules | Preserve command side effects without duplicating their owner | Compliant | The façade delegates once to the separately reviewed transaction-boundary prerequisite and does not reimplement its locks/effect order |
| `packages/core/AGENTS.md` → API Routes | Every route exports metadata/OpenAPI and validates exact input | Compliant | Strict params/body/header schemas, raw-body limit, full status matrix, and the stable guard-rejection envelope are specified |
| UI guides | Use shared request/loading/error patterns and retain accessible destructive-action context | Compliant | Immutable bound client, `LoadingMessage`/`ErrorMessage`, visible context, accessible description, and localized flows are specified |
| `.ai/specs/AGENTS.md` | One deployable capability with API/UI integration coverage | Compliant | Only MFA-reset section adoption is in scope; command/service transaction hardening is a prerequisite spec |
| `BACKWARD_COMPATIBILITY.md` | Keep legacy route/command/event ids additive | Compliant | Legacy no-policy path is unchanged; façade and policy facts are additive/versioned |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Data models match API contracts | Pass | No schema change; the façade consumes the prerequisite command without exposing its internal result |
| API contracts match UI/UX section | Pass | Ready policy alone uses façade; pending/invalid expose no reset; no-policy stays legacy |
| Risks cover all write/effect paths | Pass | Façade auth, scope, sudo, guard, one-delegation, response, retry, and prerequisite-failure paths are explicit |
| Commands defined for all mutations | Pass | Exactly one `security.admin.mfa.reset` command is consumed from the prerequisite |
| Cache strategy covers all read APIs | N/A | Status/compliance reloads retain existing behavior |
| Frontend architecture contract is measurable | Pass | Client-boundary, request-count, Strict Mode, LOC, and chunk-diff gates are explicit |

### Non-Compliant Items

None.

### Verdict

- **Fully compliant**: Approved — ready for implementation after the framework, inventory governance, and MFA transaction-boundary prerequisites land.

## Changelog

- **2026-10-27:** Split transaction-held locking/effect ordering into its own prerequisite; retained only section adoption, mandatory mutation guards, strict route/OpenAPI contracts, measurable frontend behavior, and façade-level tests here.
- **2026-10-22:** Split user MFA-reset adoption from sudo-config CRUD and pinned identity, context, façade precedence, command delegation, failure states, and core-team-only ownership.
