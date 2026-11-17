# One-click unsubscribe for automated email

> **Program:** package E3 of [`2026-11-15-gdpr-ready-deployments-program.md`](2026-11-15-gdpr-ready-deployments-program.md) (tracker open-mercato/open-mercato#8593).
> **Related:** `.ai/specs/2026-10-22-crm-contact-permissions-and-consent-history.md` (package E2), which covers person-to-person CRM email and is not implemented.
> **Verified at** `main` @ `08dada9624` by reading code; nothing was run. Whether each provider SDK accepts custom headers, and whether each provider's DKIM signature covers them, was not checked.
> **Written autonomously.** No question was put to a person; the choices are listed under Resolved assumptions.

Extends: .ai/specs/GDPR/2026-11-15-gdpr-ready-deployments-program.md

## 📝 TLDR

Two kinds of email are sent by the product itself, repeatedly, to someone who did not ask for that message: invitations to fill in a form, sent to any address, and notification emails to staff. Neither carries a way to stop it from the email. The send helper cannot attach a header at all. **Proposed (future):** the send path learns to carry a small set of headers; form invitations get the standard one-click unsubscribe header and a visible link, and an address that uses it receives no more invitations from that organization; notification emails get the same header and link, which switch that notification type's email off in the user's existing preferences. Password resets, invitations to join, verification and security alerts are untouched.

**This is good practice, not a legal minimum.** The right to object in GDPR Art. 21(2) and the mailbox providers' one-click rule both concern marketing and bulk mail, and the product sends neither. The three phases ship separately and each is useful alone.

**Not in this spec:** a message one person writes to another — from a user's own mailbox, or from the messages module to an outside address — which is correspondence and is governed by the 10-22 spec's contact permissions; the email copy of an internal message, whose worker consults no preference today; bulk campaigns, which do not exist; provider-side suppression lists.

## 📝 Overview

> **Market reference.** RFC 8058 defines the one-click form: a `List-Unsubscribe` header with an HTTPS address, `List-Unsubscribe-Post: List-Unsubscribe=One-Click`, both covered by the message's DKIM signature; the receiver's mail client posts to the address with no login. Discourse and GitLab attach it to every notification email, with a signed token that maps to one preference. Adopted: the two headers, a signed token (sealed, for form invitations), a visible link, no login. Rejected: a link to a settings page behind a login, which a recipient without an account cannot use.

## 📝 Resolved assumptions (autonomous defaults)

| # | Question | Chosen | Rationale |
|---|---|---|---|
| 1 | Which email gets it | Form invitations from a form that allows opting out (the default), and notification emails whose type allows opting out | Both are repeated mail the recipient did not ask for, so opting out is the default. A tenant may send a form a recipient is obliged to complete: the per-form switch "recipient may not opt out" (`invitation_opt_out_allowed = false`) covers it, and that form's invitations carry no unsubscribe and ignore the list. |
| 2 | Messages to an outside address | Out | One person wrote one message to one address. A recipient who clicked once would silently stop receiving later replies. |
| 3 | Who owns suppression of form invitations | The forms module: its own table, token, route and page | It already knows the invitation's tenant and organization, already signs public tokens and already has public routes with a rate limit. A shared list in the mail transport would need a tenant on every send, and form invitations pass none today. |
| 4 | Scope of an outside address's unsubscribe | Form invitations from that organization | The narrowest thing the recipient plainly meant. |
| 5 | Scope of a staff user's unsubscribe | That notification type's email channel, in their existing preferences | The preference already exists and is visible to them. |
| 6 | What the link carries | For a form invitation, a sealed token: the tenant, the organization, the invitation id and the recipient's suppression hash, encrypted and authenticated with a key made for this purpose, with a fresh nonce for every email. For a notification, a signed reference to the user, tenant and notification type. Never a readable address or hash | A readable hash of an email in a URL that scanners and logs see is a reusable identifier, and the shared lookup hash equals the one stored on portal users. Sealed, every link differs and reveals nothing. The token carries the hash because the invitation's address does not last: retention can remove it after its mode, notice and hold gates permit anonymization, and erasure may remove the row. |
| 7 | What is stored for an outside address | A purpose-bound keyed hash, key id and minimal objection metadata, never a readable address | The hash is pseudonymous personal data; registration, retention and export rules below apply. |
| 8 | Erasure and retention of an objection | Keep the minimal suppression after subject erasure, with no age pruner; remove it only on the recipient's request, on tenant deletion, or through assumption 10's discard of mismatched rows | Deleting it with erasure would resume invitations to a person who objected. The row holds a purpose-bound hash and fixed metadata only, the minimum needed to keep honouring the objection. It is objection state, not privacy evidence, so the program's 365-day evidence age does not apply. |
| 9 | Staff without notification preference permission | Issue no unsubscribe header/link unless the recipient can manage preferences | The user must be able to see and reverse the change on their own preferences page. Feature checks are wildcard-aware. |
| 10 | Suppression key mismatch | Refuse optional invitation sends in the affected organization with `suppression_key_mismatch` until resolved; mandatory forms keep their explicit bypass. Two resolutions: restore the previous secret value in `FORMS_INVITATION_SUPPRESSION_SECRET`, or, when that value is lost, discard the organization's mismatched rows with `mercato forms discard-mismatched-suppressions` | Sending would silently ignore objections nobody can check any more. Restoring the secret loses nothing; a discard is a deliberate, counted loss of objections, never an automatic one. |
| 11 | Suppression state in a tenant export | Resolved by **R4-9 — Suppression state in a tenant export**, as specified in [`2026-11-16-tenant-exit-export.md`](2026-11-16-tenant-exit-export.md), **Declarations → Forms suppression metadata**, and [`2026-11-16-privacy-table-coverage.md`](2026-11-16-privacy-table-coverage.md), **Newly declared account and objection tables**: export `forms_invitation_suppressions` with both `recipient_hash` and `key_id` redacted as `key_material`, name both redactions in the manifest, and include the row count | No suppression-state handover in this version. A receiving system cannot rebuild opt-outs from the artifact, even with the original suppression key; neither column has a reviewed-checksum exception. |

## 📝 Problem Statement

- **One helper, no headers.** `sendEmail` (`packages/shared/src/lib/email/send.ts:124`) takes `to`, `subject`, body, `from`, `replyTo`, attachments, tenant and organization, and returns nothing. Its options and resolved payload have no header field (`:18-49`).
- **One transport, no headers.** The only registered transport is `sendSystemEmail` (`communication_channels/di.ts:25-29`), which passes five fields on (`lib/system-email.ts:291-301`). Each of the Resend, SES and SMTP adapters builds its provider payload from a fixed set of keys (`channel-resend/…/adapter.ts:83-93, 130-136`; `channel-ses/…/adapter.ts:85-99`; `channel-smtp/…/transport.ts:29-37, 115-122`), so an unknown key is dropped without a trace.
- **The test capture runs before the transport** (`send.ts:125`, transport at `:138`). It sees what the caller passed, not what a transport adds.
- **Form invitations pass no tenant** (`forms/subscribers/invitation-email.ts:140-144`), so they are sent through the installation's default path. The function that queues one returns a boolean and records a `lastError`.
- **An invitation's address does not last.** `forms_invitation.recipient_email` is the only place the address is kept (`forms/data/entities.ts:630-631`). Anonymizing a submission sets it to null on every linked invitation (`forms/services/anonymize-service.ts:138-142`). [`2026-11-16-forms-retention-scheduling.md`](2026-11-16-forms-retention-scheduling.md), **Proposed Solution**, schedules a daily pass; anonymization requires its independent `OM_FORMS_RETENTION_MODE`, per-form thirty-day delivered-notice period and hold check. Unset mode reports only for the bridge minor under **DEC-H — The counting-period bridge**, and its guard follows **R3-5 — Holds, honestly** and **DEC-C — Retention sets and holds**. This design relies on eventual address loss, not immediate daily deletion. The send path reads only rows with no `deleted_at` (`invitation-email.ts:164-169`). A design that hashes the address from the row when the link is used records nothing once the address or the row is gone.
- **The forms access token re-derives its scope from a row** and never trusts the token for it (`forms/services/distribution-token.ts:18-20`).
- **Staff can already opt out of notification email**, per type, in `notification_preferences`, scoped by tenant and user; delivery consults it unless the type forbids opting out (`notifications/lib/shouldDeliver.ts:69-95`; `notificationPreferenceService.ts:12-15`). They must sign in to do it.
- **The lookup hash is unsuitable for a link.** With no secret configured it is an unkeyed SHA-256 (`packages/shared/src/lib/encryption/aes.ts:216-222`); with one, it equals `customer_users.email_hash`.
- **Public tokens are made two ways**: the auth module's, private to it (`auth/lib/tokenHash.ts:16-21`), and the forms module's stateless signed token with its own secret chain (`forms/services/distribution-token.ts:52-58, 93-112`).
- **Found on the way, not fixed here.** Inbox replies call Resend directly with `RESEND_API_KEY` and ignore the configured provider (`inbox_ops/api/proposals/[id]/replies/[replyId]/send/route.ts:169-175`). The workflow "send email" step resolves a service nobody registers and reports a simulated send (`workflows/lib/activity-executor.ts:915-941`). Both belong in issues.

## 📝 Proposed Solution

### Phase 1 — The send path carries headers

- `SendEmailOptions` gains `headers`. Only names on a short list are accepted — `List-Unsubscribe`, `List-Unsubscribe-Post`, `Auto-Submitted` — and values are sanitised; anything else is a programming error.
- The headers travel in the metadata the transport already passes, and each of the three system adapters maps them into its provider payload explicitly.
- The test capture records them.
- A header is added only when the application's public address is HTTPS. A test-only exception accepts HTTP on exact loopback hosts (`127.0.0.1`, `[::1]`, `localhost`) only when `OM_INTEGRATION_TEST=true`, `OM_TEST_MODE=1` and `OM_TEST_UNSUBSCRIBE_HTTP_MODE=loopback` all hold. Both environment blocks in `packages/cli/src/lib/testing/integration.ts` set that mode. No runtime `APP_URL` mutation or arbitrary HTTP origin is allowed; production ignores the mode. The visible link still works on ordinary HTTP deployments.

### Phase 2 — Form invitations

- The invitation email carries both headers and a visible link. The header points to a public API address; the link points to a public page. Both carry the same sealed token. When the email is sent, while the address is still on the invitation, the subscriber computes the recipient's suppression hash and seals it into the token with the tenant, the organization, the invitation id and the suppression key id.
- A `POST` to the API address — what a mail client sends, with a form-encoded body — opens the token, records the suppression for the organization it names from the hash it carries, and returns 200. It does not read the invitation. An invitation that was revoked, deleted or anonymized records the same as a live one, and a repeat is not an error.
- The page validates the token and shows what will stop and a button; the button posts. It names the organization through an optional DI-resolved organization read service, with generic translated text when unavailable; forms never reads another module's organization tables. It names the form only while the invitation still exists in the sealed tenant/organization scope.
- Add a forms-owned `invitationSuppressionService.checkSend` called first by `enqueueInvitationEmail` in `forms/subscribers/invitation-email.ts`, which sends inline despite its name. It scopes every lookup by tenant and organization. The create command records sent state only after successful dispatch. The resend command calls the same check **before** changing `status`, `sentAt` or `sendCount` and before emitting `forms.invitation.sent`; a skip preserves them, writes `lastError='recipient_opted_out'`, updates `updatedAt`, and emits no sent event. The subscriber checks again immediately before dispatch to cover a suppression created after the command check. A suppression-key mismatch records `lastError='suppression_key_mismatch'` with the same no-send/no-counter rule at the command check. Existing API `lastError` exposes the reason; translated UI labels show it. A suppression between resend acceptance and subscriber dispatch may still leave accepted counters; that race remains explicit, and lastError records the eventual skip. Do not claim atomicity with a public unsubscribe and an in-flight transport send.
- A form can be marked so that its invitations carry no unsubscribe and ignore the list.
- Staff with `forms.distribute` may request removal with an address. The route hashes it before dispatching any audited command; no raw request body, command input, snapshot or log may carry it. The route passes the hash and key id to the command's in-process handler only; the persisted command input, audit entry, snapshot and log carry tenant, organization, operation id, outcome and a found/not-found flag, never a hash or key id, as for the discard command. It is non-replayable/non-undoable. The response is always `{ ok: true }`, whether a row existed or not.

### Phase 3 — Notification email

- For a registered notification type with effective opt-out allowed and email eligible, and a recipient authorized for `notifications.manage_preferences`, add headers/link with a signed token over tenant, user, type and issue time (construction under API Contracts → Token secret). Use `rbacService.userHasAllFeatures` or the shared wildcard-aware policy matcher; never literal array membership. Without the feature, send the notification as before with no unsubscribe link.
- Both header construction and the public route share effective-type resolution with `shouldDeliver`: `nonOptOutOverride ?? type.nonOptOut`, `resolveEligibleChannels(type, channelsOverride)`, registered strategies and applicable target channels. An unregistered type, ineligible email or effective mandatory type gets no link and a previously issued token is a successful no-op. The public route also rechecks the recipient feature; loss of it makes an old link a no-op. It then sets that type's email channel to off — unless the preference was changed after the token was issued, in which case it does nothing. "Changed" means the `notification_preferences` row for that tenant, user, type and `channel = 'email'` has `updated_at` later than the token's `issuedAt`; an absent row has never been changed. So an old or forwarded email cannot undo a later choice.
- The user sees the change on their preferences page and can reverse it there.

### Design decisions

| Decision | Rationale |
|---|---|
| The form-invitation token is sealed and carries what the suppression needs | See assumption 6. The invitation can lose its address, or be removed, long before the link is used. |
| Its scope is trusted from the sealed payload | The access token's scope is re-derived from its row. This one has no row to rely on. Only the server can make one, and it can only add a suppression. |
| The token carries no expiry; it stays valid while its key is the current or the one previous secret | An unsubscribe link in an old email should keep working, and nothing it needs is kept outside it. It can only ever stop mail, and for notifications it cannot override a newer choice. One previous slot is kept, so a link survives one rotation of its secret and stops opening after a second; new mail always carries a fresh token. |
| `POST` changes state; the page asks first | Link scanners and previews fetch links. A `GET` that unsubscribed would act on their behalf. |
| The public routes do not refuse when the rate limiter is unavailable | A mail client posts once and does not retry. The signature is the control against abuse. |
| Each module builds its own headers | The capture then sees them, and no module needs another's tables. |
| Header names are restricted | A free-form header map on a public helper is a way to inject mail headers. |

### Alternatives considered

| Alternative | Why rejected |
|---|---|
| A shared suppression list checked in the mail transport | Needs a tenant on every send; would move form invitations onto tenant channels as a side effect; and the capture could not see it. |
| A header on every email | A password reset with an unsubscribe header invites a user to break their own account recovery. |
| A readable hash of the address in the link | See assumption 6. |
| A stored record per sent invitation, holding the hash for the token to name | Needs its own retention and erasure rules for a row that outlives the invitation. The sealed token keeps nothing. |
| `mailto:` unsubscribe | Needs an inbound mailbox per installation. |
| Delete a suppression with the subject's erasure | Invitations would resume to a person who objected; automatic erasure cannot match the purpose hash to the subject anyway. |
| Warning-only detection of a suppression key mismatch | Optional invitations would reach people who objected while the list looked intact. |
| A notification link for recipients who cannot manage preferences, reversed by an administrator | The user could switch off email they cannot switch back on themselves. |
| Rely on the provider's suppression list | Three providers, three behaviours, none visible to the tenant. |

### Known limits

- One-click works in a mail client only when the sending domain's DKIM signature covers the two headers. Whether each hosted provider (Resend, SES) and the SMTP path sign them is unverified until Phase 1 step 2 records each adapter's outcome in this section and in the deployment docs; an arbitrary SMTP relay may not. The visible link works regardless.
- A changed token secret makes links in mail already delivered unreadable. The previous secret may be supplied for opening and verifying them, so a link survives one rotation; after a second rotation it returns 400 and records nothing. The recipient still has the link in any later email and, for notifications, the preferences page.
- A changed suppression secret cannot rehash existing rows because no address is stored. A stored `key_id` makes this detectable: doctor reports mismatches, and optional invitation sends in that organization fail closed until the previous secret value is restored or an operator discards the mismatched rows (assumption 10). A discard loses those objections: the recipients may be invited again. Old-key links remain detectable and cannot silently reopen sending.
- Under R4-9 and assumption 11, the tenant-exit export writes `forms_invitation_suppressions` with both `recipient_hash` and `key_id` redacted as `key_material`, plus the row count. A receiving system cannot rebuild opt-outs from that metadata, even with the original suppression key. Suppression-state handover is not supported in this version; copying the redacted export does not preserve objections or provide automatic protection on a receiving installation.

## 📝 Delta

### Capability: email-unsubscribe

#### ADDED Requirement: Unsubscribe on form invitations
For an opt-out-allowed form, the system SHALL attach a one-click unsubscribe header when the public address is HTTPS (or the explicit loopback test exception applies), and a visible link. While the suppression key is unchanged it SHALL NOT send later invitations from that tenant/organization to a suppressed address. A detected key mismatch SHALL block optional invitation sends rather than silently invalidate objections, until the previous secret is restored or an operator deliberately discards the mismatched rows. A form explicitly marked mandatory bypasses this list. An already in-flight transport send cannot be recalled.

##### Scenario: Headers and link
- WHEN a form invitation is sent and the application's address is HTTPS
- THEN the message carries `List-Unsubscribe` and `List-Unsubscribe-Post`, and its body links to the unsubscribe page

##### Scenario: One click
- WHEN a mail client posts to the address in the header
- THEN the next invitation to that address from that organization is not sent and is marked as opted out

##### Scenario: After the invitation is gone
- WHEN the invitation was revoked, deleted or anonymized before the recipient's mail client posts to the address in the header
- THEN the suppression is recorded, and the next invitation to that address from that organization is not sent

##### Scenario: Concurrent posts
- WHEN two valid unsubscribe POSTs for one recipient race
- THEN both return 200 and one scoped suppression exists, using `ON CONFLICT DO NOTHING`

##### Scenario: Secret changed
- WHEN suppression rows exist with a different key id
- THEN doctor reports only counts and scoped optional invitation sends refuse with `suppression_key_mismatch`

##### Scenario: Discarding mismatched rows
- WHEN an operator runs `mercato forms discard-mismatched-suppressions` with `--apply` for one tenant and organization
- THEN only rows under other key ids in that scope are deleted, the output carries counts only, and optional invitation sends there resume

##### Scenario: Suppression metadata in a tenant export
- WHEN a tenant export includes `forms_invitation_suppressions`
- THEN both `recipient_hash` and `key_id` are null, the manifest names both `key_material` redactions and the table's row count, and the artifact cannot rebuild opt-outs on a receiving system under R4-9

##### Scenario: Suppressed resend
- WHEN staff resends to an already suppressed address
- THEN status, sentAt and sendCount remain unchanged, no sent event is emitted, and lastError is `recipient_opted_out`

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
The system SHALL let a staff user with `notifications.manage_preferences` turn off an eligible registered notification type's optional email from the email itself, without signing in. Mandatory/operator-overridden or unregistered types SHALL be successful no-ops.

##### Scenario: From the email
- WHEN a user's mail client posts to the address in a notification email
- THEN that type's email channel is off in their preferences and in-app delivery is unchanged

##### Scenario: A newer choice wins
- WHEN the user turned the email back on after the message was sent, and the old link is used
- THEN nothing changes

##### Scenario: No reversal permission
- WHEN the recipient lacks the preferences feature, including after token issuance
- THEN no new link is issued and an existing token does nothing; delivery itself remains unchanged

##### Scenario: A type that cannot be opted out of
- WHEN the notification type forbids opting out
- THEN its email carries no unsubscribe header, and a token for it does nothing

Frozen by: `packages/core/src/modules/notifications/__tests__/email-delivery-headers.characterization.test.ts`

## 📝 Architecture

- **`packages/shared/src/lib/email/send.ts`**: `headers` on the options, the allow-list and sanitising, the resolved payload, the capture.
- **`communication_channels/lib/system-email.ts`** and **`channel-resend`, `channel-ses`, `channel-smtp`**: carry and map the headers.
- **`forms`**: the sealed token, header and link in the invitation, the suppression entity, send-time/pre-resend checks, the public route and page, the staff removal route, the per-form switch, the mismatched-row discard command.
- **`notifications`**: headers and link in the email strategy, its public route and page.

| Touchpoint | Mechanism | Absent |
|---|---|---|
| Caller → mail | `sendEmail` options | No headers: as today |
| An adapter that does not map headers | — | The visible link still works; the step records which adapters map them |
| `customers` → unsubscribes | None in this version: no event is emitted, because no consumer is specified and an event id is frozen once released. A later integration with the 10-22 carrier adds the event with its payload and consumer together | Nothing recorded on a contact |

## 📝 Data Models

| Table | Columns |
|---|---|
| `forms_invitation_suppressions` | `id` UUID primary key, `tenant_id`, `organization_id`, `recipient_hash`, `key_id`, `source` (`one_click` \| `page`), `created_at`, `updated_at`. Unique on `(tenant_id, organization_id, key_id, recipient_hash)` |
| `forms_form` | `invitation_opt_out_allowed` boolean, default true |

Additive, with migrations and snapshots. No address is stored. The form's existing version is returned as `updatedAt` and its opt-out switch uses optimistic locking through the form API and editor. Suppression rows are append-or-remove internal records with no public edit form; staff removal by email remains a uniform idempotent action.

### Suppression hashing and rotation detection

A new `FORMS_INVITATION_SUPPRESSION_SECRET`, when set, is the source; otherwise use `getSecret()` from `forms/services/distribution-token.ts` (`FORMS_DISTRIBUTION_TOKEN_SECRET`, then `JWT_SECRET`). Derive a 32-byte key with HKDF-SHA-256, UTF-8 salt `open-mercato:forms-invitation-suppressions:v1` and info `recipient`. Compute HMAC-SHA-256 over `<tenant UUID>\n<organization UUID>\n<trimmed lowercase email>`, hex-encoded with prefix `fis1_`. This is **not** `hashForLookup`: that helper can fall back to unkeyed SHA-256 (`shared/lib/encryption/aes.ts:191-221`). The new service never does. No lookup secret is required; with no dedicated/forms/JWT suppression secret, refuse token creation and optional invitation dispatch with `suppression_secret_missing`; if hashing is configured but no sealing secret exists, refuse optional invitation dispatch with `unsubscribe_secret_missing`, never send an unprotected optional invitation or store an unkeyed digest. Mandatory forms can keep their existing send path.

`key_id` is the first 32 hex characters of HMAC-SHA-256 under the derived key over the fixed label `forms-suppression-key-check:v1`; it reveals no secret or address. Seal it alongside the hash in each unsubscribe token. Before a scoped optional send, test for any suppression row in that tenant and organization under another key id with an `EXISTS` query written as `key_id < :current OR key_id > :current`, so it is two range probes on the `(tenant_id, organization_id, key_id, recipient_hash)` unique index and stops at the first hit; full counts belong to the doctor check and the discard command. Any mismatch refuses with `suppression_key_mismatch`. A valid old-key token is still accepted when a previous token-decryption secret is configured: insert its old key id and hash, so it triggers the same protection. No raw address exists for automatic rehash. No automatic purge treats the list as empty; only the operator's explicit discard below removes mismatched rows. This table is outside **DEC-F — The B1 hand-offs** and **R3-12 — Fill commands for module-written hashes**, owned by [`2026-11-16-encryption-map-coverage-and-backfill.md`](2026-11-16-encryption-map-coverage-and-backfill.md), **Phase D — Lookup hashes and system-scope rotation**. That phase introduces `mercato customers fill-lookup-hashes`; it does not exist today. None of its three named fill commands covers this separately keyed suppression table.

**Resolving a mismatch.** The doctor check's `fix` line names two resolutions. First, set `FORMS_INVITATION_SUPPRESSION_SECRET` to the previously effective secret value. This loses nothing and also works after a `JWT_SECRET` or forms-secret rotation, because the dedicated variable wins. Because a routine `JWT_SECRET` rotation would otherwise block optional invitations, the configuration-tier doctor check `forms.invitation_suppression_secret_fallback` warns whenever the suppression key resolves from `FORMS_DISTRIBUTION_TOKEN_SECRET` or `JWT_SECRET` instead of `FORMS_INVITATION_SUPPRESSION_SECRET`, and the database-tier check `forms.invitation_suppression_secret_fallback_in_use` reports an error when that fallback resolves and the tenant already has suppression rows; both `.env.example` copies state that `JWT_SECRET` must not be rotated without first pinning its current value in `FORMS_INVITATION_SUPPRESSION_SECRET`. Rows recorded under the interim key then mismatch in their own organizations, so restore promptly. Second, when that value is lost, an operator runs `mercato forms discard-mismatched-suppressions --tenant <uuid> --organization <uuid> [--apply]`. It previews by default and prints counts only. With `--apply` it deletes, in one transaction, only the rows in that tenant and organization whose key id differs from the current one, through a non-undoable forms command whose input, audit entry and log carry tenant, organization and count only, never a hash or key id. It refuses with `suppression_secret_missing` when no current key can be derived. The discarded recipients' objections are lost and they may be invited again; the runbook says so. An old-key link used later records its row again and blocks that organization again.

### Privacy declaration, erasure and tenant exit

The hash is pseudonymous personal data, not anonymous configuration. The intended forms `privacy.ts.tables.forms_invitation_suppressions` entry uses the supported `kind`/`note` and per-column `reviewedColumns` shape from [`2026-11-16-privacy-table-coverage.md`](2026-11-16-privacy-table-coverage.md), **API Contracts**:

```ts
personalData: {
  kind: 'reference_only',
  note: 'Purpose-bound recipient identifier and minimal objection metadata; retained to continue honoring the objection after subject erasure; no address mapping',
  reviewedColumns: {
    id: 'Identifies the objection record',
    tenant_id: 'Scopes the objection to its tenant',
    organization_id: 'Scopes the objection to its organization',
    recipient_hash: 'Purpose-bound pseudonymous recipient identifier; no copied address or free text',
    key_id: 'Detects suppression-key mismatch; not a secret',
    source: 'Fixed one_click/page enum; no free text',
    created_at: 'Records objection creation time',
    updated_at: 'Records objection update time',
  },
}
```

C5's **Declarations and row subsets** and **Newly declared account and objection tables** explicitly support purpose-bound pseudonymous identifier-only objections with fixed source/time/key metadata and require reasons for all eight columns above. Its **API Contracts** rejects `reference_only.columns`; there is no optional identifier-column list. C5's identifier-only declaration support and its passing new-table guard remain E3 Phase 2 delivery gates. The new table cannot enter the initial-backlog ceiling or be waived by `tableExports`.

Subject erasure leaves the suppression unchanged under assumption 8; retention is indefinite until recipient-requested removal, tenant deletion or assumption 10's discard of mismatched rows, with no age pruner. This is a documented limit, not a legal claim that every deployment must retain forever. `forms_invitation_suppressions.recipient_hash` is neither `forms_invitation.recipient_email_hash` nor a subject id under **DEC-A — Subjects known only by an identifier (`privacy:identifier`)**, owned by the contract's **A subject that is only an identifier** section. Content-AI coverage still clears the invitation's ordinary lookup hash, token hash and last error; neither its sensitive-mode anonymization nor its erasure mode deletes suppression rows. Automatic by-subject export/erasure cannot match these purpose hashes to ordinary email aliases or the `idv1_` subject id. State this unmatched retained-state limit; do not invent a per-subject retained-row count or a new `PrivacyRetainReason`. Unchanged suppression rows add no `historyRecords` under **R3-1 — The audit-history rule for every erasure** and **DEC-B — The audit-history strip routine**, owned by [`2026-11-16-privacy-subject-erasure.md`](2026-11-16-privacy-subject-erasure.md). The changed-record history mappings in Content-AI coverage still apply.

In the separate `tableExports` member, declare `forms_invitation_suppressions` with a forms-owned `reader` implementing C8's `PrivacyTableReader` and `redact: [{ columns: ['recipient_hash', 'key_id'], reason: 'key_material' }]` (C8's array of `{ columns, reason }` groups), applying **R4-9 — Suppression state in a tenant export** as specified in [`2026-11-16-tenant-exit-export.md`](2026-11-16-tenant-exit-export.md), **Declarations → Forms suppression metadata**, **The declaration guards** and **Declarations — `@open-mercato/shared/modules/privacy`**, and [`2026-11-16-privacy-table-coverage.md`](2026-11-16-privacy-table-coverage.md), **Newly declared account and objection tables**. Both columns are null in exported rows; other scalar columns retain the minimal objection metadata under normal guards. The manifest names both redacted columns and their `key_material` reason and records the table's row count. R4-9 removes the C5 **SUPPRESSION-EXPORT** reviewed-checksum exception: neither `recipient_hash` nor its fixed key-check identifier qualifies, and `reviewedChecksums` cannot bypass either redaction. Ordinary mapped and module-written lookup hashes remain redacted as `key_material` or excluded. The recipient digest is pseudonymous personal data, never a scalar checksum or anonymous value. A receiving system cannot rebuild opt-outs from the artifact, even with the original suppression key. There is no suppression-state handover in this version and no import or safe-resumption guarantee; send-time mismatch refusal remains. Export declarations and coverage are separate under **DEC-G — The tenant-export reader and its declarations**. The registry/collectors follow **R3-2 — The registry carries the whole `privacy.ts` default export** in [`2026-11-16-privacy-data-class-contract.md`](2026-11-16-privacy-data-class-contract.md), **Export shape**; no generator special case.

