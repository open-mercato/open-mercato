# Portal users can change their email address

> **Program:** an addition to package C7 of [`2026-11-15-gdpr-ready-deployments-program.md`](2026-11-15-gdpr-ready-deployments-program.md) (tracker open-mercato/open-mercato#8593), left out of [`2026-11-16-portal-privacy-self-service.md`](2026-11-16-portal-privacy-self-service.md) because it needs a verified flow of its own.
> **Uses** a re-authentication helper (`customer_accounts/lib/reauth.ts`). The self-service spec specifies its atomic counter rules; this spec ships the helper, its two columns, migration, snapshot and password-change integration itself if they are not there yet.
> **Source verification:** read-only repository @ `9e09023483`; code was read, no app or implementation test was run. The original design used `08dada9624`.
> **Written autonomously.** No question was put to a person; the choices are listed under Resolved assumptions.

Extends: .ai/specs/2026-11-16-portal-privacy-self-service.md
Extends: .ai/specs/2026-08-14-storefront-customer-account.md

## 📝 TLDR

A customer-portal user's email address is their sign-in name, and nobody can change it. The user's own profile route accepts only a display name. The staff route for portal users has no email field either. A person whose address changed — or who asks for it to be corrected, which is their right — has to be given a new account. **Proposed (future):** a signed-in portal user can ask to change their address. A link is sent to the new address and a notice to the old one; the change takes effect only when the link is used, and then every session is ended. Staff can start the same flow for a user; they cannot set an address directly. After a confirmed takeover, staff can start a verified recovery which the current mailbox cannot cancel. Edition placement follows the marked C7 default in assumption 7 and the program's DEC-2b, which now explicitly includes email change as a pending ruling; implementation approval still needs that explicit edition decision and the DEC-13 compatibility rollout below.

**Not in this spec:** changing a staff user's address, which already works and takes effect at once; changing the address the tenant holds on the CRM person, which is the tenant's record; merging two portal accounts.

## 📝 Overview

> **Market reference.** GitLab, GitHub and Discourse all treat a new address as unconfirmed until a link sent to it is used, keep signing in with the old one until then, and tell the old address that a change was requested. Adopted: all three. Rejected: an immediate change, which is what the staff profile does here — for a sign-in name it lets a hijacked session take the account away from its owner.

## 📝 Resolved assumptions (autonomous defaults)

| # | Question | Chosen | Rationale |
|---|---|---|---|
| 1 | When the change takes effect | When the link sent to the new address is used | The new address must be proved before it becomes a sign-in name. |
| 2 | What happens to sessions | All are ended on confirmation; a first-party in-flight sign-in is fenced too | Session creation rechecks the credential's account version under the same per-user lock as confirmation. |
| 3 | If the new address already belongs to an account in the tenant | Identical requester-visible response, stored pending state, old-address notice, status and cancellation. Only the confirmation link is withheld; the existing owner gets a notice | Uniqueness is per tenant, across organizations. |
| 4 | Staff | May start a normal or verified recovery flow, never set an address directly | A recovery still requires proof through a link to the recovered address. |
| 5 | Linked CRM person | Keep its email and existing account link; automatic linking must not attach a second active account to that person | The CRM record belongs to the tenant; released addresses must not confer its company access. |
| 6 | Link lifetime | 24 hours, one live pending change per user | A later normal request replaces the earlier one; an active recovery can be replaced only by authorized staff. |
| 7 | Edition | ⚠ NEEDS HUMAN CONFIRMATION. Default: OSS if C7's rights phases are approved there, and Enterprise with them if refused; maintainers must explicitly rule on email change | The program's DEC-2b now records this same pending default and requires an explicit email-change edition ruling; it grants no approval or independent OSS exception. Fallback: leave email-change delivery unshipped until maintainers choose its edition explicitly. |
| 8 | Cancel without a session | The old-address notice carries a one-use cancel link for normal changes | It stops an unconfirmed takeover even after the attacker changes the password. Recovery notices carry staff contact instead of a working cancel link. |
| 9 | Old-address credentials | Consume every unused verification, magic-link and reset token and cancel pending invitations matching every old-address hash form at confirmation | The old mailbox must not gain a new account through a still-live invitation. |
| 10 | Recovery after a confirmed takeover | ⚠ NEEDS HUMAN CONFIRMATION. Default: staff-assisted recovery after independent identity checks, using the existing staff start route in recovery mode; current-address sessions and cancel tokens cannot replace or cancel it | Smallest recovery surface: reuse the verified flow, no prior-address archive. Fallback: a separate, several-day signed revert design with encrypted old-address storage, requiring a follow-up review before implementation. |
| 11 | Historical aliases and holds | ⚠ NEEDS HUMAN CONFIRMATION. Default: keep no historical email-hash list; state the coverage limit, require staff to handle prior addresses explicitly, and consume the DSR engine's guard-time hold refresh | Follow DEC-A and R3-10; staff still extend/review holds after contact changes and preserve former identifiers in case records. This spec does not redesign the engine. Fallback: a bounded alias-history design in the owning contract/DSR specs before claiming automatic prior-address coverage. |

## 📝 Problem Statement

- **The address is the identity** for sign-in, magic links, password reset and invitation acceptance (`customer_accounts/api/login.ts`; `api/magic-link/request.ts`; `api/password/reset-request.ts`).
- **It is stored encrypted with a lookup hash**, unique per tenant among users not deleted (`customer_accounts/data/entities.ts`; `encryption.ts`). Uniqueness is per tenant, not per organization.
- **Nobody can change it.** The portal profile schema has only a display name (`data/validators.ts`); `adminUpdateUserSchema` has no email either.
- **The verification table cannot hold a target address.** It has a user, a token hash, a free-text purpose, an expiry and a used time (`entities.ts`).
- **No "pending address" exists anywhere** in the codebase.
- **Sessions.** A token lasts eight hours and carries the address; refresh re-signs it from the database. `revokeAllUserSessions` ends every session and invalidates older tokens (`services/customerSessionService.ts`).
- **The CRM link is made once**, when the user is created, and is skipped when a link already exists (`subscribers/autoLinkCrm.ts`).
- **Copies of the address** include invitation rows, JWT claims, some event payloads and the signup staff notification. `search.ts` marks email `hashOnly`, while display name is searchable and used in the result title. `subscribers/search-reindex-updated.ts` reindexes by id on `customer_accounts.user.updated`; it does not need an email in the event.
- **The existing verify route has no rate limit** (`api/email/verify.ts`), and the staff update writes with a raw update and no audit entry (`api/admin/users/[id].ts`). A raw update also bypasses encryption; the address must be written through the entity.
- **Lookups by hash try several forms** — keyed and legacy (`packages/shared/src/lib/encryption/aes.ts`) — while the unique index compares stored strings, so an account stored under the legacy form and a change under the new one would not collide in the index.
- **Tokens in flight are keyed by the user.** Magic links live 15 minutes and password resets 60 (`services/customerTokenService.ts`). `api/magic-link/verify.ts` consumes its token before `createSession`, whose only current lock is the session cap lock; a pre-change credential can otherwise create a post-change session.
- **Token cleanup is not scheduled.** `setup.ts` registers domain-verification and TLS-retry queues, not `customer-accounts-cleanup-tokens`. This spec must schedule bounded cleanup for its own table, including upgraded installations, without waiting for the pruner spec.
- **The outer rate limiter fails open and uses IP and hashed identifier keys** (`auth/lib/rateLimitCheck.ts`).
- **The search index is rebuilt on `customer_accounts.user.updated`**, and the reverse CRM link runs only when a person is created (`subscribers/autoLinkCrmReverse.ts`).

## 📝 Proposed Solution

| Step | What happens |
|---|---|
| Request | The signed-in user gives a new address and re-authenticates. A pending change is stored, replacing any earlier one |
| Messages | A link goes to the new address. A notice goes to the old one, saying a change was requested, with a link that cancels it without signing in |
| Until confirmed | Nothing changes. The user signs in with the old address and can cancel from the profile page or from the notice |
| Confirm | In one transaction under the per-user and tenant/address locks, lock and consume only a live pending row; check all target hash forms; replace the address through the managed entity; verify it; revoke sessions and unused user tokens; cancel pending old-address invitations. After commit tell the old address and staff with `customer_accounts.manage`, including how to obtain staff recovery |
| Staff | In the user's tenant and organization, `customer_accounts.manage` may start/cancel normal changes. Verified recovery uses the same start route with `mode: 'recovery'`; only staff can replace/cancel it and the recovered mailbox must confirm |

**When the new address is taken.** The request behaves identically in everything the requester can see: a pending change is stored, the old address gets the notice, the status shows it pending, cancelling works. The link is not sent — the pending change can never be confirmed and expires — and the owner of the existing account receives a notice, with its own wording, that someone tried to use their address.

**Limits.** At most three requests per user per hour, counted from the pending-change rows themselves, which are kept until the clean-up removes them. Staff-started changes are limited per staff user and per target, as invitations are. Both public POST routes use the existing limiter; tokens come from `generateSecureToken` (32 random bytes) and only `hashToken` digests are stored. Count requests under the user lock so concurrent replacements cannot exceed three per hour; finished rows remain for at least the counting window.

### Design decisions

| Decision | Rationale |
|---|---|
| A table for pending changes | The verification table has no place for the target address, and widening it would change a table three other flows share. |
| The new address is stored encrypted, with no hash of its own | Nothing looks a pending change up by address; the check at confirmation computes every hash form from the decrypted address. |
| Uniqueness is checked twice, at request and at confirmation, under a lock | Someone else may take the address in between, and the unique index alone does not see an account stored under an older hash form. |
| Request, cancel and the confirmed change are commands that cannot be undone, with audit entries that name no address | The staff route's lack of any audit entry is a defect not to be copied; an undo would restore an old sign-in name. |
| The confirmed change emits `user.updated` as well as its own event, both with ids only | The reindex subscriber needs no address; the update event is portal-broadcast. Existing emitters and their payload fields are not removed. |
| The confirm route is public and rate-limited | The person using the link may not be signed in on that device. |

### Alternatives considered

| Alternative | Why rejected |
|---|---|
| Change immediately, as the staff profile does | See the market reference. |
| Let staff set the address | See assumption 4. |
| Reuse the verification table with a new purpose | No column for the target address. |
| Update the CRM person's email as well | See assumption 5. |

### Atomic changes, recovery and identity boundaries

**One winner.** Request, both authenticated cancels, public token cancel and confirmation share the existing per-user advisory key `customer_accounts:session_cap:<userId>`. Acquire it with `withAdvisoryXactLock` before any row lock. For confirmation, acquire the tenant/target-address advisory lock next, before locking the user and pending row; use the innermost callback's exact `EntityManager` for every row, credential and invitation write. The outer user-lock transaction holds only its advisory lock while the inner transaction performs all mutations atomically. This respects the helper's existing fork/independent-transaction behavior; never place a row write in the outer transaction and assume a nested helper shares it. Requests/cancels need only the user-lock callback transaction. Session creation uses the same existing session-cap lock and does its credential reload and insert on that callback's exact manager. Bound the two lock waits and account for two connections during confirmation. Read the row by tenant and its user's organization; public routes resolve the hashed capability to that scope rather than accepting a browser-supplied tenant. Confirmation conditionally consumes only `used_at IS NULL`, `cancelled_at IS NULL` and `expires_at > now`; cancellation uses the same predicates. A portal/staff cancel losing to confirmation returns 409; public replay, expired or superseded tokens return generic 400. If cancel wins, confirm returns 400 and makes no address write. New requests serialize replacement and mark the previous live row cancelled; expired rows are closed before the partial unique index is checked.

**Invitations.** Confirmation computes `lookupHashCandidates(oldEmail)` in memory and cancels every still-pending invitation in the tenant matching any candidate, including another organization because account uniqueness is tenant-wide. The account module owns both tables. These cancellations are in the same transaction as consuming the change and writing the new address. Never reassign an invitation's roles to the changed account. Old accepted, cancelled and expired invitations remain subject to the cleanup/privacy coverage limit below.

**In-flight credentials.** Add an optional trailing `credentialVersion` argument to `customerSessionService.createSession`. It holds the stored `emailHash` and `sessionsRevokedAt` observed before password verification or magic-link consumption; invitation acceptance returns the newly created user's initial values before another flow can change them. `customerTokenService.verifyEmailToken` adds an optional internal `credentialVersion` result member captured from its populated user before the conditional token consume; the magic-link route forwards that captured member, never a stamp loaded after consumption. No stamp is sent in an HTTP body or event. The three first-party session callers (`api/login.ts`, `api/magic-link/verify.ts`, `api/invitations/accept.ts`) pass it. Inside the single existing session-cap lock callback transaction, before insertion, reload the scoped active user with `findOneWithDecryption`, and compare both values. A mismatch refuses sign-in with the flow's generic invalid-credential response and inserts no session. If session creation wins first, confirmation subsequently revokes that session; if confirmation wins first, the old credential is refused. Refresh continues to require a live session. Capture before the credential check/consume, not after it. A token-service override used by a first-party caller must provide the captured stamp; missing stamp fails closed on that caller rather than disabling the fence. Existing downstream callers may omit the new argument for one minor as a documented bridge; they keep the old contract and do not gain the credential-race guarantee until migrated.

**In-flight password writes.** The reset route first resolves the live token without consuming it through a new read-only `customerTokenService.peekPasswordResetToken` method, derives the user scope, and runs the server guard registry/cross-site check before any token or password mutation. It then revalidates and conditionally consumes the token; guard-modified inputs are revalidated and cannot change the server-derived target scope. A pre-recovery password-reset or self password-change must not install a password after recovery. `verifyPasswordResetToken` adds the same optional internal pre-consumption `credentialVersion` result as email-token verification. `api/password/reset-confirm.ts` carries it into the password-write transaction; `api/portal/password-change.ts` captures a version before checking the current password. Both acquire the same existing session-cap/user advisory lock once, reload the scoped user with decryption on its callback manager, compare email/revocation versions, and only then call `updatePassword` and revoke sessions on that exact manager. A mismatch returns the existing generic invalid-credential/token result without a password write. If the old password write commits first, recovery subsequently clears it and revokes its sessions/tokens; if recovery commits first, the old write is refused. A missing captured version from a token-service override fails closed on these first-party paths. This extends the fence to credential writes, not only session insertion.

**Post-confirmation recovery.** The old-address changed notice says that a confirmation may already have happened and directs the owner to the company. After checking identity through an independent channel, staff POST the existing start route with `{ newEmail: recoveredAddress, mode: 'recovery', identityVerified: true }`; the address is not taken from a current-mailbox assertion. This starts a new verified pending row, supersedes normal changes, revokes current sessions, and consumes current unused user tokens. While it is live, portal POST/DELETE and public cancel cannot replace/cancel it (409 for authenticated callers, generic 400 for the token route); its notice has no cancel capability. Only same-organization staff may replace or cancel recovery. Confirmation still requires the recovered-mailbox link and performs normal uniqueness and revocation checks. Recovery expiry releases the restriction; staff may retry after rechecking identity. No account email changes until the recovered address confirms, and staff never restore credentials through audit undo. On recovery confirmation also clear `password_hash`, `failed_login_attempts`, `locked_until` and the shared re-authentication lock/counter in that transaction: an attacker may have replaced or learned the password. The owner then signs in using a fresh magic link to the recovered address, or starts the existing password-reset flow to set a new password; the confirmation UI explains both. A pre-recovery password must never authenticate afterwards.

**CRM linking.** For CRM matching/ownership reads, both touched subscribers consume the customers-owned DI seam `customerPortalLinkResolver`, resolved softly. [`privacy-data-class-contract`](2026-11-16-privacy-data-class-contract.md), Architecture → Customers-owned portal-link resolver, defines `CustomerPortalLinkInput`, `CustomerPortalLinkResult` and `resolveLinks(input: CustomerPortalLinkInput): Promise<CustomerPortalLinkResult | null>`, with `customers/di.ts` registration and Phase 3 delivery. Its `customers/lib/__tests__/portalLinkResolver.test.ts`, CLASSIC DI case and `TC-CUSTOMER-PORTAL-LINK-001` are release prerequisites. Use its strict zod union: forward calls supply the loaded account's `scope: { tenantId, organizationId }`, `email`, nullable `personEntityId` and nullable `customerEntityId`, with no `createdPersonOrProfileId`; reverse calls supply event `scope: PrivacyScope`, `createdPersonOrProfileId` and optional `email`, with neither link-input member. Scope/link/event ids are UUIDs; a supplied email must be valid and normalized; mixed alternatives and extra keys are rejected. The common result contains `organizationId`, nullable `personEntityId` and nullable `customerEntityId`, never an email. Null means no eligible match; invalid input or unavailable reads throw and never count as a match. When the resolver is absent it leaves the account unlinked and refers to staff, with no CRM-table fallback.

Preserve C1's exact owning-organization and tenant predicates on every undeleted candidate and recovered company; privacy export's organization-plus-null rule does not apply to linking. A reverse event without an organization first resolves its scoped person/profile id to the owning organization. `autoLinkCrmReverse.ts` resolves the event's link ids without an email, then reads its own unlinked account candidates in bounded keyset batches and supplies each candidate's email and the same `createdPersonOrProfileId` back to `resolveLinks` to verify the match, preserving the first eligible account behavior. No CRM address is returned, and no account link crosses the resolved organization. No touched subscriber directly imports or queries customers entities. After finding a candidate through that seam, `autoLinkCrm.ts` takes `customer_accounts:crm_person:<tenant>:<organization>:<person>` with `withAdvisoryXactLock` and queries only its own `CustomerUser` rows for another active, undeleted account linked to that person in that scope. If found, it leaves the new user's person and company ids unset and notifies staff for manual review; no company is inferred from the blocked candidate. Apply the same check and lock in `autoLinkCrmReverse.ts`. A concurrent pair of subscribers cannot both attach. Only the customers-owned resolver reads CRM tables, through decryption helpers. Occupancy queries and link writes stay in `customer_accounts`; there is no cross-module ORM relationship. A previously linked changed account retains its link, so signup with the released address cannot adopt that person's company.

**Historical coverage limit.** Alias resolution still uses the current email only. Prior-address invitations and other modules' hash-keyed records can fall outside an account-only export/erase after a change; cancelling pending invitations closes the credential path, not this coverage gap. Document that staff must include previous identifiers explicitly through DEC-A — Subjects known only by an identifier (`privacy:identifier`) ([contract spec → A subject that is only an identifier](2026-11-16-privacy-data-class-contract.md)) and the relevant module-owned classes, with the linked CRM record reviewed separately. Under DEC-A and R3-10 — One definition of a stale hold ([DSR engine → How a hold matches](enterprise/2026-11-16-privacy-dsr-engine.md)), creation/extension append derived ids and the guard also refreshes every active person/portal-user hold's current ids before matching erasure or answering retention. A newly committed email is therefore covered at the next successful guard refresh without requiring an extension first; failures refuse, and a stale `identifier_key_check` cannot be silently repaired. The remaining gap is a change committed after a guard's final read, or an identifier added and removed entirely between checks. Staff notification and UI still instruct the controller to review/extend affected holds after changes and preserve former identifiers in case records. Refresh belongs to the engine guard, not this event; no portal-owned hold subscriber or historical alias archive is added.

Holds exist only with the enterprise engine, per R3-5 — Holds, honestly; this account flow adds no OSS hold store or hold enforcement when that engine is absent.

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

##### Scenario: Confirm and cancel race
- WHEN a confirm and cancel target the same live pending row together
- THEN exactly one commits; a successful cancel prevents the address change

##### Scenario: Old-address invitation
- WHEN a pending invitation matches any hash form of the released old address in the tenant
- THEN confirmation cancels it in the same transaction and it cannot be accepted

##### Scenario: Sign-in already in flight
- WHEN a first-party sign-in checked credentials before confirmation but inserts its session afterwards
- THEN the credential-version recheck refuses it, or confirmation revokes the session that committed first

##### Scenario: Wrong password
- WHEN re-authentication fails
- THEN no change is stored and no message is sent

#### ADDED Requirement: Staff-started change
The system SHALL let authorized staff start an address change for a portal user, which takes effect only when the link sent to the new address is used.

##### Scenario: Staff start
- WHEN staff with `customer_accounts.manage` enter a new address for a user in their tenant and organization
- THEN the user's address is unchanged until the link is used

##### Scenario: Staff boundary
- WHEN staff lack `customer_accounts.manage` or target a different organization in the same tenant
- THEN both staff methods refuse (403 for feature, 404 for target scope) without changing anything

##### Scenario: Recovery after confirmation
- WHEN the former owner contacts staff after the attacker already confirmed and staff verify identity independently
- THEN staff start recovery to the verified address, the current mailbox cannot cancel or replace it, and confirmation restores access while ending all attacker sessions

##### Scenario: Cleanup after upgrade
- WHEN an upgraded installation has finished pending-change rows and the user makes no further request
- THEN this package's registered cleanup job removes them after the bounded retention period

## 📝 Architecture

- **`customer_accounts`**: pending-change entity and service; audited non-undoable request/cancel/confirm commands; three portal handlers, two public handlers and two staff handlers across four route files; four email templates; one new event plus the existing update event; rate limits; an hourly cleanup worker with setup and upgrade registration.
- **`portal`**: profile form, pending/cancel state and a public confirm/cancel result page.
- **Staff user page**: start/cancel, recovery mode with an identity-check acknowledgement, and instructions for prior identifiers and active holds. Authorization is `customer_accounts.manage` and the user's organization, not a staff role name.

**Every write is guarded.** Before mutation call `isCrossSiteBrowserRequest` from `@open-mercato/shared/lib/url`, collect `getAllMutationGuardInstances()` plus `bridgeLegacyGuard(container)` when present, and call `runMutationGuards` with the create/update/delete operation and `{ userFeatures }`. Portal features come from `customerRbacService`, staff features from `rbacService`; public token handlers have no granted features and use the capability's scoped resource, never impersonate a privileged user. A blocked guard returns its `errorBody`/`errorStatus`. Merge and revalidate `modifiedPayload`; run every `afterSuccessCallbacks` item after successful commit, logging and reporting callback failure without turning a committed change into an error. This covers portal request/cancel, public confirm/cancel, staff start/cancel, recovery, and the password-change/reset-confirm writes integrated with the credential fence. The browser uses `apiCall`, `useGuardedMutation`, scoped lock headers, `surfaceRecordConflict` and `retryLastMutation`.

**Optimistic locking.** Authenticated start/replacement uses the user's `updatedAt`, supplied by profile/staff GET. Status returns the pending row id and `updatedAt`; authenticated cancel supplies that row's version. Commands enforce the expected version under the locked row with `enforceCommandOptimisticLock` and return the next version. Public confirm/cancel use one-use capability and locked conditional live-state checks rather than a browser edit version. All pending-row transitions advance their `updated_at` and the owning user's `updated_at`, so a stale user version cannot replace a newer pending request. Status returns both `updatedAt` for the pending row and `userUpdatedAt` for start/replacement. Existing staff `GET /api/customer_accounts/admin/users/:id` retains `customer_accounts.view` and its organization filter, and adds `emailChange: { id, expiresAt, mode, updatedAt } | null`; this is the read path for staff cancellation and contains neither target address nor token. Existing root `updatedAt` versions staff starts. Staff action controls require `customer_accounts.manage` even when a viewer can see pending metadata.

**Re-authentication dependency.** Whichever portal spec lands first ships `lib/reauth.ts`, its columns, migration and snapshot. Follow self-service Architecture → Re-authentication exactly: separate atomic row-locked counter, reset on success/expiry, fifth failure locks fifteen minutes, locked requests 429, login counters untouched. Password change joins that helper. This spec does not depend on unapproved self-service UI phases for its schema.

### Frontend architecture contract

| File | Why it is a client file | Imported by | Heavy deps |
|---|---|---|---|
| `EmailChangeForm.tsx` | Field state, re-authentication, guarded mutation | The portal profile page | None |
| The confirmation page | Reads the token from the address and posts it | Its route | None |

No new page-root client file beyond the portal's convention; no provider is touched. Writes use `apiCall` and `useGuardedMutation` with `retryLastMutation`; authenticated edit/cancel forms send scoped expected-version headers and surface record conflicts. Public link pages render a button which POSTs the token; GET never mutates. All public and guarded portal pages have `page.meta.ts` with the appropriate auth flags. Strings and recovery instructions are locale keys in all five portal locales; dialogs submit on Cmd/Ctrl+Enter and cancel on Escape.

## 📝 Data Models

| Table | Columns |
|---|---|
| `customer_user_email_changes` | UUID `id`, `tenant_id`, `organization_id` copied from the user, scalar `user_id`, encrypted `new_email` with no address hash, `token_hash`, nullable `cancel_token_hash` (null for recovery), `mode` (`normal` \| `recovery`), `requested_by` (`self` \| `staff`), nullable `requested_by_user_id`, `expires_at`, nullable `used_at` and `cancelled_at`, `created_at`, non-null `updated_at` initialized on create and advanced on transitions. Partial unique index on `(tenant_id, user_id)` where used/cancelled are null; expiry is handled by transitions, never `now()` in an index predicate |
| `customer_users` | Add `reauth_failed_attempts` (`int`, default 0), nullable `reauth_locked_until` (`timestamptz`) if absent; reuse existing `updated_at` and `sessions_revoked_at`. Initialize/backfill a null `updated_at` from `created_at` before versioned forms are enabled |

Ship the entity migration, `migrations/.snapshot-open-mercato.json`, and `defaultEncryptionMaps` entry for `customer_accounts:customer_user_email_change` covering `new_email`. Read addresses with `findOneWithDecryption`/`findWithDecryption` and scope; write through managed entities and `withAtomicFlush` transaction phases, never raw SQL for sensitive columns. Re-authentication migration is shared with self-service and applied once.

**Bounded cleanup owned here.** Add `workers/cleanupEmailChanges.ts` on `customer-accounts-cleanup-email-changes`, concurrency 1. Register a stable-id system schedule hourly in `setup.ts`, plus an idempotent `configs/lib/upgrade-actions.ts` action for existing installations. It processes keyset batches of at most 100, scoped by each row's tenant and organization. Delete used rows one day after `used_at`, cancelled rows one day after `cancelled_at`, and unused expired rows one day after `expires_at`; thus an untouched pending row lasts at most 48 hours plus scheduling delay. Keep rows for at least the one-hour request-count window. Registering this job is part of this spec's release, with no dependency on operational pruners. Lazy cleanup on a later request is only a fallback, never the bound. If scheduler registration is unavailable, refuse new changes with 503 rather than create unbounded stored target addresses; already-pending confirmation/cancel remains available. A stopped scheduler remains an operational risk and is stated below.

Release requires implementation of the merged `customer_accounts.users` contracts: [`privacy-data-class-contract`](2026-11-16-privacy-data-class-contract.md), Data Models → Account additions, exports only `id`, `mode`, `requestedBy`, `createdAt`, `updatedAt`, `expiresAt`, `usedAt` and `cancelledAt` for the user's email-change rows. Omit `requestedByUserId`, target address and both capability digests. [`privacy-subject-erasure`](2026-11-16-privacy-subject-erasure.md), The three roots and Portal recovery fields, deletes every pending, used, cancelled and expired `customer_user_email_changes` row and both capabilities; each changed/deleted row is a history record under R3-1 — The audit-history rule for every erasure, with its two stripping passes and internal no-snapshot rules. [`privacy-table-coverage`](2026-11-16-privacy-table-coverage.md), First root inventories and Newly declared account and objection tables, already assigns `customer_user_email_changes` to `customer_accounts.users`. Its class `tables` claim is mandatory with this new-table phase and attaches only when metadata export and full erasure/history ship; these contracts are specified, not existing code. Under DEC-G — The tenant-export reader and its declarations, a separate export-only `tableExports` entry is insufficient coverage. This is an account-local table, with no cross-module relation.

## 📝 API Contracts

Every input is zod-validated in `data/validators.ts`; every route exports OpenAPI. Portal routes derive tenant and organization from the authenticated account. Staff routes require `customer_accounts.manage` and load `{ id, tenantId: auth.tenantId, organizationId: auth.orgId, deletedAt: null }` with decryption, matching the existing admin route; outside-scope targets return 404. Account uniqueness checks alone are tenant-wide. Pending-row operations also constrain organization and owning user; public capability lookup verifies that row scope against the loaded user. No request accepts a client-selected organization.

| Route | Auth | Notes |
|---|---|---|
| Existing `POST /api/customer_accounts/portal/password-change` | Portal user | Existing input; shared re-auth counter, credential-version recheck under the user lock, registry and cross-site checks; invalid current password remains 400, lock gives 429, stale credentials fail without writing |
| Existing `POST /api/customer_accounts/password/reset-confirm` | Reset-token capability | Existing input; non-mutating token scope lookup before registry/cross-site checks, then token consume and version-fenced password write; invalid/used/stale token stays generic 400 |
| Existing `GET /api/customer_accounts/admin/users/:id` | Staff `customer_accounts.view`, own tenant/organization | Existing fields plus nullable `emailChange` metadata `{ id, expiresAt, mode, updatedAt }`; no target address or token; 401/403/404 as before |
| `POST /api/customer_accounts/portal/profile/email-change` | Portal user | `{ newEmail, password? }` plus expected user version. 200 for a well-formed address once re-authentication and checks pass, whether free or taken. 400 invalid; 401; 403 re-auth/guard/cross-site; 409 stale or active recovery; 429; 503 schedule absent |
| `GET …/portal/profile/email-change` | Portal user | `{ pending, id?, expiresAt?, mode?, updatedAt?, userUpdatedAt }`; never target address. A taken address has the same shape as a free one |
| `DELETE …/portal/profile/email-change` | Portal user | Expected pending-row version. 200 `{ ok, updatedAt }`; 401; 403; 404 nothing pending; 409 stale, confirmed race or protected recovery |
| `POST /api/customer_accounts/email/change-confirm` | Hashed one-use capability | `{ token }`; 200 `{ ok }`; generic 400 for unknown, cancelled, used, expired or inactive-account token; 403 cross-site/guard; 409 target taken; rate-limited by IP and token |
| `POST /api/customer_accounts/email/change-cancel` | Hashed one-use capability | `{ token }` from the old-address notice; 200 `{ ok }`; generic 400 for unknown, used, expired, superseded or protected-recovery token; 403 cross-site/guard; rate-limited |
| `POST /api/customer_accounts/admin/users/:id/email-change` | Staff `customer_accounts.manage`, own tenant/organization | `{ newEmail, mode?: 'normal' \| 'recovery', identityVerified?: boolean }` and expected user version; recovery requires `identityVerified: true` after an independent check. Same response for a free/taken target. 400; 401; 403; 404 scope; 409 stale; 429; 503 |
| `DELETE /api/customer_accounts/admin/users/:id/email-change` | Same staff scope and feature | Expected pending-row version; can cancel normal or recovery. 200 `{ ok, updatedAt }`; 401; 403; 404 scope or nothing pending; 409 stale/confirmation won |

- **Commands/events.** Request, cancel, recovery and confirm commands are not undoable. Audit records contain ids, mode and outcome only, with no address, address hash or raw capability. New `customer_accounts.user.email_changed` payload is `{ id, tenantId, organizationId }`. The existing `customer_accounts.user.updated` emitted by these commands is exactly `{ id, recipientUserId, tenantId, organizationId }`; never copy the staff route's `email` field. Other existing emitters/payload shapes are retained. Emit after commit through `emitCustomerAccountsEvent`. Unit `emailChange.events.test.ts` recursively rejects address fields/values and capability material in these emissions.
- **Notification.** Staff with `customer_accounts.manage` in the user's organization receive confirmed-change and recovery information, with instructions to review the CRM record, handle prior identifiers explicitly and extend affected active holds under DEC-A/R3-10.
- **Emails.** Four templates: confirm new address; requested notice to old address with normal cancel link (recovery variant has staff contact instead); changed notice to old address explaining immediate takeover and staff recovery; attempted-use notice to the existing owner's address. No fifth template or public revert route is added. Delivery starts after commit through the module's existing delivery mechanism; failures are logged/reported with sanitized codes and no decrypted addresses or raw capabilities.

## 📝 Edge Cases & Failure Scenarios

| Case | Behaviour |
|---|---|
| Account without a password | Require a recent live session row; independent re-auth lock rules still apply |
| New address equals the current one | Refuse as invalid |
| Link replay, cancellation or replacement | Generic 400; no mutation |
| Concurrent confirm/cancel | Shared user/row locks and live predicates allow one winner; authenticated losing cancel gets 409 |
| Inactive or deleted account before confirmation | Generic 400; no change |
| Pending account deletion | Email change leaves the stored deletion date and request intact; completion erases pending email-change rows too |
| Lookup secret changes while pending | Compute target and old-address candidate hashes from decrypted addresses at confirmation; do not persist a pending target hash |
| Pending duplicate invitation for the old address | Cancel it in the same transaction, for every hash form and tenant organization; acceptance fails afterwards |
| Sign-in consumed a token before confirmation | First-party session creation rechecks the pre-consumption email/revocation version under the user lock and refuses or is revoked by the subsequent confirmation |
| Attacker already confirmed | Normal cancel is too late; changed email directs owner to independently verified staff recovery, which attacker cannot cancel or replace |
| Staff starts recovery; current mailbox tries DELETE, POST or signed cancel | Refuse; same-organization authorized staff retain cancel/replace control |
| Recovery expires or new mailbox delivery fails | No account change; staff may recheck identity and restart; the bound cleanup removes the row |
| Same tenant, other-organization staff | POST and DELETE return 404; no target address, row or token is changed |
| Linked CRM person retains the old address | Keep existing link; forward and reverse auto-link refuse a second active account; staff handle rectification |
| Prior-address hash-keyed records | Outside current account aliases; documented limit, explicit previous-identifier handling under DEC-A; no claim that an account-only export/erase reaches them |
| Active hold created before the new address | Engine guard refresh appends the current id before matching, or refuses on failure/stale key; contact changes after its final read and identifiers added then removed between checks remain gaps; staff review/extend and preserve former identifiers under DEC-A/R3-10 |
| No cleanup scheduler registration | Refuse new normal/recovery requests with 503; existing confirm/cancel continues; upgrade action registers the job |
| No later request after completion/expiry | Hourly cleanup deletes finished target addresses after the stated one-day interval |

## 📝 Migration & Backward Compatibility

Add one table, the two shared re-authentication columns if absent, four route files with seven HTTP handlers, one event, four templates, an hourly cleanup schedule and the profile/public result UI. Include scoped migrations and snapshots, plus null user-version backfill if self-service has not shipped it. Do not apply migrations merely to validate a spec. Run `yarn generate` after implementing auto-discovered files. The release registers cleanup on both new and upgraded installations; the later pruner spec is not required.

Preserve existing API routes, input schemas, event ids and fields, and service import paths. The existing admin user GET gains pending metadata additively. Token verification service results gain only an optional internal captured-version member; no existing return member is removed. New event emissions use only the ids stated above; no existing event field is removed globally. `createSession` gains only an optional trailing credential-version argument; all three first-party callers migrate in the same change. Downstream callers omitting it keep the old signature and behaviour for at least one minor; deprecate omission with JSDoc, migration guidance and an `UPGRADE_NOTES.md` entry before any later requirement. These old callers retain the stated in-flight credential risk until migrated; no universal guarantee is claimed.

Password change gains the shared row counter: the first five wrong current passwords retain its 400 response, subsequent attempts while locked get 429 with the fifteen-minute bound. Login throttling and credentials remain separate. As in self-service Resolved assumption 10 and Migration, every implemented write runs guards and cross-site checks. Release of narrowed existing password-change/reset-confirm/profile behaviour requires the named maintainer emergency-security waiver under `BACKWARD_COMPATIBILITY.md`, its qualifying argument, a dated compatibility entry and client/operator notes; if refused, hold that phase until an ordinary bridge design is approved, never ship a guard-bypass flag. New email-change routes always enforce guards and cross-site checks. The customers resolver DI seam is new and additive; absent Customers leaves the new account unlinked. Signup routes and responses are unchanged, but CRM auto-linking intentionally leaves a released-address signup unlinked while another active account owns that person; document this safety change and staff repair procedure rather than calling signup untouched.

`UPGRADE_NOTES.md` states the 429 rollout, version headers, session-service optional argument, cleanup registration and retention interval, organization ACL boundary, staff recovery, prior-address/hold coverage limits and CRM linking change. Assumption 7 and the program's DEC-2b now state the same pending C7 rights-edition default for email change; an explicit email-change edition ruling is still required before delivery, with no independent OSS exception presumed. Consume DEC-13 — C7 existing-write compatibility and Migration → C7 proposed waiver (DEC-13), separate from A1/C2, for the separately proposed existing-write waiver, qualifying argument, dated compatibility entry, client/operator notes and named security-maintainer approval. The program grants no waiver; if qualification or approval is refused, the affected phase stays unshipped until an ordinary bridge is approved. Moving code on refusal is the owner's task, not a spec-worker file move.

## 📋 Phasing

| Phase | Outcome | Depends on |
|---|---|---|
| 1 | Shared re-authentication schema/helper, pending entity, guarded atomic service and bounded cleanup | Explicit email-change edition decision under assumption 7; compatibility rollout for existing writes; C1 Phase 3 account export, C4 Phase 3 account erase and C5's new-table coverage gate with this schema |
| 2 | Portal/public/staff UI and recovery; credentials fenced and CRM auto-link boundary | Phase 1; C1 Phase 3 customers-owned resolver implementation/registration; all tests below |

## 📋 Implementation Plan

1. Ship `lib/reauth.ts`, both columns, migration/snapshot, user-version initialization/backfill and password-change integration if absent. `reauth.test.ts` and `passwordChange.reauth.test.ts` follow the self-service cases: atomic parallel failures, reset on success/expiry, five failures then 429, recent-session rule and login counter untouched.
2. Add the pending entity with tenant/organization, non-null version, encryption map and account class export/erase allowlists. `emailChange.fields.test.ts` covers encrypted target/no target hash, metadata-only export and deletion/history records. Implement C5's already-specified account class `tables` claim with both handlers.
3. Implement serialized request/replace, conditional cancel and confirm commands. `customerEmailChangeService.test.ts` interleaves all three cancel paths with confirmation, confirms only live rows, checks legacy/current hash forms, cancels old-address invitations in the same transaction, and verifies rollback leaves credentials/invitations unchanged. Include user/pending version checks, user-version advancement on every transition and the staff metadata read path and the three-per-hour concurrent request limit.
4. Add staff recovery mode, no current-mailbox cancel/replace, independent identity-check input, session/token revocation at start, expiry and re-confirmation. `emailChange.recovery.test.ts` covers immediate attacker confirmation followed by staff recovery, protected recovery, scope/feature refusals, recovered-mailbox proof, cleared compromised password/lockouts and the owner's fresh sign-in.
5. Fence first-party session creation and credential writes: capture credential version before password/token check in login, magic-link verify and invitation accept, pass the optional argument, reload under the per-user lock and compare. `customerSessionService.emailVersion.test.ts` tests both transaction orders and all three callers, optional token-result propagation, missing-stamp override refusal, one exact transaction for confirmation writes and bounded nested-lock resource use; no session survives by being created between credential consumption and confirmation. Add the reset-token result stamp and lock/recheck before password reset and self password-change writes. `passwordReset.emailVersion.test.ts` and `passwordChange.emailVersion.test.ts` pause after token consume/current-password verification, complete recovery, then prove the old write cannot restore an attacker-known password; test the reverse ordering too. Keep the optional-argument compatibility case explicit.
6. Add ids-only emissions and notifications. `emailChange.events.test.ts` asserts exact update/new-event payloads and no addresses, hashes or raw tokens in events/audit entries. Require the contract owner's scoped customers resolver seam and its unit/integration tests. `autoLinkCrm.existingAccount.test.ts` and reverse tests cover retained-link suppression, scope, concurrent subscribers and staff referral using only account-owned rows for occupancy.
7. Add all seven handlers with schemas, OpenAPI, server registry/callbacks, cross-site checks, rate limits and scope/version enforcement. `emailChange.routes.test.ts` covers each error, callback failures after success, modified-payload revalidation, public no-privilege guards, other-organization targets and feature-negative staff calls.
8. Add `cleanupEmailChanges` hourly schedule, idempotent setup/upgrade registration and bounded deletion. `cleanupEmailChanges.test.ts` tests created/used/cancelled/expired rows at boundaries, no later request, retained request-count window, unavailable scheduler and repeated upgrade registration. Exercise local/async queue strategies.
9. Add profile, public link and staff/recovery UI, all locale keys and 409 handling; TC-PORTAL-EMAIL-001/002/003, portal docs and `UPGRADE_NOTES.md`. Follow C7 placement and compatibility gates before approval.
10. Archive the Delta into `.ai/specs/capabilities/portal-email-change.md` if adopted.

| File | Action |
|---|---|
| `packages/core/src/modules/customer_accounts/{data/entities.ts,data/validators.ts,encryption.ts,migrations/*,lib/reauth.ts,services/customerEmailChangeService.ts,commands/*,api/portal/profile/email-change.ts,api/email/change-confirm.ts,api/email/change-cancel.ts,api/admin/users/[id]/email-change.ts,emails/*,events.ts,lib/rateLimiter.ts,workers/cleanupEmailChanges.ts,setup.ts,i18n/*}` | Create / modify |
| `packages/core/src/modules/customer_accounts/{api/portal/password-change.ts,api/admin/users/[id].ts,api/login.ts,api/magic-link/verify.ts,api/invitations/accept.ts,services/customerSessionService.ts,services/customerTokenService.ts,api/password/reset-confirm.ts,subscribers/autoLinkCrm.ts,subscribers/autoLinkCrmReverse.ts}` | Modify for shared helper, credential fencing and released-address link guard |
| `packages/core/src/modules/portal/frontend/[orgSlug]/portal/{profile/*,verify-email-change/*}`, `i18n/*`, staff `backend/customer_accounts/users/[id]/page.tsx` | Create / modify UI and metadata |
| `packages/core/src/modules/configs/lib/upgrade-actions.ts`, `UPGRADE_NOTES.md`, portal docs | Modify |
| Customers-owned portal link resolver and `customers/di.ts` | Consume C1 Phase 3's specified `customerPortalLinkResolver.resolveLinks`, scoped ids-only implementation/registration and tests; keep CRM ORM access inside Customers |
| `packages/core/src/modules/customer_accounts/{privacy.ts,lib/privacy/*}` | Implement C1/C4/C5's specified metadata-only email-change export, full row erasure/history identities and class `tables` claim with this schema; no separate email-change data class |
| `packages/core/src/modules/customer_accounts/__tests__/{customerEmailChangeService,emailChange.fields,emailChange.recovery,emailChange.events,emailChange.routes,customerSessionService.emailVersion,passwordReset.emailVersion,passwordChange.emailVersion,autoLinkCrm.existingAccount,cleanupEmailChanges}.test.ts` and shared re-auth tests | Create / modify |
| `packages/core/src/modules/customer_accounts/__integration__/TC-PORTAL-EMAIL-00{1,2,3}.spec.ts` | Create |

## 🧪 Integration Coverage

Each test creates its own tenant, organizations, staff users/feature grants, company, portal roles/users, CRM records and pending invitations through API fixtures/shared helpers (`customerAccountsFixtures.ts` where applicable). Capture only those users' emails through the test email transport; drain only the test's jobs. Remove all users, sessions, tokens, pending/finished changes, invitations, CRM fixtures and schedules/config overrides in `finally`; do not depend on seeded business data or later requests to clean up. Clock controls and service barriers for race cases are test-only helpers, never production API paths.

| Test | Paths and key UI | Covers |
|---|---|---|
| TC-PORTAL-EMAIL-001 | Profile section; portal email-change POST/GET/DELETE; public change-confirm POST; login, magic-link verify and password-change | Request/right password, same old sign-in until confirmation, captured link, new sign-in and ended earlier session; status has id/version but no address; wrong password makes no row, shared helper locks at five and returns 429 then resets; cancel invalidates confirm; stale version gets 409; cross-site and registry refusals on writes leave data unchanged; dialogs/keyboard and conflict UI |
| TC-PORTAL-EMAIL-002 | Public change-cancel POST and public result UI; staff email-change POST/DELETE, existing admin user GET and detail UI; signup, invitation accept, magic-link verify | Free/taken target produces same requester response/status/old notice/cancel behaviour and no confirm link for taken target; public notice cancel without a session; staff reload obtains the existing request's version from admin GET; staff start then cancel makes the link unusable; a stale tab cannot replace a newer pending request; no-manage staff get 403 on POST and DELETE; same-tenant other-organization staff get 404 on both; immediate attacker confirmation followed by staff recovery, attempted user/token cancellation and replacement refused, recovered mailbox confirms, attacker sessions and their pre-recovery password fail, and fresh recovered-address magic-link/reset sign-in works; old-address pending invitation (legacy/current hash variants, another organization too) cannot be accepted; released-address signup remains unlinked to the already-linked CRM person/company |
| TC-PORTAL-EMAIL-003 | Upgrade registration and cleanup queue; confirm/cancel POST; login/magic-link/invitation session paths, reset-confirm and self password-change | Create live, used, cancelled and expired changes, apply the idempotent upgrade action twice on an installation with no pre-existing email-change schedule, advance clock and drain hourly cleanup without a later request; terminal rows and target ciphertext disappear at the bound, live rows/counting-window rows remain. Interleave confirm/cancel and confirm/sign-in at barriers: one transition wins and no first-party old credential leaves a live session after confirmation; a reset token consumed or current password verified before recovery cannot write an attacker-known password afterwards; direct reset-confirm registry refusal and cross-site POST reject before consuming the fixture token |

## 📝 Risks & Impact Review

#### A hijacked session takes the account
- **Scenario**: Someone with a stolen cookie changes the address to their own.
- **Severity**: High
- **Affected area**: portal accounts
- **Mitigation**: Re-authentication, pre-confirmation cancel, and a changed notice with a staff recovery path which the current mailbox cannot cancel; the recovered address must confirm. Session creation and password writes fence old credentials.
- **Residual risk**: An attacker controlling the new mailbox can confirm within seconds, before the owner can read any notice. Access may be lost until staff verify identity and recovery confirms. Compromise of both mailboxes or a mistaken staff identity check remains a risk; downstream session callers omitting the optional fence also retain their documented race.

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
- **Mitigation**: Proof at confirmation plus independently verified staff recovery which the current mailbox cannot cancel.
- **Residual risk**: Recovery depends on reachable, competent staff and a mailbox the owner controls; delay and verification mistakes remain possible.

#### Old-address records and a newly added contact escape current aliases
- **Scenario**: A user changes address; previous hash-keyed records are not reached by account export/erase, or the change commits after an in-flight guard's final read.
- **Severity**: Medium
- **Affected area**: subject coverage and enterprise holds
- **Mitigation**: Cancel live old-address invitations; document the current-only alias limit; consume the engine's guard-time identifier refresh and fail-closed stale-key handling; tell staff to review previous identifiers under DEC-A and extend/review active holds under DEC-A/R3-10. Do not add a portal-owned engine handler.
- **Residual risk**: Historical records need manual discovery. A contact changed after the final guard read, or added and removed between checks, can still escape that check; the next successful refresh covers a current new identifier without waiting for extend. This default requires human confirmation and is not described as complete historical coverage.

#### Finished target addresses have no scheduled deletion
- **Scenario**: An upgraded account never makes another request, or its scheduler later stops.
- **Severity**: Medium
- **Affected area**: encrypted pending-change addresses
- **Mitigation**: Own hourly cleanup, idempotent setup/upgrade registration, bounded batches, 24-hour terminal retention and refusal of new requests without registration. TC-PORTAL-EMAIL-003 covers upgrade without a later request.
- **Residual risk**: Registration cannot prove a running scheduler; an outage delays deletion until processing resumes. Operators must monitor the job.

#### Released address acquires another account's CRM access
- **Scenario**: The old mailbox signs up while the retained person still carries that address.
- **Severity**: High
- **Affected area**: portal company access
- **Mitigation**: Forward/reverse linking serialize by person and query account-owned occupancy; skip attaching another active user and refer to staff. Organization predicates apply to linking and every staff operation.
- **Residual risk**: Explicit staff relinking still needs identity review. A deleted/inactive account no longer triggers the active-account guard; this design does not create a permanent released-address registry.

## Final Compliance Report — 2026-11-16

- **Reviewed:** root/specs rules, compatibility contract, core API/encryption/coupling rules, the customer-accounts guide and verified auth/session/invitation/subscriber code, shared helpers, UI Portal Extension and queue/QA rules. Spec validation only; no implemented flow was tested.

| Rule | Status | Notes |
|---|---|---|
| Sensitive columns in an encryption map; lookups by hash | Compliant design | The new address is encrypted with no address hash; candidate forms are computed in memory at confirmation; raw capability tokens are never stored |
| Minimal error messages for auth | Compliant design | One response whether or not the address exists |
| Validate inputs with zod | Compliant design | — |
| Non-form writes through `useGuardedMutation` | Compliant design | Includes retry context, scoped version headers and conflict UI |
| Server mutation registry and cross-site checks | Compliant design | All new writes and shared password-change path, with callbacks and documented existing-route rollout |
| Optimistic locking | Compliant design | Non-null pending-row `updatedAt`; authenticated replacement/cancel compare versions; public capability transitions use locked conditional live state |
| Tenant and organization scoping | Compliant design | Staff and row access use both; uniqueness and old-address invitation cancellation are tenant-wide by design |
| Integration coverage | Compliant design | All seven methods, staff permissions/cancel, recovery, UI, upgrade cleanup and session races in three self-contained suites |

**Verdict:** revised design is conditional on the explicit email-change edition decision in assumption 7, recovery and historical-alias defaults in assumptions 10/11, implementation of C1/C4/C5's specified account/table/resolver contracts, and the compatibility rollout/required human security waiver before a changed existing-route default ships.

## Changelog

### 2026-11-16
- Written autonomously with resolved assumptions.
- Revised after independent review. A taken address is now indistinguishable in everything the requester can observe, not only in the response. Confirmation consumes magic links and reset tokens already sent to the old address. The notice carries a cancel link that needs no session. Uniqueness is checked against every hash form under a lock, and the pending row loses its unused hash column. The address is written through the entity, and `user.updated` is emitted so that search is rebuilt. Staff requests and cancels are audited commands with their own limits. Finished rows are removed lazily until the clean-up worker is scheduled, and the table joins the account's data class. The re-authentication helper is added here if it does not exist. Staff are told of a confirmed change, because the CRM's copy of the address is not updated.
- Council round two fixes (GPT-6.1 Sol workers): r7-08 — shared re-auth columns and 429 rollout; r7-18 — organization scope and row versions in both portal designs; r7-28 — protected staff recovery, compromised-password clearing and honest takeover risk; r7-29 — cancel old-address invitations; r7-30 — own bounded cleanup and upgrade schedule; r7-31 — historical alias/hold coverage limit; r7-32 — staff cancel and permission tests; r7-36 — encrypted target with no hash; r7-49 — ids-only event payload; g4-19 — retained CRM-link occupancy guard; g4-20 — one atomic confirm/cancel winner; g4-33 — first-party session and password-write credential fences; g4-34 — cross-site checks; g4-36 — C7 edition fallback; g4-37 — public cancel manifest and consistent seven-handler/four-template inventory; wording nits corrected.
- Council round two fixes, pass two (GPT-6.1 Sol workers): align DEC-A/R3-10 guidance with the DSR engine's guard-time hold refresh and remaining concurrency/history limits; mark the broader C7 email-change edition outcome as a default needing an explicit program ruling; name the missing C1 resolver/account field lists, C4 account erasure and C5 table-coverage prerequisites; cite R3-1's two-pass/no-snapshot rule and the separate proposed C7 compatibility waiver.
- Council round two fixes, pass three (GPT-6.1 Sol workers): consume C1's now-specified `customerPortalLinkResolver.resolveLinks` and account metadata allowlist, C4's complete email-change erasure/history and C5's new-table claim; replace stale missing-contract claims with exact phase dependencies, cite DEC-G and R3-5, and correct the program's separate-waiver scope.
- Council round two fixes, pass four alignment (GPT-6.1 Sol workers): cite C1's strict `CustomerPortalLinkInput` alternatives, `CustomerPortalLinkResult`, resolver registration/tests and exact organization rules while retaining both subscribers' account-owned lock/occupancy checks; align release prerequisites with C1's metadata-only export, C4's full email-change erasure/history and C5's mandatory class `tables` claim, and consume the program's existing DEC-2b/DEC-13 pending release gates.
