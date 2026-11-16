# Portal privacy self-service

> **Program:** package C7 of [`2026-11-15-gdpr-ready-deployments-program.md`](2026-11-15-gdpr-ready-deployments-program.md) (tracker open-mercato/open-mercato#8593).
> **Builds on:** [`2026-11-16-privacy-data-class-contract.md`](2026-11-16-privacy-data-class-contract.md) for export and [`2026-11-16-privacy-subject-erasure.md`](2026-11-16-privacy-subject-erasure.md) for deletion. It asks both for a small addition, listed under "Changes this spec needs in its two parents".
> **Verified at** `main` @ `08dada9624` by reading code; nothing was run.
> **Written autonomously.** No question was put to a person; the choices are listed under Resolved assumptions.

Extends: .ai/specs/2026-11-15-gdpr-ready-deployments-program.md
Extends: .ai/specs/2026-11-16-privacy-data-class-contract.md
Extends: .ai/specs/2026-11-16-privacy-subject-erasure.md
Extends: .ai/specs/2026-08-14-storefront-customer-account.md

## 📝 TLDR

A customer-portal user can see their email, last login and roles on a read-only profile page. They cannot change anything there, download what is held about them, or close their account; the one delete route in the portal refuses a user who tries to remove themselves. **Proposed (future):** a Privacy page in the portal where a signed-in user can download their account data as a file and ask for their account to be deleted. Deletion takes effect after a grace period, during which they can still sign in and cancel, and during which the company's staff are told and can cancel it too. The profile page also gains a form for the display name.

**Status.** Phase 1 (display name) depends on nothing and can ship. Phases 2 and 3 are not approved: the program's decision DEC-2b says that if maintainers keep subject rights in the Enterprise edition, this whole package moves there.

**Not in this spec:** changing the account's email, which needs a verified flow of its own (`portal-email-change`, added to the program); the CRM record a tenant keeps about the person, which stays under the tenant's control; data in modules that do not yet register a data class; portal MFA.

## 📝 Overview

> **Market reference.** GitLab and Discourse both let a user download their own data and delete their own account from account settings, ask for the password again first, and delay deletion — GitLab by seven days — so that a hijacked session cannot destroy an account instantly. Adopted: re-authentication, a grace period with cancel, a confirmation email. Rejected: Discourse's rule that an account with content cannot self-delete; here the erasure run decides what is kept, not the form.

## 📝 Resolved assumptions (autonomous defaults)

| # | Question | Chosen | Rationale |
|---|---|---|---|
| 1 | What the download contains | The portal account class only: profile, sessions, roles, and invitations addressed to the user. Not the linked CRM person, and not any class added later | ⚠ NEEDS HUMAN CONFIRMATION. The CRM record holds staff notes about the person and may name other people. Handing it over with no review is the tenant's decision, not the form's. The page says that more may be held and that the user can ask the company for it. |
| 2 | What "delete my account" removes | The portal account. Every related subject, including the linked CRM person, is excluded | Same reason. The confirmation says so in plain words. |
| 3 | Grace period | 14 days, configurable, minimum 1 | Long enough to notice a hijack or change one's mind; the reference products use 7 to 30. |
| 4 | Re-authentication | The current password, when the account has one. Otherwise the session row must have been created by a sign-in in the last 15 minutes | Portal passwords are optional; magic-link users have none. |
| 5 | Sole company administrator | Refused while other active users exist in the company | Nothing today stops a company being left without an administrator except the refusal this spec replaces. |
| 6 | Who may use it | Any signed-in portal user, when the tenant has not switched it off | ⚠ NEEDS HUMAN CONFIRMATION. A right to one's own data should not depend on a role. The tenant is the controller, so it gets a switch; the default is on. |
| 7 | Does the tenant's staff learn of a request | Yes: an in-app notification to staff who manage portal users, and a cancel action on the user's admin page | ⚠ NEEDS HUMAN CONFIRMATION. The controller answers for the deletion and may have a reason to stop it. |
| 8 | Edition | OSS, pending DEC-2b. If refused, Phases 2 and 3 move to Enterprise as a whole | The program's wording. |
| 9 | A request that cannot be completed | After seven daily attempts it is marked failed; the user and the staff are told | A date that passes in silence is worse than a stated failure. |

## 📝 Problem Statement

- **The profile page is read-only.** It renders email, last login, roles and features with no form (`packages/core/src/modules/portal/frontend/[orgSlug]/portal/profile/page.tsx:46-111`). A profile update route exists and accepts only `displayName` (`customer_accounts/api/portal/profile.ts:74-86`; `data/validators.ts:52-54`), and no page calls it.
- **Self-deletion is refused.** `customer_accounts/api/portal/users/[id].ts:33-35` returns 400 when a user targets themselves. That route is for a company administrator removing a colleague.
- **Nothing exports.** No portal route returns the user's data as a file. The staff-side forms export is the only precedent: a synchronous JSON response with an attachment header (`forms/api/subjects/[subjectType]/[subjectId]/export/route.ts:80-104`).
- **No re-authentication exists** for any portal action. Password change checks the current password, without counting or throttling failures (`customer_accounts/api/portal/password-change.ts:42-45`). `passwordHash` is nullable.
- **A token's age proves nothing.** The refresh route mints a new eight-hour token on the same session row from the thirty-day cookie, with no credentials (`sessions-refresh.ts:44-57`; `customerSessionService.ts:90-103`). Only the session row's creation time is trustworthy; rows are created by password login, magic-link verification and invitation acceptance. Older tokens carry an empty session id (`customerAuth.ts:180-181`).
- **Login lockout is shared.** Five wrong passwords lock sign-in for fifteen minutes behind a generic 401 (`customerUserService.ts:8-9, 91-106`). A re-authentication prompt that counted against it would let a session thief keep the owner out.
- **Rate limiting fails open**, is keyed by address and identifier, and is off in test mode (`auth/lib/rateLimitCheck.ts:28-59`).
- **No rule protects a company's last administrator.** "Administrator" is any user holding `portal.users.manage` in the same company.
- **A soft-deleted portal user keeps email, hash and name** (`customerUserService.ts:156-167`), and the deletion event carries the email. The erasure spec changes both.
- **A new account with the same email is linked back to the retained CRM person** (`autoLinkCrm.ts:94-125`).

## 📝 Proposed Solution

One new page, five routes, a few columns, one daily job.

| Action | What happens |
|---|---|
| Edit display name | A form on the profile page calls the existing update route |
| Download | After re-authentication the browser receives one JSON file: the export document for the user's own account, from the account class only |
| Request deletion | After re-authentication the account is marked, a confirmation email is sent, staff are notified, and the page shows the date and a cancel button |
| Cancel | The user, or staff from the admin page, clears the mark |
| Grace period ends | A daily job runs the erasure operation for the account alone |

### Design decisions

| Decision | Rationale |
|---|---|
| The account stays fully usable during the grace period | Blocking login would make cancelling impossible from inside the portal. |
| New columns carry the pending state | `is_active` and `deleted_at` both block login. |
| The request outlives a deactivation or soft delete by staff | Otherwise an administrator's soft delete would quietly replace an erasure with a row that keeps the email and name. |
| The download names its data class explicitly | Fan-out is by subject kind, so a class added later would otherwise join the download unreviewed. |
| Re-authentication has its own failure counter | So that it cannot be used to lock the owner out of sign-in, and so that password change stops being an unthrottled oracle. |
| New routes for self-service; the colleague-removal route keeps its refusal | That route is authorized by a company-administration feature and must stay distinct. |
| The cross-site check is added to the new mutating routes | They are the most damaging portal mutations. |
| The privacy service is reached through a DI key, softly | Without the `privacy` module the page shows neither download nor deletion. |

### Alternatives considered

| Alternative | Why rejected |
|---|---|
| Delete immediately | A stolen session would be enough to destroy an account. |
| Include the CRM person in the download | See assumption 1. |
| Email a download link | Needs stored generated files, signed links and expiry, none of which exist. |
| Let the last administrator leave and notify staff | A company with users and no administrator cannot manage itself; refusing is the smaller change. |
| Use the age of the session token | It can be renewed without credentials. |

### Changes this spec needs in its two parents

Both parents are unreleased, so these are edits to their text, made with this spec.

| Parent | Change |
|---|---|
| Contract | The export operation is callable in process as `privacySubjectService.exportSubjects`, taking the subjects, `followRelated` (default true), an optional list of data-class ids, an actor and a reference. The command passes `system:privacy-cli` and `--reference`; the portal passes the user and a generated reference |
| Contract | The account class exports only invitations addressed to the user's own email. Invitations the user sent carry another person's email and name and are left out |
| Erasure | The run is callable in process as `privacySubjectService.eraseSubjects`, taking the subjects, the excluded related subjects, an actor, a reference and `mode` (`dry-run` or `apply`). The confirmation token stays in the command, which is the only caller with a person at a terminal |

## 📝 Delta

### Capability: portal-privacy-self-service

#### ADDED Requirement: Download own account data
The system SHALL let a signed-in portal user download the data held in their portal account, after re-authentication, and SHALL NOT include another person's data.

##### Scenario: Download
- WHEN a portal user confirms their password and requests a download
- THEN they receive a file containing their profile, sessions, roles and the invitations addressed to them

##### Scenario: Another person's data
- WHEN the user has a colleague and has invited someone
- THEN the file contains neither the colleague's email nor the invitee's

##### Scenario: Wrong password
- WHEN the password is wrong
- THEN nothing is returned, and sign-in with the right password still works

#### MODIFIED Requirement: Removing one's own portal account
The system SHALL let a signed-in portal user request deletion of their own account, SHALL keep the account usable for a grace period, and SHALL erase it when the period ends unless the request was cancelled.

##### Scenario: Request and cancel
- WHEN a user requests deletion and cancels the next day
- THEN the account is unchanged and no erasure runs

##### Scenario: Grace period ends
- WHEN the period ends without a cancel
- THEN signing in fails, the email can be used for a new account, and the linked CRM person still exists

##### Scenario: Staff remove the user during the period
- WHEN an administrator soft-deletes the user before the period ends
- THEN the erasure still runs at the end of the period

##### Scenario: Sole administrator
- WHEN the only active user with user-management rights in a company that has other active users requests deletion
- THEN the request is refused with an explanation

##### Scenario: Removing a colleague is unchanged
- WHEN a company administrator targets themselves on the colleague-removal route
- THEN it is still refused

Frozen by: `packages/core/src/modules/customer_accounts/__integration__/TC-PORTAL-005.spec.ts`

#### ADDED Requirement: Edit own display name
The system SHALL let a portal user change their display name from the portal.

##### Scenario: Edit
- WHEN a user with the account-management feature saves a new display name
- THEN the profile shows it after reload

## 📝 Architecture

- **`customer_accounts`**: five routes; `lib/reauth.ts`; the columns; a worker on its own queue; the email templates; the events; a notification type; the tenant setting.
- **`portal`**: the Privacy page and the profile form.
- **`privacy`**: registers `privacySubjectService` in its `di.ts` for in-app callers.

**Re-authentication** (`lib/reauth.ts`), used by the two new routes and by password change:

1. If the user's re-authentication lock has not expired, refuse with 429.
2. With a password on the account, verify it. A failure increments the re-authentication counter; five failures lock re-authentication for fifteen minutes. The login counter is not touched.
3. Without a password, load the session row named by the token's session id. Refuse when the id is empty or the row was created more than fifteen minutes ago.

**The worker** runs daily on a system-scoped cron schedule. For each account whose request is older than the grace period — whatever its `is_active` and `deleted_at` — it:

1. Re-checks the sole-administrator rule. If it now applies, it leaves the request pending and notifies the user and staff.
2. Calls the erase run in `dry-run` mode for the account, collects the related subjects it reports, and calls it again in `apply` mode with all of them excluded.
3. On success, nothing remains to update: the row is gone.
4. On a refusal or an incomplete run, increments the attempt count. At seven it sets the failed mark, emails the user and notifies staff. A failed request is not retried; staff clear it or a new request replaces it.

| Touchpoint | Mechanism | Absent |
|---|---|---|
| `customer_accounts` → `privacy` | `privacySubjectService` by DI key, resolved softly | Download and deletion are not offered; the status route says so |
| `portal` page → routes | `apiCall` and `useGuardedMutation` | — |
| Worker → scheduler | `schedulerService`, guarded by `hasRegistration` | Deletion is not offered: the status route reports it available only when the schedule is registered |
| Erasure not available for the account kind | The erase run's pre-flight | Deletion is not offered; an existing request fails after seven attempts |

### Frontend architecture contract

| Route | Server root | Client islands | Data owner | Notes |
|---|---|---|---|---|
| `/[orgSlug]/portal/privacy` | None — portal pages are client roots, as the existing profile page is | `page.tsx`, `DownloadDataDialog`, `DeleteAccountDialog` | The privacy routes | Server-side auth is enforced by the page metadata |
| `/[orgSlug]/portal/profile` | Same | Existing page, plus `DisplayNameForm` | Existing profile route | — |
| Staff user detail page | Existing | Existing page gains a status line and a cancel action | The staff cancel route | Guarded mutation |

| File | Why it is a client file | Imported by | Heavy deps | Alternative rejected |
|---|---|---|---|---|
| `portal/…/privacy/page.tsx` | Reads portal context; fetches status; opens dialogs | The route | None | A server root: no portal page has one, and the portal context is client-only |
| `DownloadDataDialog.tsx` | Password field state; triggers a browser file download | The page | None | — |
| `DeleteAccountDialog.tsx` | Password field state; guarded mutation | The page | None | — |
| `DisplayNameForm.tsx` | Controlled input; guarded mutation | The profile page | None | — |

| Budget | Value |
|---|---|
| New page-root client files | 1, following the portal convention |
| Client files over 300 lines | 0 |
| Heavy browser libraries | 0 |
| Hydration and interaction test | Required: TC-PORTAL-PRIVACY-005 |
| Evidence | `yarn check:client-boundaries` output |

No provider or bootstrap registry is touched. The dialog primitive has no keyboard handler and no portal page uses a dialog today, so both dialogs implement submit on Cmd/Ctrl+Enter and cancel on Escape themselves. All strings are locale keys in the five existing portal locales.

## 📝 Data Models

| Entity | Change |
|---|---|
| `customer_users` | Add nullable `deletion_requested_at` and `deletion_failed_at` (`timestamptz`), `deletion_attempts` (`int`, default 0), `reauth_failed_attempts` (`int`, default 0), `reauth_locked_until` (`timestamptz`, nullable); a partial index where `deletion_requested_at` is not null |

Additive, with a migration and the module snapshot. Staff-side user responses gain `deletionRequestedAt` and `deletionFailedAt`. The data-model graph is omitted: nullable columns on one existing table.

## 📝 API Contracts

All authenticate in the handler as the other routes of their kind do, and use `{ ok, error }` response bodies. Inputs are zod schemas in `customer_accounts/data/validators.ts`.

| Route | Request | Response | Errors |
|---|---|---|---|
| `GET /api/customer_accounts/portal/privacy` | — | `{ downloadAvailable, deletionAvailable, deletionRequestedAt, deletionEffectiveAt, deletionFailedAt, graceDays }` | 401 |
| `POST …/portal/privacy/export` | `{ password? }` | The export document, with an attachment header | 401; 403 re-authentication failed; 429; 503 privacy service absent |
| `POST …/portal/privacy/deletion-request` | `{ password? }` | `{ ok, deletionEffectiveAt }` | 401; 403; 409 sole administrator or already requested; 429; 503 |
| `DELETE …/portal/privacy/deletion-request` | — | `{ ok }` | 401; 404 nothing pending |
| `DELETE /api/customer_accounts/users/:id/deletion-request` (staff) | — | `{ ok }` | 401; 403 without the portal-user management feature; 404 |

- **Cross-site.** The portal's three mutating routes reject a cross-site browser request with the helper login uses.
- **Rate limits.** Export and deletion request get their own entries in the module's rate-limit configuration. They are a second line: the re-authentication counter is stored on the row and does not fail open.
- **Sole administrator.** Counted among users of the same company that are active, not deleted and not themselves pending deletion. A user with no company is never refused.
- **Settings.** `OM_PORTAL_ACCOUNT_DELETION_GRACE_DAYS`, default 14, minimum 1, in both `.env.example` files. A per-tenant switch for self-service, default on; the step picks the existing tenant settings store and names the key.
- **Events.** `customer_accounts.user.deletion_requested`, `…deletion_cancelled` and `…deletion_failed`, carrying ids only.
- **Notification.** One type, to staff holding the portal-user management feature, on request and on failure.
- **Email.** Two templates: "deletion requested", with the effective date and how to cancel; "deletion could not be completed", telling the user to contact the company.

## 📝 UI/UX

- **Profile page:** the display name becomes an inline form for users who hold the account-management feature.
- **Privacy page**, in the account navigation group:
  - *Your data* — one paragraph on what the file contains and what it does not, and a button that opens the download dialog.
  - *Delete account* — one paragraph stating that the portal account is removed; that records the company holds about the person are not, and whom to ask about those; and that signing up again with the same email reconnects the new account to those records. A button opens the confirmation dialog. When a request is pending the section shows the date and a cancel button; when it failed, it says so.
- **Staff user page:** a line with the pending date or the failure, and a cancel action.
- States: loading, self-service unavailable (the page says these options are not available here), and errors through the shared flash messages.

## 📝 Edge Cases & Failure Scenarios

| Case | Behaviour |
|---|---|
| Account with no password, session row older than 15 minutes, or a token with no session id | 403 with a code; the page asks the user to sign in again |
| Deletion requested twice | 409 with the existing date |
| Staff deactivate or soft-delete the user during the period | The request stands and the erasure runs. The user can no longer sign in to cancel; staff can cancel for them |
| The user becomes the sole administrator after requesting | The worker leaves the request pending and notifies the user and staff |
| The erase run is refused by a guard, or a class for the account kind cannot erase | Counted as an attempt; failed after seven |
| Scheduler absent, or its schedule not registered on an upgraded installation | Deletion is not offered |
| Privacy module disabled during a grace period | The worker counts attempts and the request fails |
| Email delivery fails | The request still stands; the page shows the same information |
| Linked CRM person | Excluded from the run; named in the audit entry |
| Company with a single user | The sole-administrator rule does not apply |
| Tenant switch turned off with requests pending | Existing requests run; new ones are refused |

## 📝 Migration & Backward Compatibility

All additive: columns, five routes, three events, one notification type, two settings, one page, one DI key. The colleague-removal route and its refusal are unchanged. Password change gains the re-authentication counter, so a sixth wrong current password in fifteen minutes now returns 429 instead of another 400. `UPGRADE_NOTES.md` names the settings, the upgrade action that registers the daily job, and the fact that deletion is offered only once that job is registered and the `privacy` module is enabled.

## 📋 Phasing

| Phase | Outcome | Depends on |
|---|---|---|
| 1 | Display-name form | — |
| 2 | Privacy page with download | Contract spec, Phase 4, with the changes above; DEC-2b |
| 3 | Deletion request, cancel, the daily job | Erasure spec, Phase 3, with the change above; DEC-2b |

## 📋 Implementation Plan

### Phase 1 — Edit
1. Add `DisplayNameForm` to the profile page, with locale keys in every portal locale. Integration test TC-PORTAL-PRIVACY-001.

### Phase 2 — Download
1. Register `privacySubjectService` in the `privacy` module's `di.ts`, with an entry in the DI seam test; add `followRelated`, the class list, actor and reference to the export operation, with unit tests.
2. Add the re-authentication columns and `lib/reauth.ts`. Unit tests: password right; wrong; locked; no password with a fresh row, an old row and an empty session id; the login counter untouched.
3. Route password change through it. Unit test for the lock.
4. Add the status and export routes with their schemas, OpenAPI entries, cross-site check and rate limits. Unit tests for each error.
5. Add the Privacy page and the download dialog.
6. Integration tests TC-PORTAL-PRIVACY-002 and 005.

### Phase 3 — Deletion
1. **Characterize** in the existing portal user test that self-targeting the colleague-removal route returns 400. Commit alone.
2. Add the deletion columns, their migration, and the two fields on the staff-side user response.
3. Add the request and cancel routes, the staff cancel route, the sole-administrator rule, the tenant switch, the events, the notification and the email templates. Unit tests.
4. Add the queue, the worker, its registration and the upgrade action. Unit tests with a fake clock: inside the period; past it; cancelled; soft-deleted by staff; refused seven times; sole administrator.
5. Add the deletion section, the dialog and the staff page line.
6. Integration tests TC-PORTAL-PRIVACY-003 and 004; `UPGRADE_NOTES.md`; both `.env.example` files; the portal docs page.
7. Archive this Delta into `.ai/specs/capabilities/portal-privacy-self-service.md` if that directory has been adopted by then.

### File manifest

| File | Action |
|---|---|
| `packages/core/src/modules/customer_accounts/api/portal/privacy/{route.ts,export.ts,deletion-request.ts}`, `api/users/[id]/deletion-request.ts` | Create |
| `packages/core/src/modules/customer_accounts/{lib/reauth.ts,lib/rateLimiter.ts,api/portal/password-change.ts,data/validators.ts,data/entities.ts,migrations/*,events.ts,notifications.ts,setup.ts,workers/*,emails/*,i18n/*.json}` | Create / modify |
| `packages/core/src/modules/portal/frontend/[orgSlug]/portal/privacy/{page.tsx,page.meta.ts}`, the two dialogs, `DisplayNameForm.tsx`, `i18n/*.json` | Create / modify |
| The staff portal-user detail page | Modify |
| `packages/core/src/modules/privacy/{di.ts,lib/subjectService.ts}` | Create / modify |
| `packages/core/src/modules/configs/lib/upgrade-actions.ts` | Modify |
| `packages/core/src/modules/customer_accounts/__integration__/TC-PORTAL-PRIVACY-00{1..5}.spec.ts` | Create |
| `apps/mercato/.env.example`, template copy, `UPGRADE_NOTES.md`, docs | Modify |

## 🧪 Integration Coverage

Fixtures come from `packages/core/src/helpers/integration/customerAccountsFixtures.ts` (role, company, user, portal login) and are removed in teardown. The confirmation email is read from the test email capture file.

| Test | Paths | Covers |
|---|---|---|
| TC-PORTAL-PRIVACY-001 | Profile page, `PUT …/portal/profile` | A user edits their display name in the page and sees it after reload |
| TC-PORTAL-PRIVACY-002 | `POST …/portal/privacy/export` | The file holds the user's own email and sessions; it holds neither a colleague's email nor that of someone the user invited; a wrong password returns 403 and sign-in still works afterwards; no cookie returns 401; a cross-site request is rejected |
| TC-PORTAL-PRIVACY-003 | `POST` and `DELETE …/deletion-request`, `GET …/privacy`, login, the staff cancel route | Request, see the date and the email, sign in again during the period, cancel, status clears; a second request is cancelled by staff |
| TC-PORTAL-PRIVACY-004 | The worker's job, enqueued and drained through the integration queue helper after backdating the request | Sign-in fails; a new account with the same email works; the linked CRM person is still returned by `GET /api/customers/people`; a user soft-deleted by staff during the period is erased too; a sole administrator with a colleague gets 409 |
| TC-PORTAL-PRIVACY-005 | Privacy page | The page loads, both dialogs open, submit on Cmd/Ctrl+Enter and close on Escape |

## 📝 Risks & Impact Review

#### A hijacked session destroys an account
- **Scenario**: Someone with a stolen cookie requests deletion.
- **Severity**: High
- **Affected area**: portal accounts
- **Mitigation**: Re-authentication against the session row, the grace period, the confirmation email to the account's address, the notification to staff, the cross-site check.
- **Residual risk**: A passwordless account whose sign-in is under 15 minutes old. The email, the staff notification and the grace period are the remaining controls.

#### The user believes everything about them is gone
- **Scenario**: The account is deleted and the company still holds orders, tickets and a CRM record; a later sign-up with the same email shows them again.
- **Severity**: High
- **Affected area**: user expectations; the tenant's obligations
- **Mitigation**: The page, the dialog and the email all say what is and is not removed, whom to ask, and what a new sign-up does.
- **Residual risk**: The tenant must still answer a full erasure request by hand until the coverage specs land.

#### The download leaks another person's data
- **Scenario**: A section includes a colleague, an invitee, or a record keyed to the company.
- **Severity**: High
- **Affected area**: the export
- **Mitigation**: One named data class; related subjects not followed; sent invitations left out; a test asserts a colleague's and an invitee's email are absent.
- **Residual risk**: A later change to the account class itself. Its handler tests are the control.

#### Requests never take effect
- **Scenario**: The worker stops after requests were accepted, or every attempt is refused.
- **Severity**: Medium
- **Affected area**: installations whose background processing breaks
- **Mitigation**: Deletion is offered only when the schedule exists; after seven attempts the user and staff are told.
- **Residual risk**: A stopped worker counts no attempts, so the date passes with nothing sent until it runs again. The doctor's scheduler check is the control.

#### Re-authentication becomes a way to guess a password
- **Scenario**: A session thief uses the prompt to try passwords.
- **Severity**: Medium
- **Affected area**: portal accounts
- **Mitigation**: Five tries per fifteen minutes, stored on the row, shared by the two new routes and password change.
- **Residual risk**: 480 guesses a day against one account for as long as the session lives.

## Final Compliance Report — 2026-11-16

- **Reviewed:** root `AGENTS.md`, `.ai/specs/AGENTS.md`, `packages/ui/AGENTS.md` → Portal Extension (through the research), `packages/create-app/AGENTS.md` (template sync), the frontend architecture contract. Not reviewed: `packages/core/src/modules/customer_accounts/AGENTS.md` in full; the implementer reads it.

| Rule | Status | Notes |
|---|---|---|
| Portal pages declare `requireCustomerAuth` | Compliant | Page metadata |
| Never use raw `fetch`; non-form writes through `useGuardedMutation` | Compliant | Named in the contract |
| Dialogs: Cmd/Ctrl+Enter and Escape | Compliant | Implemented in the dialogs; tested |
| No hard-coded strings | Compliant | Five locales |
| Validate inputs with zod | Compliant | — |
| Optimistic locking on new editable entities | N/A | No new entity; the display-name form uses the existing route |
| Cross-module access by sanctioned mechanisms | Compliant | DI key, resolved softly |
| Never expose cross-tenant or other users' data | Compliant | One class, own subject, sent invitations excluded |
| Background work through the worker contract | Compliant | Own queue |
| Frontend architecture contract | Compliant | Included |
| Template sync for env vars | Compliant | Named |

**Verdict:** Phase 1 approved. Phases 2 and 3 wait for DEC-2b and for the three parent changes.

## Changelog

### 2026-11-16
- Written autonomously with resolved assumptions.
- Revised after independent review. The download now names one data class and does not follow related subjects, which needed an addition to the contract's export operation. The erase run gets an in-process entry point. Re-authentication checks the session row instead of the token's age and keeps its own failure counter, shared with password change. A request survives a staff soft delete, fails visibly after seven attempts, and is offered only when its schedule exists. Staff are notified and can cancel; the tenant gets a switch. Approval narrowed to Phase 1.
