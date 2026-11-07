# Staff cancellation of pending portal invitations

## TLDR

Staff with `customer_accounts.invite` can withdraw a pending customer portal invitation from the existing CRM person account widget. Cancellation preserves the invitation row, invalidates its token, and remains safe when repeated or raced against acceptance.

## Problem Statement

Issue #7275 identifies an operator workflow gap: the admin API can create, resend, and list invitations, but cannot withdraw one before its 72-hour expiry. `CustomerUserInvitation.cancelledAt` and token rejection already exist. The implemented identity specification describes cancellation as the inverse of invitation creation but supplies no admin action.

## Resolved assumptions (autonomous defaults)

| Question | Decision | Rationale |
| --- | --- | --- |
| Terminal and unknown IDs | Return `200 { ok: true }` without changing accepted, expired, cancelled, missing, or out-of-scope rows. | Idempotent and neutral; no existence or state disclosure. |
| Staff authorization | Reuse `customer_accounts.invite`. | The same staff who can issue invitations can withdraw them; no new ACL or portal permissions. |
| Undo | Staff may issue a fresh invitation. Never revive a cancelled token. | Reviving a withdrawn credential would defeat cancellation. |
| Cohesion | One capability: staff withdrawal of a pending portal invitation. | The acceptance coordination is necessary to enforce withdrawal, rather than a separate feature. |

## Proposed Solution

Add one scoped invitation lifecycle action and expose it beside the pending invitation's existing resend action. Coordinate cancellation with acceptance through an atomic terminal-state transition, and prevent resend from rotating a token on a concurrently cancelled row.

## Architecture

All implementation belongs to `customer_accounts`. Extend the existing DI-resolved `CustomerInvitationService`; reuse the admin invitation route and CRM account-status widget. Existing GET/POST invitation routes use the authenticated staff scope, `{ tenantId: auth.tenantId, organizationId: auth.orgId }`. DELETE must use that same scope throughout authorization, guards, command execution, service writes, audit attribution, and events. A selected-organization cookie must not retarget this action or turn cancellation of a listed invitation into a no-op. Changing GET/POST to selected-organization semantics is outside this feature.

The route runs mutation guards before invoking `customer_accounts.invitation.cancel` through the existing command bus. The cancellation handler in implementation PR #8212 (`commands/invitations.ts`) must accept only `{ id: string }` and derive and authorize scope from trusted staff authentication rather than accepting scope from the payload. It is non-undoable (`isUndoable: false`) and its `buildLog` returns `replayable: false`, the invitation resource ID, authenticated tenant/organization scope, and a translated action label. The existing command framework supplies actor attribution and persists the action log. A neutral no-op returns `skipLog: true`; neither an undo token nor a recipient/token snapshot is recorded.

Declare `customer_accounts.invitation.cancelled` in `events.ts` with label `Customer Invitation Cancelled`, category `lifecycle`, and `clientBroadcast: true`, matching the accepted-event metadata. Emit it only after a successful transition. Its payload contains `invitationId`, `tenantId`, and `organizationId`; actor attribution belongs to the command audit log. Never include the token or recipient address.

Cancellation uses a conditional update of the row identified by ID, tenant, organization, `acceptedAt: null`, `cancelledAt: null`, and `expiresAt > now`. Acceptance must claim that same pending state atomically inside the transaction which creates the user and roles. Its condition also includes the originally validated token hash, so a resend cannot make the old token acceptable. Exactly one terminal transition can win; rollback releases an unsuccessful acceptance claim. Compute the password hash before taking the transition lock to avoid holding it for bcrypt.

The resend dedupe path must atomically update an existing invitation only while its tenant/organization scope matches and it remains pending (`acceptedAt: null`, `cancelledAt: null`, `expiresAt > now`). Put the scoped pending lookup and managed-entity mutation/flush in one transaction. Use `findOneWithDecryption` with `lockMode: LockMode.PESSIMISTIC_WRITE` and `refresh: true`; the database acquires the row lock and rechecks the pending predicate before any token or metadata is changed. Hold that lock through token rotation and the encrypted metadata flush. An unlocked read followed by an unconditional flush is insufficient. If cancellation wins before the locked lookup, no pending row is returned and the existing fresh-invitation path runs, preserving existing eligibility checks. Never clear `cancelledAt` or send a new link for the cancelled row.