[`2026-11-16-privacy-coverage-content-ai.md`](2026-11-16-privacy-coverage-content-ai.md), **Invitation objections and activity attribution**, records the table and unmatched retained-state limit in the forms coverage map, alongside **The forms erasure mode**; E3 Phase 2 ships the declaration itself. R4-9 governs that carrier's export citation and this spec's assumption 11: a forms-owned reader, both columns redacted, a row count and no suppression-state handover or checksum exception. C5's identifier-only declaration support and new-table gate remain delivery prerequisites; the supported declaration shape above follows C5's API Contracts.

Forms owns `doctorChecks` in its `privacy.ts`, consuming **DEC-I — The doctor's extension point** and **R3-4 — An opt-in database tier for the doctor** from [`2026-11-16-privacy-doctor-cli.md`](2026-11-16-privacy-doctor-cli.md), **Extension point**, **R3-4 — An opt-in database tier for the doctor** and **API Contracts**. Declare stable configuration check ids `forms.invitation_suppression_secret_missing` and `forms.invitation_unsubscribe_secret_missing` for the two independent secret chains, and `forms.invitation_suppression_secret_fallback`, a warning when the suppression chain resolves to a fallback rather than its dedicated variable; each checks only which variable resolved and never emits secret values. Declare `forms.invitation_suppression_secret_fallback_in_use` with `needs: 'database'`, an error when the fallback resolves and counter `suppression_rows` on the same counting service is above zero for the tenant. Declare stable id `forms.invitation_suppression_key_mismatch` with `needs: 'database'` and forms-owned `countServices: { 'forms.invitation_suppressions': ({ em }) => countingService }`. The factory receives only the read-only transaction-bound `EntityManager` and exposes only the doctor's `count({ tenantId, counter }): Promise<number>` method; counter `suppression_key_mismatch` counts forms-owned suppression rows in that tenant, across its organizations, whose key id differs from the current suppression key. Counter `suppression_rows` counts all of that tenant's suppression rows, for the fallback-in-use check. Derive that key id lazily from the same configured secret chain as send-time checks, never from a database baseline. If no current key can be derived, the check fails with a bounded error surfaced by the runner as `doctor.check_failed`, never a zero count. Resolve it through `resolveCountingService('forms.invitation_suppressions')`; the doctor does not run general module `di.ts` registrations. No hashes, key ids, recipient values or row ids leave the check. Configuration-only runs list the database check as `database_not_requested` and cannot claim there are no mismatched rows. C1 **Phase 1 — Contract and discovery** and doctor **Phase 3 — Extension point**, including its R3-4 database runner, must ship before these declarations; forms does not bootstrap the application or introduce its own runner.

