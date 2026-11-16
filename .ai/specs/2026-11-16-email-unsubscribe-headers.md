# One-click unsubscribe for automated email

> **Program:** package E3 of [`2026-11-15-gdpr-ready-deployments-program.md`](2026-11-15-gdpr-ready-deployments-program.md) (tracker open-mercato/open-mercato#8593).
> **Related:** `.ai/specs/2026-10-22-crm-contact-permissions-and-consent-history.md` (package E2), which covers person-to-person CRM email and is not implemented.
> **Verified at** `main` @ `08dada9624` by reading code; nothing was run. Whether each provider SDK accepts custom headers, and whether each provider's DKIM signature covers them, was not checked.
> **Written autonomously.** No question was put to a person; the choices are listed under Resolved assumptions.

Extends: .ai/specs/2026-11-15-gdpr-ready-deployments-program.md

## 📝 TLDR

Two kinds of email are sent by the product itself, repeatedly, to someone who did not ask for that message: invitations to fill in a form, sent to any address, and notification emails to staff. Neither carries a way to stop it from the email. The send helper cannot attach a header at all. **Proposed (future):** the send path learns to carry a small set of headers; form invitations get the standard one-click unsubscribe header and a visible link, and an address that uses it receives no more invitations from that organization; notification emails get the same header and link, which switch that notification type's email off in the user's existing preferences. Password resets, invitations to join, verification and security alerts are untouched.

**This is good practice, not a legal minimum.** The right to object in GDPR Art. 21(2) and the mailbox providers' one-click rule both concern marketing and bulk mail, and the product sends neither. The three phases ship separately and each is useful alone.

**Not in this spec:** a message one person writes to another — from a user's own mailbox, or from the messages module to an outside address — which is correspondence and is governed by the 10-22 spec's contact permissions; the email copy of an internal message, whose worker consults no preference today; bulk campaigns, which do not exist; provider-side suppression lists.

## 📝 Overview

> **Market reference.** RFC 8058 defines the one-click form: a `List-Unsubscribe` header with an HTTPS address, `List-Unsubscribe-Post: List-Unsubscribe=One-Click`, both covered by the message's DKIM signature; the receiver's mail client posts to the address with no login. Discourse and GitLab attach it to every notification email, with a signed token that maps to one preference. Adopted: the two headers, a signed token, a visible link, no login. Rejected: a link to a settings page behind a login, which a recipient without an account cannot use.

## 📝 Resolved assumptions (autonomous defaults)

| # | Question | Chosen | Rationale |
|---|---|---|---|
| 1 | Which email gets it | Form invitations, and notification emails whose type allows opting out | ⚠ NEEDS HUMAN CONFIRMATION for form invitations: a tenant may send a form a recipient is obliged to complete. A per-form switch "recipient may not opt out" is included for that. |
| 2 | Messages to an outside address | Out | One person wrote one message to one address. A recipient who clicked once would silently stop receiving later replies. |
| 3 | Who owns suppression of form invitations | The forms module: its own table, token, route and page | It already knows the invitation's tenant and organization, already signs public tokens and already has public routes with a rate limit. A shared list in the mail transport would need a tenant on every send, and form invitations pass none today. |
| 4 | Scope of an outside address's unsubscribe | Form invitations from that organization | The narrowest thing the recipient plainly meant. |
| 5 | Scope of a staff user's unsubscribe | That notification type's email channel, in their existing preferences | The preference already exists and is visible to them. |
| 6 | What the link carries | A signed reference to the invitation, or to the user, tenant and notification type. Never an address or a hash of one | A hash of an email in a URL that scanners and logs see is a reusable identifier, and the shared lookup hash equals the one stored on portal users. |
| 7 | What is stored for an outside address | A keyed hash made for this purpose alone | A suppression list of readable addresses is itself a list of people. |

## 📝 Problem Statement

- **One helper, no headers.** `sendEmail` (`packages/shared/src/lib/email/send.ts:124`) takes `to`, `subject`, body, `from`, `replyTo`, attachments, tenant and organization, and returns nothing. Its options and resolved payload have no header field (`:18-49`).
- **One transport, no headers.** The only registered transport is `sendSystemEmail` (`communication_channels/di.ts:25-29`), which passes five fields on (`lib/system-email.ts:291-301`). Each of the Resend, SES and SMTP adapters builds its provider payload from a fixed set of keys (`channel-resend/…/adapter.ts:83-93, 130-136`; `channel-ses/…/adapter.ts:85-99`; `channel-smtp/…/transport.ts:29-37, 115-122`), so an unknown key is dropped without a trace.
- **The test capture runs before the transport** (`send.ts:125`, transport at `:138`). It sees what the caller passed, not what a transport adds.
- **Form invitations pass no tenant** (`forms/subscribers/invitation-email.ts:140-144`), so they are sent through the installation's default path. The function that queues one returns a boolean and records a `lastError`.
- **Staff can already opt out of notification email**, per type, in `notification_preferences`, scoped by tenant and user; delivery consults it unless the type forbids opting out (`notifications/lib/shouldDeliver.ts:69-95`; `notificationPreferenceService.ts:12-15`). They must sign in to do it.
- **The lookup hash is unsuitable for a link.** With no secret configured it is an unkeyed SHA-256 (`packages/shared/src/lib/encryption/aes.ts:216-222`); with one, it equals `customer_users.email_hash`.
- **Public tokens are made two ways**: the auth module's, private to it (`auth/lib/tokenHash.ts:16-21`), and the forms module's stateless signed token with its own secret chain (`forms/services/distribution-token.ts:52-58, 93-112`).
- **Found on the way, not fixed here.** Inbox replies call Resend directly with `RESEND_API_KEY` and ignore the configured provider (`inbox_ops/api/proposals/[id]/replies/[replyId]/send/route.ts:169-175`). The workflow "send email" step resolves a service nobody registers and reports a simulated send (`workflows/lib/activity-executor.ts:915-941`). Both belong in issues.

## 📝 Proposed Solution

### Phase 1 — The send path carries headers

- `SendEmailOptions` gains `headers`. Only names on a short list are accepted — `List-Unsubscribe`, `List-Unsubscribe-Post`, `Auto-Submitted` — and values are sanitised; anything else is a programming error.
- The headers travel in the metadata the transport already passes, and each of the three system adapters maps them into its provider payload explicitly.
- The test capture records them.
- A header is added only when the application's public address is HTTPS.

### Phase 2 — Form invitations

- The invitation email carries both headers and a visible link. The header points to a public API address; the link points to a public page. Both carry the same signed token, which names the invitation.
- A `POST` to the API address — what a mail client sends, with a form-encoded body — looks up the invitation, hashes its recipient's address with a key made for this purpose, records the suppression for that organization, and returns 200. It returns 200 for a valid token whatever it finds, so that a repeat or a deleted invitation is not an error.
- The page shows what will stop and a button; the button posts.
- Before queuing an invitation, the forms module checks the list. A suppressed invitation is not sent; it is marked with the reason `recipient_opted_out`, which the invitations API already has a place for.
- A form can be marked so that its invitations carry no unsubscribe and ignore the list.
- Staff with the forms management feature can remove a suppression at the recipient's request, by posting the address.

### Phase 3 — Notification email

- For a notification whose type can be opted out of, the notifications module adds both headers and a visible link, with a token naming the tenant, the user, the type and the time of issue.
- Its public route checks again that the type allows opting out, then sets that type's email channel to off — unless the preference was changed after the token was issued, in which case it does nothing. So an old or forwarded email cannot undo a later choice.
- The user sees the change on their preferences page and can reverse it there.

### Design decisions

| Decision | Rationale |
|---|---|
| The token names a record, not a person | See assumption 6. |
| The token does not expire | An unsubscribe link in an old email must still work. It can only ever stop mail, and for notifications it cannot override a newer choice. |
| `POST` changes state; the page asks first | Link scanners and previews fetch links. A `GET` that unsubscribed would act on their behalf. |
| The public routes do not refuse when the rate limiter is unavailable | A mail client posts once and does not retry. The signature is the control against abuse. |
| Each module builds its own headers | The capture then sees them, and no module needs another's tables. |
| Header names are restricted | A free-form header map on a public helper is a way to inject mail headers. |

### Alternatives considered

| Alternative | Why rejected |
|---|---|
| A shared suppression list checked in the mail transport | Needs a tenant on every send; would move form invitations onto tenant channels as a side effect; and the capture could not see it. |
| A header on every email | A password reset with an unsubscribe header invites a user to break their own account recovery. |
| The address's hash in the link | See assumption 6. |
| `mailto:` unsubscribe | Needs an inbound mailbox per installation. |
| Rely on the provider's suppression list | Three providers, three behaviours, none visible to the tenant. |

### Known limits

- One-click works in a mail client only when the sending domain's DKIM signature covers the two headers. The hosted providers sign them; an arbitrary SMTP relay may not. The visible link works regardless.
- A changed signing secret invalidates links in mail already delivered. The previous secret may be supplied for verification.
- A changed hashing secret loses the suppression list.

## 📝 Delta

### Capability: email-unsubscribe

#### ADDED Requirement: Unsubscribe on form invitations
The system SHALL attach a one-click unsubscribe header and a visible link to a form invitation, and SHALL NOT send further invitations from that organization to an address that has used either.

##### Scenario: Headers and link
- WHEN a form invitation is sent and the application's address is HTTPS
- THEN the message carries `List-Unsubscribe` and `List-Unsubscribe-Post`, and its body links to the unsubscribe page

##### Scenario: One click
- WHEN a mail client posts to the address in the header
- THEN the next invitation to that address from that organization is not sent and is marked as opted out

##### Scenario: A link scanner
- WHEN the page address is fetched
- THEN nothing is recorded

##### Scenario: Another organization
- WHEN another organization invites the same address
- THEN the invitation is sent

##### Scenario: A form the recipient must receive
- WHEN a form is marked as one recipients may not opt out of
- THEN its invitations carry no unsubscribe and are sent regardless

##### Scenario: Password reset
- WHEN a password reset is sent
- THEN it carries neither header

#### MODIFIED Requirement: Notification email opt-out
The system SHALL let a staff user turn off a notification type's email from the email itself, without signing in.

##### Scenario: From the email
- WHEN a user's mail client posts to the address in a notification email
- THEN that type's email channel is off in their preferences and in-app delivery is unchanged

##### Scenario: A newer choice wins
- WHEN the user turned the email back on after the message was sent, and the old link is used
- THEN nothing changes

##### Scenario: A type that cannot be opted out of
- WHEN the notification type forbids opting out
- THEN its email carries no unsubscribe header, and a token for it does nothing

Frozen by: `packages/core/src/modules/notifications/__tests__/email-delivery-headers.characterization.test.ts`

## 📝 Architecture

- **`packages/shared/src/lib/email/send.ts`**: `headers` on the options, the allow-list and sanitising, the resolved payload, the capture.
- **`communication_channels/lib/system-email.ts`** and **`channel-resend`, `channel-ses`, `channel-smtp`**: carry and map the headers.
- **`forms`**: token purpose, header and link in the invitation, the suppression entity, the check before queuing, the public route and page, the staff removal route, the per-form switch.
- **`notifications`**: headers and link in the email strategy, its public route and page.

| Touchpoint | Mechanism | Absent |
|---|---|---|
| Caller → mail | `sendEmail` options | No headers: as today |
| An adapter that does not map headers | — | The visible link still works; the step records which adapters map them |
| `customers` → unsubscribes | An event `forms.invitation.unsubscribed` with ids only, for the 10-22 spec to use later | Nothing recorded on a contact |

## 📝 Data Models

| Table | Columns |
|---|---|
| `forms_invitation_suppressions` | `tenant_id`, `organization_id`, `recipient_hash`, `source` (`one_click` \| `page`), `created_at`. Unique on organization and hash |
| The form entity | `invitation_opt_out_allowed` boolean, default true |

Additive, with migrations and snapshots. No address is stored. `recipient_hash` is an HMAC with a key derived for this table from the installation's lookup secret, so it matches no other column.

## 📝 API Contracts

| Route | Auth | Behaviour |
|---|---|---|
| `POST /api/forms/public/invitation-unsubscribe?token=…` | None | Any body. Verifies the token; records the suppression if the invitation still exists; 200 for a valid token |
| `GET /api/forms/public/invitation-unsubscribe?token=…` | None | Returns the organization's name and the form's title for the page; changes nothing |
| `POST /api/forms/invitation-suppressions/remove` with `{ email }` | The forms management feature | Removes the suppression; audited |
| `POST /api/notifications/public/unsubscribe?token=…` | None | Applies the rule in Phase 3; 200 for a valid token |

- **Pages**: `/forms/unsubscribe` and `/notifications/unsubscribe`, public, with locale keys.
- **Token secret**: the forms module's existing chain for its token, with a new purpose; a dedicated `NOTIFICATIONS_UNSUBSCRIBE_SECRET` falling back to the application secret for the other. Each accepts a previous value for verification.
- **Type**: `SendEmailOptions.headers?: Partial<Record<'List-Unsubscribe' | 'List-Unsubscribe-Post' | 'Auto-Submitted', string>>`. Additive. `sendEmail`'s return type does not change.
- **Rate limits**: per address on all three public routes, not refusing when the limiter is unavailable.

## 📝 Edge Cases & Failure Scenarios

| Case | Behaviour |
|---|---|
| Token with a bad signature | 400; nothing changes |
| The same link used twice | 200 both times |
| The invitation was deleted or anonymized | 200; nothing can be recorded; the page says the request was received |
| The application's address is HTTP | No header; the visible link is still added |
| The hashing secret changes | Suppressions no longer match. Stated in the upgrade note beside the key-guard spec's warning about lookup secrets |
| A recipient unsubscribes and is invited again | Not sent; the invitation shows why; staff can remove the suppression at the recipient's request |
| A notification type becomes non-optional after a link was sent | The link does nothing |
| A user in two tenants | The token names the tenant; only that tenant's preference changes |
| An email forwarded to someone who clicks | For a form invitation, the original recipient is unsubscribed; reversible by staff. For a notification, the type's email is turned off unless the user has changed it since |

## 📝 Migration & Backward Compatibility

All additive: one optional field on an exported type, one table, one column, four routes, two pages, one event. A caller that passes no headers sends exactly what it sends today. Form invitations keep the sending path they have. A third-party adapter that does not map the headers keeps working.

## 📋 Phasing

| Phase | Outcome | Ships alone |
|---|---|---|
| 1 | Headers through the send path and the three adapters | Yes |
| 2 | Form invitations | Yes, after Phase 1 |
| 3 | Notification email | Yes, after Phase 1 |

## 📋 Implementation Plan

### Phase 1
1. Add `headers` to the send options with the allow-list and sanitising, to the resolved payload and to the capture. Unit tests, including a refused name and a value with a line break.
2. Carry them through `sendSystemEmail`. For each of the three adapters, confirm from the SDK that custom headers are accepted, map them, and unit-test the provider payload. Record here any adapter that cannot, and whether the provider signs them.

### Phase 2
1. The token purpose and the table-specific hash. Unit tests: round trip, tampering, wrong purpose, previous secret.
2. The suppression entity and migration; the check before queuing; the `recipient_opted_out` reason. Unit tests.
3. The public route, the page, the staff removal route, the event, the per-form switch. Unit tests.
4. Headers and link in the invitation template. Integration tests TC-EMAIL-UNSUB-001 and 002.

### Phase 3
1. **Characterize** today's notification email: no headers. Commit alone.
2. The token; headers and link for opt-out-able types; the public route with the newer-choice rule; the page. Update the characterization test. Unit tests for each rule.
3. Integration test TC-EMAIL-UNSUB-003; docs, including the DKIM note; file the two issues named under Problem Statement.
4. Archive this Delta into `.ai/specs/capabilities/email-unsubscribe.md` if that directory has been adopted by then.

| File | Action |
|---|---|
| `packages/shared/src/lib/email/send.ts` | Modify |
| `packages/core/src/modules/communication_channels/lib/system-email.ts`; `packages/channel-{resend,ses,smtp}/src/modules/*/lib/*` | Modify |
| `packages/core/src/modules/forms/{subscribers/invitation-email.ts,services/*,data/entities.ts,migrations/*,api/public/invitation-unsubscribe/route.ts,api/invitation-suppressions/remove/route.ts,frontend/forms/unsubscribe/*,events.ts,i18n/*}` | Create / modify |
| `packages/core/src/modules/notifications/{lib/strategies/email-delivery-strategy.ts,api/public/unsubscribe/route.ts,frontend/notifications/unsubscribe/*,i18n/*}` | Create / modify |
| `…/__integration__/TC-EMAIL-UNSUB-00{1,2,3}.spec.ts` | Create |

## 🧪 Integration Coverage

Emails are read from the test capture file, which records headers after Phase 1 because callers supply them. Each test creates its form or notification through the API and removes it.

| Test | Covers |
|---|---|
| TC-EMAIL-UNSUB-001 | A form invitation carries both headers and a body link; a password-reset email carries neither |
| TC-EMAIL-UNSUB-002 | Fetching the page records nothing; a form-encoded `POST` to the header's address returns 200; a second invitation to the same address is not captured and the invitations API shows it as opted out; an invitation from a second organization is captured; staff removal restores sending; the page renders and its button works |
| TC-EMAIL-UNSUB-003 | A notification email carries the headers; posting to its address turns that type's email off in `GET /api/notifications/preferences`; the next notification of that type is created in-app and no email is captured; after the user turns it back on, the old link changes nothing |

The test environment's public address must be HTTPS for the headers to appear, or the test sets the application address for the run; the step confirms which.

## 📝 Risks & Impact Review

#### A required form is not delivered
- **Scenario**: A recipient unsubscribes and is later sent a form they must complete.
- **Severity**: High
- **Affected area**: forms
- **Mitigation**: The per-form switch; the sender sees every skipped invitation and why; staff can remove a suppression.
- **Residual risk**: A tenant who leaves the switch on for a form that mattered.

#### Someone unsubscribes another person
- **Scenario**: A forwarded email's link is used by the wrong person, or a scanner posts.
- **Severity**: Medium
- **Affected area**: one address in one organization, or one notification type for one user
- **Mitigation**: Only `POST` acts; the effect is narrow and reversible; for notifications a newer choice wins.
- **Residual risk**: Scanners that do post. The standard accepts this for one-click.

#### The suppression list is lost
- **Scenario**: The hashing secret changes.
- **Severity**: Medium
- **Affected area**: every outside recipient who opted out
- **Mitigation**: The same warning the key-guard spec requires for lookup secrets.
- **Residual risk**: Until a rehash tool exists, a changed secret silently re-enables invitations. Stated.

#### Mail-header injection through the new field
- **Scenario**: A caller passes a value built from user input.
- **Severity**: Medium
- **Affected area**: outgoing mail
- **Mitigation**: A closed list of names; values sanitised; both callers build values from a token and the application's own address.
- **Residual risk**: Low.

## Final Compliance Report — 2026-11-16

- **Reviewed:** root `AGENTS.md`, `.ai/specs/AGENTS.md`, `BACKWARD_COMPATIBILITY.md` for the exported type. Not reviewed: the `forms`, `notifications` and `communication_channels` guides in full.

| Rule | Status | Notes |
|---|---|---|
| Provider code stays in provider packages | Compliant | Each adapter changes in its own package |
| No cross-module table access | Compliant | Each module keeps its own list or preference |
| Validate inputs with zod; public routes rate-limited | Compliant | — |
| No hard-coded strings | Compliant | Pages and links use locale keys |
| Tenant scoping | Compliant | Tenant and organization on the row; tenant in the notification token |
| Stable signatures unchanged | Compliant | `sendEmail` keeps its return type |
| Integration coverage | Compliant | Three tests |

**Verdict:** approved for Phase 1. Phase 2 is subject to assumption 1.

## Changelog

### 2026-11-16
- Written autonomously with resolved assumptions.
- Revised after independent review. Messages to an outside address and message copies are out: they are correspondence, or have no preference to switch. Suppression of form invitations moved into the forms module, because invitations carry no tenant at send time and a transport-level check would have rerouted them and been invisible to the test capture. Links now name an invitation or a preference, never a hash of an address. Headers are a closed list. The header and the visible link use different addresses with one token. The notification link cannot undo a newer choice. The legal framing is stated as good practice, and the three phases ship separately.