An API response remains neutral when cancellation loses a race. The existing token acceptance error contract remains unchanged. Cancellation itself never creates a user or deletes an invitation.

## Data Model

Reuse `CustomerUserInvitation.cancelledAt`. Add no columns, entities, migration, PII, or encryption maps. Existing email encryption and hashed-token storage remain intact. This is an atomic lifecycle action on an existing entity rather than a new editable CRUD form; pending-state predicates provide concurrency protection without introducing a version column.

## API Contracts

Add `DELETE /api/customer_accounts/admin/users-invite?id=<uuid>`.

- Require staff auth with concrete `auth.tenantId` and `auth.orgId`, matching the existing GET/POST route contract. Authorize `customer_accounts.invite` through `RbacService` in that authenticated scope. Pass it consistently to guards, the command, service, event, and audit log; do not resolve a different write target from the selected-organization cookie.
- Validate `id` with a Zod schema in `data/validators.ts`; malformed input returns 400, missing auth returns 401, denied features return 403.
- Invoke mutation guards as an `update` of `customer_accounts:customer_user_invitation`, with the caller's effective features. Use the same canonical entity key in the command resource metadata. Honor validated modified payloads without allowing the target ID to change, guard failures, and after-success callbacks.
- Return `200 { ok: true }` for every well-formed authorized request, including missing/out-of-scope/terminal invitations. Never return an invitation, token, or cancellation count.
- Document the additive method and its errors in OpenAPI. Repeated calls emit no additional cancellation event.

## UI/UX

On the CRM person account-status widget, place a translated Cancel invitation action beside Resend invitation when a pending invitation is present and the staff member has `customer_accounts.invite` in the authenticated scope. Use the shared feature matcher so wildcard grants work. Staff with only `customer_accounts.view` can still see the widget and pending invitation but must not see Cancel; the server independently enforces the invite feature and returns 403 if called directly. Use the shared confirmation dialog, naming the recipient and explaining that the link stops working. Escape dismisses; Ctrl/Cmd+Enter confirms. Disable actions while cancellation runs. Use `apiCall` inside `useGuardedMutation`; on success refresh the pending/account queries and show a translated flash. Errors keep the invitation visible and allow retry. Reuse semantic button and status variants.

### Frontend Architecture Contract

The existing widget remains the sole client boundary; no new page, provider, bootstrap, dependency, or large bundle is added. Reuse the shared confirmation helper. The cancellation action performs one request and refreshes the existing React Query entries. UI tests cover confirmation dismissal, successful mutation, failure/retry, and transition to the no-account state. No additional navigation or parallel data waterfall is introduced.

Preserve structured API errors through `raiseCrudError` so registered mutation guards and the unified record-conflict UI receive 409 status and payload details. A post-commit lifecycle event failure is logged and reported without failing the committed cancellation or skipping the command's normal `buildLog` path; a telemetry failure must not turn the committed cancellation into a failed request. Audit persistence follows the existing command-bus behavior. No new outbox, event-delivery guarantee, or undo architecture is introduced.

## Integration Coverage

Ship self-contained tests under the module's `__integration__` directory. Create invitations through the existing API and capture their tokens with the existing email-capture test seam; clean all fixtures in `finally`.

| Path | Required coverage |
| --- | --- |
| Admin invitation DELETE | pending cancellation, duplicate call, missing ID, malformed ID, missing auth, feature denial |
| Admin invitation GET | cancelled invitation disappears; token fields remain absent |
| Invitation accept POST | cancelled token fails and creates no account; acceptance preserves its existing success contract |
| Scope boundaries | another organization and another tenant receive neutral responses and cannot alter or inspect the invitation |
| Selected organization differs from staff home organization | with `auth.orgId = A` and the selected-organization cookie set to B, POST creates and GET lists the invitation in A; DELETE cancels that same invitation in A and the next GET omits it; guard, command, audit, and event scope remain A, while invitations in B are untouched |
| CRM person widget | confirm/dismiss, successful removal, failed cancellation, accessible keyboard behavior; view-only staff see the pending card without Cancel, invite-authorized staff see Cancel, and wildcard grants work |
| Concurrent service transitions | cancellation/acceptance compete for one terminal transition; failed acceptance rolls back its claim |
| Resend/cancel service race | cancellation wins before the locked lookup: the old row retains its token hash and cancellation marker, while resend creates a fresh pending invitation with a usable token; resend obtains the lock first: cancellation waits for its transaction to commit, then revokes the rotated token; prove lookup and flush share the transaction and lock |
| Command audit and lifecycle event | one successful cancellation produces the non-replayable action log and one scoped lifecycle event; repeats produce neither; logs/events contain no token or email; event/telemetry failure does not fail the committed action |