## 📝 API Contracts

| Route | Auth | Behaviour |
|---|---|---|
| `POST /api/forms/public/invitation-unsubscribe?token=…` | None | Empty body or form-encoded `List-Unsubscribe=One-Click` (mail client) or `source=page` (confirmation form); maximum 1,024 bytes; opens/validates token, inserts scoped hash/key id with `ON CONFLICT DO NOTHING`, never reads invitation; uniform 200 for valid token, 400 invalid payload/token, 413 oversized, 415 unsupported media type |
| `GET /api/forms/public/invitation-unsubscribe?token=…` | None | Returns the organization's name, and the form's title while the invitation exists, for the page; changes nothing |
| `POST /api/forms/invitation-suppressions/remove` with `{ email }` | `forms.distribute` | Validate, hash and derive the current key id in memory, then dispatch the command with tenant, organization and an opaque in-process lookup handle; the command input, audit entry, snapshot and log carry tenant, organization, operation id, outcome and a found/not-found flag only, never the hash or key id, as for the discard command; non-replayable/non-undoable; uniform `{ ok: true }` for present/absent row |
| `POST /api/notifications/public/unsubscribe?token=…` | None | Same bounded body/token validation as forms; share effective-type resolution with delivery and recheck feature/newer preference; valid token returns 200 including no-op |

