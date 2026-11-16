# Portal users can change their email address

> **Program:** an addition to package C7 of [`2026-11-15-gdpr-ready-deployments-program.md`](2026-11-15-gdpr-ready-deployments-program.md) (tracker open-mercato/open-mercato#8593), left out of [`2026-11-16-portal-privacy-self-service.md`](2026-11-16-portal-privacy-self-service.md) because it needs a verified flow of its own.
> **Uses** a re-authentication helper (`customer_accounts/lib/reauth.ts`). The self-service spec specifies it, but that spec's later phases are not approved; this spec adds the helper itself if it is not there yet.
> **Verified at** `main` @ `08dada9624` by reading code; nothing was run.
> **Written autonomously.** No question was put to a person; the choices are listed under Resolved assumptions.

Extends: .ai/specs/2026-11-16-portal-privacy-self-service.md
Extends: .ai/specs/2026-08-14-storefront-customer-account.md

## 📝 TLDR

A customer-portal user's email address is their sign-in name, and nobody can change it. The user's own profile route accepts only a display name. The staff route for portal users has no email field either. A person whose address changed — or who asks for it to be corrected, which is their right — has to be given a new account. **Proposed (future):** a signed-in portal user can ask to change their address. A link is sent to the new address and a notice to the old one; the change takes effect only when the link is used, and then every session is ended. Staff can start the same flow for a user; they cannot set an address directly.

**Not in this spec:** changing a staff user's address, which already works and takes effect at once; changing the address the tenant holds on the CRM person, which is the tenant's record; merging two portal accounts.

## 📝 Overview

> **Market reference.** GitLab, GitHub and Discourse all treat a new address as unconfirmed until a link sent to it is used, keep signing in with the old one until then, and tell the old address that a change was requested. Adopted: all three. Rejected: an immediate change, which is what the staff profile does here — for a sign-in name it lets a hijacked session take the account away from its owner.

## 📝 Resolved assumptions (autonomous defaults)

| # | Question | Chosen | Rationale |
|---|---|---|---|
| 1 | When the change takes effect | When the link sent to the new address is used | The new address must be proved before it becomes a sign-in name. |
| 2 | What happens to sessions | All are ended on confirmation | The token carries the old address, and anyone holding a stolen session should not keep it across an identity change. |
| 3 | If the new address already belongs to an account in the tenant | Everything the requester can observe is the same: a pending change is stored, the notice goes to their old address, the status and cancel routes behave alike. Only the link is never sent. The existing account's owner is told someone tried to use their address | The requester owns the session and the old mailbox, so they can see far more than the response. Uniqueness is per tenant, so without this a signed-in user could test addresses across organizations. |
| 4 | Staff | May start the flow; may not set the address | The link is what proves the address. A staff-set address would be unverified and would skip the old address's notice. |
| 5 | The linked CRM person | Unchanged | The person's primary email is the tenant's own record and is not copied from the portal account today. |
| 6 | How long the link lives | 24 hours, one pending change per user | The same as email verification; a second request replaces the first. |
| 8 | Cancelling without a session | The notice to the old address carries a signed cancel link | Someone who re-authenticated with a stolen password can change the password first; the real owner then has no session to cancel from. |
| 9 | Links already sent to the old address | Every unused magic link, verification and password-reset token of the user is consumed when the change is confirmed | They are keyed by the user, not the address. Whoever holds the old mailbox could otherwise still sign in or reset the password. |
| 7 | Edition | OSS | A defect in an OSS module's account handling. |

## 📝 Problem Statement

- **The address is the identity** for sign-in, magic links, password reset and invitation acceptance (`customer_accounts/api/login.ts:84`; `api/magic-link/request.ts:65`; `api/password/reset-request.ts:66`).
- **It is stored encrypted with a lookup hash**, unique per tenant among users not deleted (`customer_accounts/data/entities.ts:16-20, 31-36`; `encryption.ts:5-9`). Uniqueness is per tenant, not per organization.
- **Nobody can change it.** The portal profile schema has only a display name (`data/validators.ts:52-54`); the staff update schema has no email (`:108-115`).
- **The verification table cannot hold a target address.** It has a user, a token hash, a free-text purpose, an expiry and a used time (`entities.ts:230-253`).
- **No "pending address" exists anywhere** in the codebase.
- **Sessions.** A token lasts eight hours and carries the address; refresh re-signs it from the database. `revokeAllUserSessions` ends every session and invalidates older tokens (`services/customerSessionService.ts:67, 90-103, 195-208`).
- **The CRM link is made once**, when the user is created, and is skipped when a link already exists (`subscribers/autoLinkCrm.ts:81-92`).
- **Copies of the address**: invitation rows, the token's claim, some event payloads, a staff notification at signup. The search index holds only its hash and is rebuilt on `user.updated`.
- **The existing verify route has no rate limit** (`api/email/verify.ts:1-43`), and the staff update writes with a raw update and no audit entry (`api/admin/users/[id].ts:191-210`). A raw update also bypasses encryption; the address must be written through the entity.
- **Lookups by hash try several forms** — keyed and legacy (`packages/shared/src/lib/encryption/aes.ts:216-238`) — while the unique index compares stored strings, so an account stored under the legacy form and a change under the new one would not collide in the index.
- **Tokens in flight are keyed by the user.** Magic links live 15 minutes and password resets 60 (`services/customerTokenService.ts:16-17`); ending sessions does not touch them.
- **The module's token clean-up worker is never enqueued**; the pruner spec schedules it.
- **The only rate limiter fails open and counts per minute by address** (`auth/lib/rateLimitCheck.ts:26-60`).
- **The search index is rebuilt on `customer_accounts.user.updated`**, and the reverse CRM link runs only when a person is created (`subscribers/autoLinkCrmReverse.ts:12`).

## 📝 Proposed Solution

| Step | What happens |
|---|---|
| Request | The signed-in user gives a new address and re-authenticates. A pending change is stored, replacing any earlier one |
| Messages | A link goes to the new address. A notice goes to the old one, saying a change was requested, with a link that cancels it without signing in |
| Until confirmed | Nothing changes. The user signs in with the old address and can cancel from the profile page or from the notice |
| Confirm | The link is used. In one transaction, under a lock for the tenant and address: the address is checked against every hash form; the address and its hash are replaced through the entity; the address is marked verified; the pending change is consumed; every session is ended; every unused magic link, verification and reset token of the user is consumed. A confirmation goes to the old address, and staff who manage portal users are notified, so that they can correct the company's own record of the person |
| Staff | From the user's admin page, staff enter a new address; the same messages are sent and the same link confirms it. Staff can also cancel |

**When the new address is taken.** The request behaves identically in everything the requester can see: a pending change is stored, the old address gets the notice, the status shows it pending, cancelling works. The link is not sent — the pending change can never be confirmed and expires — and the owner of the existing account receives a notice, with its own wording, that someone tried to use their address.

**Limits.** At most three requests per user per hour, counted from the pending-change rows themselves, which are kept until the clean-up removes them. Staff-started changes are limited per staff user and per target, as invitations are. The confirm route uses the existing limiter; its protection is the token's 256 bits.

### Design decisions

| Decision | Rationale |
|---|---|
| A table for pending changes | The verification table has no place for the target address, and widening it would change a table three other flows share. |
| The new address is stored encrypted, with no hash of its own | Nothing looks a pending change up by address; the check at confirmation computes every hash form from the decrypted address. |
| Uniqueness is checked twice, at request and at confirmation, under a lock | Someone else may take the address in between, and the unique index alone does not see an account stored under an older hash form. |
| Request, cancel and the confirmed change are commands that cannot be undone, with audit entries that name no address | The staff route's lack of any audit entry is a defect not to be copied; an undo would restore an old sign-in name. |
| The confirmed change emits `user.updated` as well as its own event | The search index listens to the first. |
| The confirm route is public and rate-limited | The person using the link may not be signed in on that device. |

### Alternatives considered

| Alternative | Why rejected |
|---|---|
| Change immediately, as the staff profile does | See the market reference. |
| Let staff set the address | See assumption 4. |
| Reuse the verification table with a new purpose | No column for the target address. |
| Update the CRM person's email as well | See assumption 5. |

## 📝 Delta

### Capability: portal-email-change

#### ADDED Requirement: Change own email address
The system SHALL let a signed-in portal user replace their email address after re-authentication, and SHALL apply the change only when a link sent to the new address is used.

##### Scenario: Request
- WHEN a user requests a change
- THEN a link is sent to the new address, a notice to the old one, and signing in still uses the old address

##### Scenario: Confirm
- WHEN the link is used within its lifetime
- THEN signing in works with the new address and not the old, and every earlier session is ended

##### Scenario: Cancel
- WHEN the user cancels before confirming
- THEN the link no longer works

##### Scenario: Address already in use
- WHEN the new address belongs to another account in the tenant
- THEN the response, the notice to the old address, the pending status and cancelling are the same as for a free address, and no link is sent

##### Scenario: Old links
- WHEN a magic link or a password-reset link was sent to the old address before the change was confirmed
- THEN it no longer works afterwards

##### Scenario: Cancel from the notice
- WHEN the owner uses the cancel link in the notice without signing in
- THEN the pending change is cancelled

##### Scenario: Taken in the meantime
- WHEN another account takes the address after the request and before the link is used
- THEN confirming fails and the user's address is unchanged

##### Scenario: Wrong password
- WHEN re-authentication fails
- THEN no change is stored and no message is sent

#### ADDED Requirement: Staff-started change
The system SHALL let authorized staff start an address change for a portal user, which takes effect only when the link sent to the new address is used.

##### Scenario: Staff start
- WHEN staff enter a new address for a user
- THEN the user's address is unchanged until the link is used

## 📝 Architecture

- **`customer_accounts`**: the pending-change entity; a service for request, cancel and confirm; a command for the confirmed change; three portal routes, one public route, one staff route; two email templates and reuse of the existing-account notice; an event; rate-limit entries.
- **`portal`**: a section on the profile page — the form, the pending state, cancel — and a public confirmation page.
- **Staff page for portal users**: a field that starts the flow, and the pending state.

### Frontend architecture contract

| File | Why it is a client file | Imported by | Heavy deps |
|---|---|---|---|
| `EmailChangeForm.tsx` | Field state, re-authentication, guarded mutation | The portal profile page | None |
| The confirmation page | Reads the token from the address and posts it | Its route | None |

No new page-root client file beyond the portal's convention; no provider is touched. Writes use `useGuardedMutation`. Strings are locale keys in the five portal locales.

## 📝 Data Models

| Table | Columns |
|---|---|
| `customer_user_email_changes` | `tenant_id`, `user_id`, `new_email` (encrypted), `token_hash`, `cancel_token_hash`, `requested_by` (`self` \| `staff`), `requested_by_user_id?`, `expires_at`, `used_at?`, `cancelled_at?`, `created_at`. One live row per user, by a partial unique index |

Additive, with a migration, a snapshot and an encryption-map entry. Rows that are used, cancelled or expired are removed after a day by the module's token clean-up worker, once the pruner spec schedules it; until then, a new request also removes that user's finished rows older than a day. The table is added to the account's data class, so that an erasure removes a user's rows, and to the table-coverage declarations.

## 📝 API Contracts

| Route | Auth | Notes |
|---|---|---|
| `POST /api/customer_accounts/portal/profile/email-change` | Portal user | `{ newEmail, password? }`. Always 200 for a well-formed address once re-authentication passes. 403 on failed re-authentication; 429 |
| `GET …/portal/profile/email-change` | Portal user | Whether a change is pending and when it expires. Not the new address |
| `DELETE …/portal/profile/email-change` | Portal user | Cancels |
| `POST /api/customer_accounts/email/change-confirm` | None | `{ token }`. 200; 400 for an unknown, used or expired token; 409 if the address has been taken. Rate-limited by address and token |
| `POST /api/customer_accounts/email/change-cancel` | None | `{ token }` from the notice. 200 for a valid token |
| `POST /api/customer_accounts/admin/users/:id/email-change` | The portal-user management feature | `{ newEmail }`. Starts the flow. One response whether or not the address is free |
| `DELETE /api/customer_accounts/admin/users/:id/email-change` | The same | Cancels |

- **Events** `customer_accounts.user.email_changed`, with ids only, and `customer_accounts.user.updated`.
- **Notification** to staff who manage portal users, on a confirmed change.
- **Emails**, each with its own wording: "confirm your new address", to the new address; "a change was requested" with the cancel link, and "your address was changed", to the old one; "someone tried to use your address", to an existing account's owner.

## 📝 Edge Cases & Failure Scenarios

| Case | Behaviour |
|---|---|
| An account with no password | Re-authentication requires a recent sign-in, as in the self-service spec |
| The same address as the current one | Refused as invalid |
| The link is used twice | The second use fails as used |
| The user is deactivated or deleted before confirming | Confirmation fails |
| A deletion request is pending for the account | The change can still be made; the deletion stands |
| Email delivery to the new address fails | The change stays pending until it expires; the profile page shows it and offers to cancel |
| A staff user starts a change and the user then starts another | The later one replaces the earlier |
| The lookup secret changes while a change is pending | Confirmation computes hashes from the decrypted address at that moment, so it is unaffected |
| A password was changed by whoever started the change | The owner cancels from the notice and recovers through the password reset sent to the unchanged address |
| The CRM person linked to the account | Its email is unchanged and the link is not re-evaluated; staff are notified and decide |

## 📝 Migration & Backward Compatibility

All additive: one table, five routes, one event, three templates, one page. Sign-in, signup and the existing verification flow are untouched.

## 📋 Implementation Plan

1. The re-authentication helper, if the self-service spec has not shipped it, with that spec's unit tests.
2. The entity, migration, encryption-map entry, the lazy removal of finished rows, and the table's place in the account's data class.
3. The service: request with identical behaviour for a taken address, cancel by session and by token, confirm in one transaction under a lock — every hash form checked, the address written through the entity, sessions ended, in-flight tokens consumed. Unit tests: each scenario above; a race at confirmation; an account stored under the legacy hash form.
4. Commands for request, cancel and the confirmed change, none undoable, with audit entries that name no address; the two events; the staff notification.
5. The portal routes with re-authentication, validation, OpenAPI entries and the per-hour limit; the public confirm and cancel routes. Unit tests for each error.
6. The profile section and the confirmation page.
7. The staff routes with their limits, and the field on the staff page.
8. Integration tests TC-PORTAL-EMAIL-001 and 002; the portal docs page.
9. Archive this Delta into `.ai/specs/capabilities/portal-email-change.md` if that directory has been adopted by then.

| File | Action |
|---|---|
| `packages/core/src/modules/customer_accounts/{data/entities.ts,encryption.ts,migrations/*,services/customerEmailChangeService.ts,commands/*,api/portal/profile/email-change.ts,api/email/change-confirm.ts,api/admin/users/[id]/email-change.ts,emails/*,events.ts,lib/rateLimiter.ts,workers/cleanupExpiredTokens.ts,i18n/*}` | Create / modify |
| `packages/core/src/modules/portal/frontend/[orgSlug]/portal/{profile/*,verify-email-change/*}`, `i18n/*` | Create / modify |
| The staff portal-user detail page | Modify |
| `packages/core/src/modules/customer_accounts/__integration__/TC-PORTAL-EMAIL-00{1,2}.spec.ts` | Create |

## 🧪 Integration Coverage

Fixtures from `customerAccountsFixtures.ts`; emails are read from the test capture; everything created is removed.

| Test | Covers |
|---|---|
| TC-PORTAL-EMAIL-001 | Request with the right password; the old address still signs in; the link from the captured email confirms; the new address signs in, the old does not, and the earlier session is refused. A wrong password stores nothing. Cancel invalidates the link. The profile section shows and clears the pending state |
| TC-PORTAL-EMAIL-002 | A request for an address that belongs to a second user: the response, the status route, the notice captured for the old address and the cancel route all match those of a request for a free address; no link is captured; the second user's captured mail has the notice. A magic link requested before a confirmed change no longer signs in. The cancel link from the notice cancels without a session. Staff start a change for a user; nothing changes until the link is used |

## 📝 Risks & Impact Review

#### A hijacked session takes the account
- **Scenario**: Someone with a stolen cookie changes the address to their own.
- **Severity**: High
- **Affected area**: portal accounts
- **Mitigation**: Re-authentication; the notice to the old address with a cancel link that needs no session; nothing changes until the link is used.
- **Residual risk**: A passwordless account with a sign-in less than fifteen minutes old, whose owner does not read the notice within a day.

#### The request reveals who has an account
- **Scenario**: A signed-in user tries addresses to see which exist.
- **Severity**: Medium
- **Affected area**: other users of the tenant
- **Mitigation**: Every observable outcome is the same for a free and a taken address; three requests an hour.
- **Residual risk**: Timing: one path sends one more email. The step sends mail after the response is returned.

#### The user is locked out
- **Scenario**: The address is confirmed, sessions end, and the user mistyped nothing but cannot receive mail at the new address later.
- **Severity**: Low
- **Affected area**: that user
- **Mitigation**: The link proves the address works at the moment of change; staff can start another change.
- **Residual risk**: Accepted.

## Final Compliance Report — 2026-11-16

- **Reviewed:** root `AGENTS.md`, `.ai/specs/AGENTS.md`, `packages/ui/AGENTS.md` → Portal Extension (through earlier research). Not reviewed: the `customer_accounts` guide in full.

| Rule | Status | Notes |
|---|---|---|
| Sensitive columns in an encryption map; lookups by hash | Compliant | The new address and its hash |
| Minimal error messages for auth | Compliant | One response whether or not the address exists |
| Validate inputs with zod | Compliant | — |
| Non-form writes through `useGuardedMutation` | Compliant | — |
| Optimistic locking on new editable entities | N/A | The pending change is not edited, only created, cancelled or consumed |
| Tenant scoping | Compliant | Uniqueness and every query are per tenant |
| Integration coverage | Compliant | Two tests |

**Verdict:** approved for implementation.

## Changelog

### 2026-11-16
- Written autonomously with resolved assumptions.
- Revised after independent review. A taken address is now indistinguishable in everything the requester can observe, not only in the response. Confirmation consumes magic links and reset tokens already sent to the old address. The notice carries a cancel link that needs no session. Uniqueness is checked against every hash form under a lock, and the pending row loses its unused hash column. The address is written through the entity, and `user.updated` is emitted so that search is rebuilt. Staff requests and cancels are audited commands with their own limits. Finished rows are removed lazily until the clean-up worker is scheduled, and the table joins the account's data class. The re-authentication helper is added here if it does not exist. Staff are told of a confirmed change, because the CRM's copy of the address is not updated.
