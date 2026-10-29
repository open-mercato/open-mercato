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

Add one scoped invitation lifecycle action and expose it beside the pending invitation's existing resend action. Coordinate cancellation with acceptance through an atomic terminal-state transition.

## Architecture

All implementation belongs to `customer_accounts`. Extend the existing DI-resolved `CustomerInvitationService`; reuse the admin invitation route and CRM account-status widget. The mutation runs through the normal command/mutation guard mechanisms and emits `customer_accounts.invitation.cancelled` only for a successful transition. The event contains the invitation ID and tenant/organization scope, never the token or recipient address.

Cancellation uses a conditional update of the row identified by ID, tenant, organization, `acceptedAt: null`, `cancelledAt: null`, and `expiresAt > now`. Acceptance must claim that same pending state atomically inside the transaction which creates the user and roles. Its condition also includes the originally validated token hash, so a resend cannot make the old token acceptable. Exactly one terminal transition can win; rollback releases an unsuccessful acceptance claim. Compute the password hash before taking the transition lock to avoid holding it for bcrypt.

An API response remains neutral when cancellation loses a race. The existing token acceptance error contract remains unchanged. Cancellation itself never creates a user or deletes an invitation.

## Data Model

Reuse `CustomerUserInvitation.cancelledAt`. Add no columns, entities, migration, PII, or encryption maps. Existing email encryption and hashed-token storage remain intact. This is an atomic lifecycle action on an existing entity rather than a new editable CRUD form; pending-state predicates provide concurrency protection without introducing a version column.

## API Contracts

Add `DELETE /api/customer_accounts/admin/users-invite?id=<uuid>`.

- Require staff auth and resolve the validated request organization with `resolveOrganizationScopeForRequest`. Reject a rejected selection or an all-organizations view without a concrete target before any write. Authorize `customer_accounts.invite` through `RbacService`; pass the same effective scope to the command, guards, service, event, and audit log.
- Validate `id` with a Zod schema in `data/validators.ts`; malformed input returns 400, missing auth returns 401, denied features return 403.
- Invoke mutation guards as an `update` of `customer_accounts.customer_user_invitation`, with the caller's effective features. Honor validated modified payloads without allowing the target ID to change, guard failures, and after-success callbacks.
- Return `200 { ok: true }` for every well-formed authorized request, including missing/out-of-scope/terminal invitations. Never return an invitation, token, or cancellation count.
- Document the additive method and its errors in OpenAPI. Repeated calls emit no additional cancellation event.

## UI/UX

On the CRM person account-status widget, place a translated Cancel invitation action beside Resend invitation when a pending invitation is present. Use the shared confirmation dialog, naming the recipient and explaining that the link stops working. Escape dismisses; Ctrl/Cmd+Enter confirms. Disable actions while cancellation runs. Use `apiCall` inside `useGuardedMutation`; on success refresh the pending/account queries and show a translated flash. Errors keep the invitation visible and allow retry. Reuse semantic button and status variants.

### Frontend Architecture Contract

The existing widget remains the sole client boundary; no new page, provider, bootstrap, dependency, or large bundle is added. Reuse the shared confirmation helper. The cancellation action performs one request and refreshes the existing React Query entries. UI tests cover confirmation dismissal, successful mutation, failure/retry, and transition to the no-account state. No additional navigation or parallel data waterfall is introduced.

Preserve structured API errors through `raiseCrudError` so registered mutation guards and the unified record-conflict UI receive 409 status and payload details. A post-commit lifecycle event failure is logged and reported, while cancellation success and its audit log remain intact; a telemetry failure must not turn the committed cancellation into a failed request.

## Integration Coverage

Ship self-contained tests under the module's `__integration__` directory. Create invitations through the existing API and capture their tokens with the existing email-capture test seam; clean all fixtures in `finally`.

| Path | Required coverage |
| --- | --- |
| Admin invitation DELETE | pending cancellation, duplicate call, missing ID, malformed ID, missing auth, feature denial |
| Admin invitation GET | cancelled invitation disappears; token fields remain absent |
| Invitation accept POST | cancelled token fails and creates no account; acceptance preserves its existing success contract |
| Scope boundaries | another organization and another tenant receive neutral responses and cannot alter or inspect the invitation |
| CRM person widget | confirm/dismiss, successful removal, failed cancellation, accessible keyboard behavior |
| Concurrent service transitions | cancellation/acceptance compete for one terminal transition; failed acceptance rolls back its claim |

## Migration & Backward Compatibility

API method, service operation, validator, and event are additive under `BACKWARD_COMPATIBILITY.md`. Preserve GET/POST invitation creation/list/resend, token TTL, token acceptance response shape, all existing ACL features, and invitation history. No database migration or external-module pointer change is required. Rolling back the feature removes the action while existing cancelled tokens remain invalid.

## Edge Cases & Failure Scenarios

| Severity | Scenario | Mitigation and residual risk |
| --- | --- | --- |
| High | Acceptance races cancellation | Conditional transitions coordinate on the same row; acceptance user/role writes and claim commit together. Whichever commits first wins. |
| High | Cross-tenant or cross-organization ID | Explicit non-null scope and matching query predicates; neutral output; integration tests prove the original token stays valid. |
| Medium | Acceptance fails after its claim | Transaction rolls back state and user/role inserts. Existing email-conflict mapping is preserved. |
| Medium | Duplicate cancellation | Conditional update changes zero rows; no repeated event and no state disclosure. |
| Medium | Network or mutation guard failure | Keep UI state, display translated error, allow retry. |
| Low | Stale pending card | Refresh existing account and invitation queries after the neutral response. An already accepted invitation is never revoked. |

## Research

[GitLab membership management](https://docs.gitlab.com/user/project/members/) separates pending email invitations from established memberships and restricts membership administration by role. Reuse that distinction here: withdrawing an invitation must not revoke an accepted user's account. No external dependency or configuration is needed.

## Final Compliance Report

The design stays within one module, scopes all writes to tenant and organization, stores no new sensitive data, adds contracts without removing existing ones, reuses UI/API/guard primitives, and includes integration coverage for every affected API and the key UI path. Cancellation preserves audit rows and never restores a withdrawn credential.

## Changelog

- 2026-10-29: Specified staff cancellation for issue #7275, neutral terminal responses, coordinated acceptance, and verification requirements.

## Implementation Plan

### Phase 1: Lifecycle and API

1. Add scoped idempotent cancellation and service tests, coordinating cancellation with acceptance.
2. Add a guarded staff API action, lifecycle event, OpenAPI documentation, and authorization tests.

### Phase 2: Staff workflow and verification

1. Add a translated confirmation and cancel action to the existing pending-invitation widget, with UI tests.
2. Add self-contained integration coverage for token invalidation, repeat cancellation, authorization, and tenant/organization isolation.
3. Run the configured validation gate, review the change, and verify the changed UI when a test environment is available.