- **Pages**: `/forms/unsubscribe` and `/notifications/unsubscribe`, public, with locale keys.
- **Token secret**: forms `FORMS_INVITATION_UNSUBSCRIBE_SECRET` falls back to the existing forms secret chain (`FORMS_DISTRIBUTION_TOKEN_SECRET`, then `JWT_SECRET`; `distribution-token.ts:52-58`); HKDF-SHA-256 with label `forms-invitation-unsubscribe-v1` derives its sealing key, separately from suppression hashing. The payload is sealed with the shared AES-GCM helper (`encryptWithAesGcm` / `decryptWithAesGcm`, `packages/shared/src/lib/encryption/aes.ts:80, 140`), which draws a fresh nonce for every call, and is encoded for a URL. Notifications use `NOTIFICATIONS_UNSUBSCRIBE_SECRET`, falling back specifically to `JWT_SECRET`; a missing chain disables link issuance with a bounded warning, never an unsigned token. Whichever secret resolves, derive the signing key with HKDF-SHA-256 and label `notifications-unsubscribe-v1`, never using the raw secret. The token is `base64url(canonicalJson({ v: 1, tenantId, userId, typeId, issuedAt }))` + `.` + `base64url(HMAC-SHA-256(key, payloadBytes))`, with `issuedAt` in epoch seconds and keys in that fixed order. Verification recomputes the MAC and compares it with `crypto.timingSafeEqual`, trying the current then the previous key, and rejects any other version, extra key or forms-purpose token before reading the payload. Previous read-only slots are `FORMS_INVITATION_UNSUBSCRIBE_PREVIOUS_SECRET` and `NOTIFICATIONS_UNSUBSCRIBE_PREVIOUS_SECRET`; no previous suppression secret slot or automatic rehash is implied. Zod validates query `{ token }` as a non-empty URL-safe string at most 4,096 bytes and the opened payload (UUID scope, bounded hash/key id/type/source/issue time) before any write. The notification route takes tenant and user only from the verified payload and scopes the preference write to them, so a token from one tenant can never change another tenant's row. Do not put raw tokens, request bodies or decrypted payloads in logs. The staff email schema is Zod email with a bounded size; error/audit responses never echo it.
- **Command**: `mercato forms discard-mismatched-suppressions --tenant <uuid> --organization <uuid> [--apply]`, as under **Resolving a mismatch**. Preview by default; counts only; no hash, key id or address in output.
- **Type**: `SendEmailOptions.headers?: Partial<Record<'List-Unsubscribe' | 'List-Unsubscribe-Post' | 'Auto-Submitted', string>>`. Additive. `sendEmail`'s return type does not change.
- **Rate limits**: `readEndpointRateLimitConfig('UNSUBSCRIBE_PUBLIC', { points: 30, duration: 60, blockDuration: 60, keyPrefix: 'unsubscribe-public' })`; documented variables `RATE_LIMIT_UNSUBSCRIBE_PUBLIC_POINTS`, `RATE_LIMIT_UNSUBSCRIBE_PUBLIC_DURATION`, `RATE_LIMIT_UNSUBSCRIBE_PUBLIC_BLOCK_DURATION` and `RATE_LIMIT_TRUST_PROXY_DEPTH`. Before token parsing, key each forms GET, forms POST and notifications POST (and their confirmation pages) by route/method plus trusted client IP; without a trusted IP, use a route-local SHA-256 digest of the opaque token, never an email. Namespaces are `forms-unsubscribe:get`, `forms-unsubscribe:post`, `notifications-unsubscribe:post`; no raw IP/token in diagnostics. A healthy limit returns 429 with Retry-After. For these routes only, missing/degraded/throwing limiter logs/reports a bounded warning and continues to token validation. Existing `forms/api/public/rate-limit.ts` fails closed; keep it unchanged and add a dedicated helper over the same limiter service. Token authentication, bounded inputs and uniform responses remain mandatory during an outage.
- **Environment docs**: add the three dedicated current secrets, the two previous-token secret slots, `JWT_SECRET` fallback comments (including the rule not to rotate `JWT_SECRET` without pinning its value in `FORMS_INVITATION_SUPPRESSION_SECRET`) and the named rate-limit variables to `apps/mercato/.env.example` and `packages/create-app/template/.env.example` in the same change with `yarn template:sync:fix`. Document suppression-key stability, fail-closed mismatch and its two resolutions. `OM_TEST_UNSUBSCRIBE_HTTP_MODE` is test-only and set only in the integration environment, never offered as a production option.