## Migration & Backward Compatibility

API method, command, service operation, validator, and event are additive under `BACKWARD_COMPATIBILITY.md`. Preserve GET/POST invitation creation/list/resend, including their `auth.orgId` organization scope, token TTL, token acceptance response shape, all existing ACL features, and invitation history. The resend concurrency guard prevents writes to terminal rows without changing the public POST request/response contract. No database migration or external-module pointer change is required. Rolling back the feature removes the action while existing cancelled tokens remain invalid.

## Edge Cases & Failure Scenarios

| Severity | Scenario | Mitigation and residual risk |
| --- | --- | --- |
| High | Acceptance races cancellation | Conditional transitions coordinate on the same row; acceptance user/role writes and claim commit together. Whichever commits first wins. |
| High | Resend competes with cancellation | Refreshed pending lookup and encrypted managed flush share a transaction and row lock; cancellation either wins before lookup, causing a fresh invitation, or waits until resend commits and then cancels the rotated token. |
| High | Cross-tenant or cross-organization ID | Explicit non-null scope and matching query predicates; neutral output; integration tests prove the original token stays valid. |
| Medium | Selected organization differs from authenticated home organization | Keep GET/POST/DELETE and every cancellation side effect in `auth.orgId`; prove the listed invitation is actually removed in an organization-switch test. |
| Medium | Acceptance fails after its claim | Transaction rolls back state and user/role inserts. Existing email-conflict mapping is preserved. |
| Medium | Duplicate cancellation | Conditional update changes zero rows; no repeated event and no state disclosure. |
| Medium | Network or mutation guard failure | Keep UI state, display translated error, allow retry. |
| Low | Stale pending card | Refresh existing account and invitation queries after the neutral response. An already accepted invitation is never revoked. |

## Research

[GitLab membership management](https://docs.gitlab.com/user/project/members/) separates pending email invitations from established memberships and restricts membership administration by role. Reuse that distinction here: withdrawing an invitation must not revoke an accepted user's account. No external dependency or configuration is needed.

## Final Compliance Report

The design stays within one module, scopes all writes to tenant and organization, stores no new sensitive data, adds contracts without removing existing ones, reuses UI/API/guard primitives, and includes integration coverage for every affected API and the key UI path. Cancellation preserves the invitation history, records successful transitions through the existing command audit framework, and never restores a withdrawn credential.

## Changelog

- 2026-10-29: Clarified authenticated organization scope, resend/cancel atomicity, the implemented non-undoable command and audit path, canonical guard entity key, invite-feature visibility, lifecycle-event metadata, and regression coverage after review.
- 2026-10-29: Specified staff cancellation for issue #7275, neutral terminal responses, coordinated acceptance, and verification requirements.

## Implementation Plan

### Phase 1: Lifecycle and API

1. Add scoped idempotent cancellation and service tests, coordinating cancellation with acceptance and making resend dedupe conditional on pending state. Include the deterministic resend/cancel race test.
2. Add the guarded staff API action and non-undoable cancellation command, its scoped action log, lifecycle-event declaration, OpenAPI documentation, and authorization tests. Preserve the existing GET/POST authenticated scope.

### Phase 2: Staff workflow and verification

1. Add a translated confirmation and invite-feature-gated cancel action to the existing pending-invitation widget, with UI tests including view-only staff.
2. Add self-contained integration coverage for token invalidation, repeat cancellation, authorization, tenant/organization isolation, and selected-organization/home-organization mismatch.
3. Run the configured validation gate, review the change, and verify the changed UI when a test environment is available.