## 📝 Edge Cases & Failure Scenarios

| Case | Behaviour |
|---|---|
| A form-invitation token that cannot be opened: tampered, another purpose, or an unknown secret | 400; nothing changes; the page says the link could not be read and nothing was recorded |
| A notification token with a bad signature | 400; nothing changes |
| The same link used twice, including concurrent POSTs | Uniform 200; scoped unique insert uses `ON CONFLICT DO NOTHING` |
| The invitation was revoked, deleted or anonymized | 200; the suppression is recorded from the token; the page names the organization and not the form |
| The application's address is HTTP | No header; the visible link is still added |
| Suppression key changes | Old hashes cannot be rebuilt; key ids make mismatches visible to database-tier doctor and block optional sends in that organization until the previous secret value is restored or the mismatched rows are discarded |
| An old-key link is used after a discard | The row is recorded; optional sends in that organization refuse again until the next resolution |
| A recipient unsubscribes and is invited again | Not sent; the invitation shows why; staff can remove the suppression at the recipient's request |
| Operator makes a type mandatory, removes email eligibility or unregisters it | Shared effective-type resolver makes old link a 200 no-op; no new headers/link |
| A user in two tenants | The token names the tenant; only that tenant's preference changes |
| An email forwarded to someone who clicks | For a form invitation, the original recipient is unsubscribed; reversible by staff. For a notification, the type's email is turned off unless the user has changed it since |

## 📝 Migration & Backward Compatibility

Contracts are additive: optional header field, suppression table and metadata, form switch, four routes, two pages and one CLI command. No event is added. The suppression default changes optional invitation delivery after a recipient opts out; the required-form escape switch and durable objections are documented. A caller that passes no headers sends exactly what it sends today. Form invitations keep the sending path they have. A third-party adapter that does not map the headers keeps working.

## 📋 Phasing

| Phase | Outcome | Ships alone |
|---|---|---|
| 1 | Headers through the send path and the three adapters | Yes |
| 2 | Form invitations, including the `forms_invitation_suppressions` privacy and `tableExports` declarations | After Phase 1, C1 Phase 1 with C5 identifier-only declaration support and passing new-table guard, doctor Phase 3 including the R3-4 database tier, C4/C8 delivery with R4-9 suppression redactions and row count, and Content-AI Phase 1's existing forms coverage (the forms data class and its two anonymize modes). E3 Phase 2 is the single owner of the suppression table's declaration, export redaction and their tests; Content-AI Phase 1 does not ship them, so neither phase waits on the other for this table |
| 3 | Notification email | Yes, after Phase 1 |

## 📋 Implementation Plan

### Phase 1
1. Add `headers` to the send options with the allow-list and sanitising, to the resolved payload and to the capture. Unit tests, including a refused name and a value with a line break.
2. Carry them through `sendSystemEmail`. For each of the three adapters, confirm from the SDK that custom headers are accepted, map them, and unit-test the provider payload. Record here, under Known limits, and in the deployment docs any adapter that cannot, and whether the provider's DKIM signature covers them.

### Phase 2
1. The sealed token and the table-specific hash/key id. Unit tests `invitation-unsubscribe-token.test.ts` and `invitation-suppression.test.ts`: no lookup secret still produces a keyed purpose-bound digest from the forms/JWT chain; no secret refuses optional sends; normalization and tenant/organization separation; stable/different key ids; old-key rows block sends and doctor reports counts; round trip; tampering; another purpose; previous secret; a link after two secret rotations returns 400 and records nothing; two tokens for the same invitation differ; the encoded token contains neither the address nor the hash in readable form.
2. Entity/UUID/version migration and the sole delivery of the table's privacy and tableExports declarations, using C5's supported classification with all eight reviewedColumns reasons and C8's forms-owned reader; guard tests require both `recipient_hash` and `key_id` redacted as null with their manifest `key_material` reason and row count under R4-9/assumption 11, and reject a `reviewedChecksums` bypass for either column. They also pin the declaration itself: the `source` column accepts only `one_click`/`page` and a row holds no copied address, name or free text; the C5 guard rejects a `reference_only.columns` member; no baseline or ceiling identity is added for the table, and a `tableExports` entry alone does not satisfy coverage. A test proves both Content-AI anonymize modes leave suppression rows unchanged, and that a forms erasure run reports the unmatched retained-objection limit with no fabricated per-subject counts and no suppression identity in `historyRecords` or `retainedRecords`. Add the five named doctor checks and lazy count-service factory; unit tests pin configuration-only no-database behavior, both missing secret chains, the fallback warning and its error with existing rows, tenant-only counts, unavailable current key and factory failure. Unit-test that the send-time mismatch query stops at the first other-key row without counting. Add checkSend in enqueueInvitationEmail and before resend stamps. Unit tests: suppressed resend preserves status/sentAt/sendCount and emits no sent event; recheck at subscriber dispatch; required form bypasses suppression/key mismatch and has neither headers nor link; optional send with key mismatch refuses. Add `mercato forms discard-mismatched-suppressions` and the doctor check's two-resolution `fix` line; unit tests: preview writes nothing, `--apply` deletes only other-key rows in the named tenant and organization, output, audit and logs carry counts only, no current key refuses, and optional sends in that scope resume afterwards.
3. Public route/page, staff hash-before-audit command and optimistic-lock form switch; no new event. Unit suites `unsubscribe-routes.test.ts`, `unsubscribe-audit.test.ts` and `unsubscribe-rate-limit.test.ts` for body/query validation (400/413/415), concurrent duplicate posts, trusted-IP/fallback keys, healthy limit 429 and limiter outage continuation; assert log, command payload, audit entry and snapshots contain no email, recipient hash or key id (a recursive search over every captured value) and removal response matches for present/absent. Unit tests also include three tokens whose invitation is revoked, has a null `recipient_email` after anonymization, or no longer exists: each `POST` records the suppression for the organization in the token, and the `POST` handler does not query `forms_invitation`. A token that cannot be opened returns 400 and records nothing.
4. Headers/link in template, dedicated secrets/rate-limit environment docs with template sync; loopback test exception and both integration environment blocks. Unit test it is inert in production/non-loopback. Mandatory TC-EMAIL-UNSUB-001 and 002, including mandatory-form switch, stale form conflict and 002's tenant-export assertions: both `recipient_hash` and `key_id` written as null, both `key_material` redactions named in the manifest, the row count, and an artifact that cannot rebuild opt-outs.

### Phase 3
1. **Characterize** today's notification email: no headers. Commit alone.
2. The token; headers and link for opt-out-able types; the public route with the newer-choice rule; the page. Update the characterization test. Unit suite `notification-unsubscribe.test.ts` for tampered payload and MAC, a forms-purpose token, a token signed with the previous secret, one after two rotations (400), cross-tenant replay against a second tenant's row, an absent email-channel row versus a row updated after `issuedAt`, operator non_opt_out override both true/false, eligible-channel override, unregistered type, wildcard feature grant and absent/revoked feature, newer preference and unchanged in-app delivery; both header decision and route use the same resolver.
3. Integration test TC-EMAIL-UNSUB-003; docs, including the DKIM note; file the two issues named under Problem Statement.
4. Archive this Delta into `.ai/specs/capabilities/email-unsubscribe.md` if that directory has been adopted by then.

| File | Action |
|---|---|
| `packages/shared/src/lib/email/send.ts` | Modify |
| `packages/core/src/modules/communication_channels/lib/system-email.ts`; `packages/channel-{resend,ses,smtp}/src/modules/*/lib/*` | Modify |
| `packages/core/src/modules/forms/{cli.ts,subscribers/invitation-email.ts,services/*,commands/invitation.ts,data/entities.ts,data/validators.ts,privacy.ts,migrations/*,api/public/invitation-unsubscribe/route.ts,api/invitation-suppressions/remove/route.ts,frontend/forms/unsubscribe/*,i18n/*}` | Create / modify |
| `packages/core/src/modules/notifications/{lib/strategies/email-delivery-strategy.ts,api/public/unsubscribe/route.ts,frontend/notifications/unsubscribe/*,i18n/*}` | Create / modify |
| `packages/cli/src/lib/testing/integration.ts`; app/template `.env.example`; forms/notifications unit tests and `__integration__/TC-EMAIL-UNSUB-00{1,2,3}.spec.ts` | Modify / create |

## 🧪 Integration Coverage

Emails are read from the test capture file, which records headers after Phase 1 because callers supply them. Each test creates its own tenant, organizations, user/ACL and form/notification fixtures through APIs; it removes suppressions, preferences, invitations/distributions/forms and test users in finally. No seeded records. The lane sets the three loopback-test predicates in both server/test environment blocks; parse captured header URLs and post to the same loopback origin. No test changes APP_URL at runtime.

| Test | Covers |
|---|---|
| TC-EMAIL-UNSUB-001 | Under explicit loopback HTTP test exception, own form invitation carries both headers and body link; own password-reset email carries neither; production/non-loopback HTTP rejection is unit-tested |
| TC-EMAIL-UNSUB-002 | Fetching the page records nothing; a form-encoded `POST` to the header's address returns 200; a second invitation to the same address is not captured and the invitations API shows it as opted out; an invitation from a second organization is captured; staff removal returns the same response for existing/absent suppression and restores sending without an address in its audit entry; the page renders and its button works. Re-suppress, resend through the invitation API and assert no capture, unchanged status/sentAt/sendCount, and lastError recipient_opted_out. Set invitationOptOutAllowed=false through forms API and editor; invitation to this suppressed address is captured without either header or body link, and stale editor save conflicts. Restore switch. Anonymized first: an invitation to a second address is captured, a submission is started with its raw token (`startPublicSubmissionOrThrow`) and anonymized through `POST /api/forms/submissions/:submissionId/anonymize`, and only then is its header address posted; it returns 200, and the next invitation to that address is not captured and shows as opted out. Revoked first: the same for a third address whose invitation is revoked through `DELETE /api/forms/distributions/:distributionId/invitations/:invitationId` before the post. Concurrent valid POSTs both return 200 with one row. Test tenant-exit export uses the registered forms-owned reader, writes both recipient_hash and key_id as null, names both columns and their key_material reason in the manifest, reports the suppression row count, keeps the remaining minimal metadata and rejects a reviewedChecksums bypass for either column; the redacted artifact cannot rebuild opt-outs or transfer suppression state under R4-9. Subject erasure leaves suppression rows unchanged under assumption 8 and reports the unmatched-state limit without fabricating per-subject retained counts, `historyRecords` or `retainedRecords`. The test removes its suppressions through the staff route, then its distributions and forms |
| TC-EMAIL-UNSUB-003 | Own recipient with wildcard preferences grant gets notification headers; public page confirmation renders and posts; posting to its address turns that type's email off in `GET /api/notifications/preferences`; the next notification of that type is created in-app and no email is captured; after the user turns it back on, the old link changes nothing. Operator mandatory/channel override, unregistered type and missing/revoked preference feature yield no link or 200 no-op without changing in-app delivery |

The HTTP lane uses only the specified loopback exception. A missing mode fails this lane configuration; it does not silently omit header assertions. No external provider is needed because the caller capture records headers.

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
- **Mitigation**: Stable purpose-bound suppression secret, a doctor warning (and an error once rows exist) while it still resolves from the forms or JWT fallback, stored key id, database-tier doctor counts and send-time fail-closed mismatch; old-key token carries its key id. The upgrade notes and runbook describe restoring the previous secret value and the explicit discard; there is no automatic rebuild.
- **Residual risk**: Without the old secret no tool can rehash rows. Optional invitation availability is lost in affected organizations until the previous secret value is restored or an operator discards the mismatched rows. A discard loses those objections; nothing silently resumes suppressed mail. A send already in flight before a new suppression/key change can still complete. Suppression hashes are outside the mapped-lookup rotation owned by B1 Phase D (DEC-F, R3-12).

#### A forged token suppresses an address
- **Scenario**: Someone builds a token for an organization and address of their choosing, since its scope is trusted from its payload.
- **Severity**: Medium
- **Affected area**: invitations to one address in one organization
- **Mitigation**: Authenticated encryption with a key derived from a server-only secret; a token that cannot be opened records nothing; the effect is one suppression, visible on the skipped invitation and removable by staff.
- **Residual risk**: A leaked forms token secret lets anyone add suppressions in any organization until it is rotated. The previous-secret slot makes rotation possible without breaking links already sent.

#### A receiving system cannot rebuild opt-outs
- **Scenario**: A controller expects the tenant export to preserve recipient objections on a receiving system.
- **Severity**: High
- **Affected area**: recipients who opted out of form invitations in the exported tenant
- **Mitigation**: R4-9 redacts both `recipient_hash` and `key_id`, includes the row count and states the absence of suppression-state handover in the known limits and export contract.
- **Residual risk**: The artifact cannot rebuild the opt-outs, even with the original suppression key; it offers no automatic protection or safe-resumption guarantee on the receiving system.

#### Mail-header injection through the new field
- **Scenario**: A caller passes a value built from user input.
- **Severity**: Medium
- **Affected area**: outgoing mail
- **Mitigation**: A closed list of names; values sanitised; both callers build values from a token and the application's own address.
- **Residual risk**: Low.

## Final Compliance Report — 2026-11-17 (revised)

- **Reviewed:** root `AGENTS.md`, `.ai/specs/AGENTS.md`, `BACKWARD_COMPATIBILITY.md` for the exported type. Not reviewed: the `forms`, `notifications` and `communication_channels` guides in full.

| Rule | Status | Notes |
|---|---|---|
| Provider code stays in provider packages | Compliant | Each adapter changes in its own package |
| No cross-module table access | Compliant | Each module keeps its own list or preference |
| Validate inputs with zod; public routes rate-limited | Required delivery gate | Query/payload/body limits and type schema; dedicated limiter keys and explicit outage behavior |
| No hard-coded strings | Compliant | Pages and links use locale keys |
| Tenant scoping | Compliant | Tenant and organization on the row, taken from the sealed form-invitation token, which only the server can make; tenant in the notification token |
| Stable signatures unchanged | Compliant | `sendEmail` keeps its return type |
| Integration coverage | Required delivery gate | Three mandatory loopback-lane tests; suppression/resend, required-form switch, public pages, header capture and scoped cleanup |
| Privacy coverage and tenant exit | Required cross-owner handoff | C5-supported identifier-only classification with all eight reviewedColumns reasons, deliberate unmatched retention and separate tableExports with a forms-owned reader; R4-9/assumption 11 redacts both recipient_hash and key_id as key_material, names both in the manifest and includes the row count; no reviewed-checksum exception, suppression-state handover or opt-out rebuild on a receiving system |
| Optimistic locking | Required delivery gate | Form switch uses updatedAt and shared conflict UI |

**Verdict:** Phase 1 is a proposed additive transport change. Assumptions 1, 8 and 10 are decided. Phase 2 waits only on the C1/C5/doctor/C4/C8 and Content-AI Phase 1 forms-coverage prerequisites in Phasing, and itself ships the suppression declaration and export redaction. C5's identifier-only classification is specified. R4-9 resolves assumption 11: the export redacts both `recipient_hash` and `key_id`, includes the row count and has no suppression checksum exception. A receiving system cannot rebuild opt-outs; suppression-state handover is not supported in this version. Each phase ships through ordinary maintainer review once its prerequisites land.

## Changelog

### 2026-11-16
- Written autonomously with resolved assumptions.
- Revised after independent review. Messages to an outside address and message copies are out: they are correspondence, or have no preference to switch. Suppression of form invitations moved into the forms module, because invitations carry no tenant at send time and a transport-level check would have rerouted them and been invisible to the test capture. Links now name an invitation or a preference, never a hash of an address. Headers are a closed list. The header and the visible link use different addresses with one token. The notification link cannot undo a newer choice. The legal framing is stated as good practice, and the three phases ship separately.
- Council review (Opus, GPT-5.6 Sol, DeepSeek V4 Flash, Kimi K3.1 Pro), high fixes: g6-02 — an unsubscribe no longer depends on the invitation row, whose address the daily retention run removes. The form-invitation token is now sealed with a key derived for the purpose and carries the tenant, organization, invitation id and the recipient's suppression hash computed at send time, so a revoked, deleted or anonymized invitation still records the suppression. Assumption 6, Phase 2, design decisions, known limits, a new Delta scenario, API contracts, the token secret, edge cases, unit tests, TC-EMAIL-UNSUB-002, a new risk entry and the tenant-scoping row are updated.

- Council round two fixes (GPT-6.1 Sol workers): r9-04 — UUID/privacy/retention/export declaration; r9-05 — keyed suppression secret without lookup fallback; r9-09 — loopback-only test headers; r9-10 — key-id detection and send refusal; r9-17 — named send check and resend counters; r9-18 — hash before audit and uniform removal; r9-24 — bounded body/query validation; r9-28 — mandatory-form tests; r9-29 — effective notification eligibility; r9-30 — named limiter keys/outage behavior; g6-34 — conflict-safe insert; g6-35 — reversible preference feature gate; named all secret slots and environment/template work.
- Council round two fixes, pass two (GPT-6.1 Sol workers): aligned eventual invitation anonymization with the forms mode/notice/hold gates; corrected the coverage declaration shape and recorded its owner amendment; defaulted tenant export to C8 recipient-hash redaction with an explicit portability limit; distinguished suppression digests from aliases, subject ids and changed-row history; specified forms-owned doctor checks and lazy aggregate factory under the exact shared decisions.
- Council round two fixes, pass three (GPT-6.1 Sol workers): recognized C5's delivered identifier-only classification design; resolved the C5/C8 suppression-export conflict to assumption 11's explicit redaction default and manifest assertions; aligned Content-AI's current section, stable forms doctor declarations and exact C1/doctor delivery gates; kept the original-key requirement for any separately approved digest-export fallback.
- Council round two fixes, pass four alignment (GPT-6.1 Sol workers): aligned assumption 11 and delivery gates with C8's current recipient-hash redaction contract and forms-owned reader, removed references to its withdrawn suppression exception, supplied C5-supported review reasons for all eight objection columns, and recognized Content-AI's already-aligned export paragraph; retained confirmation, original-key/mismatch limits and the outstanding C5 owner conflict.
- Council round two fixes, pass five gap closing (GPT-6.1 Sol workers): applied R4-9 to redact both suppression recipient_hash and key_id with a row count; resolved assumption 11 and aligned declarations, known limits, scenario, tests, risk, delivery gates and compliance with no suppression-state handover or receiving-system opt-out rebuild.
- Council round two fixes, pass six final fixes (GPT-6.1 Sol workers): aligned assumption 11 and the tenant-exit paragraph's R4-9 citations with the normative tenant-export Forms suppression metadata and table-coverage Newly declared account and objection tables sections.

### 2026-11-17
- E3 Phase 2 is the single owner of the suppression table's privacy and tenant-export declarations and waits only on Content-AI Phase 1's existing forms coverage, removing the phase-order cycle.
- Specified the notification token (HKDF key, canonical HMAC-SHA-256 payload, base64url, constant-time check, per-email-channel `updated_at` freshness), reworded token lifetime to one previous secret, added the suppression-secret fallback doctor finding, an `EXISTS` mismatch check and hash-free removal logging.
- Dropped the unconsumed `forms.invitation.unsubscribed` event and qualified the DKIM statement as unverified until Phase 1 records it.
- Phase 2 now carries every suppression test that Content-AI Phase 1 no longer ships: the `source` enum, the C5 guard's rejection of `reference_only.columns`, no baseline/ceiling identity, the forms run's unmatched-limit report with no fabricated counts or history, and the tenant-export redaction assertions in TC-EMAIL-UNSUB-002.
- The suppression `tableExports` declaration uses C8's array form, `redact: [{ columns: ['recipient_hash', 'key_id'], reason: 'key_material' }]`; the compliance report is dated 2026-11-17 (revised).
