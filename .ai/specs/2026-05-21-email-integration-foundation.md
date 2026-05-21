# Email Integration Foundation (Per-User, Multi-Provider)

## TLDR

**Key Points:**
- New `email` module + three provider workspace packages (`email-gmail`, `email-microsoft`, `email-imap`) deliver per-user email account linking, send, and receive primitives.
- Foundation only: no CRM hooks, no inbox UI, no message-body persistence. A follow-on CRM spec consumes the canonical events and decides storage.

**Scope:**
- Per-user OAuth linking for Gmail and Microsoft 365 / Outlook.
- Per-user IMAP+SMTP credential linking for everything else.
- Polling-based inbound sync (5-min default), emits `email.message.received` event.
- `sendAsUser(accountId, message)` outbound primitive — sends from the user's mailbox; existing Resend pipeline untouched.
- User Settings → Email Accounts UI (connect / rename / primary / reconnect / disconnect).
- Admin debug view for tenant-wide account health (no content access).
- Per-provider Marketplace Integration entries (additive to existing Integration Marketplace).

**Concerns:**
- OAuth client flow does not yet exist in the codebase; this spec introduces it. State-cookie pattern borrowed from `packages/enterprise/src/modules/sso/lib/state-cookie.ts`.
- The existing Integration Marketplace is tenant-scoped only. This spec intentionally does NOT extend `integration_credentials`; it adds a separate per-user credential store (`email_account_credentials`) to keep tenant-vs-user secret leakage impossible by construction.
- Sending real emails as a user from a provider's API can affect their personal Sent folder and deliverability reputation. Mitigation: explicit per-account opt-in via UI flow; no automatic enrolment.

---

## Overview

Open Mercato today has **outbound-only, Resend-only** email (~15 transactional flows: auth, MFA, notifications, sales, onboarding, payments, portal, messages). Inbound exists only inside `inbox_ops`, which uses webhook-delivered emails to a per-tenant shared address and parses them into action proposals — not a general per-user mailbox integration.

The product needs each logged-in user to connect their own email account (Gmail, Microsoft 365, or any IMAP/SMTP provider) so that, in a follow-on CRM specification, sent and received emails can be attached to customers, deals, and conversations. This spec delivers the **enabling infrastructure** as an independently shippable PR before the CRM integration is designed.

> **Market Reference**: HubSpot Sales (Gmail/Outlook OAuth + IMAP fallback), Pipedrive Smart Email BCC + Gmail/Microsoft integration, Salesforce Inbox, Front (HelpScout-style per-user inbox sync). Adopted: per-user OAuth model, provider-abstracted contract with provider-specific metadata escape hatch, polling-as-baseline (push-as-future). Rejected: BCC-only "smart forward" patterns (lossy, depends on user discipline) and shared system mailbox patterns (don't address the per-user requirement).

## Problem Statement

1. **No per-user email accounts.** Every outbound email today is sent from a single Resend identity. Users cannot send from their own mailbox; recipients see the system address, replies don't land in the user's Sent folder, and there is no concept of "this email was sent by Jane to John."
2. **No inbound email.** Inbound only exists for `inbox_ops`'s tenant-shared address, parsed by an LLM for action proposals. There is no infrastructure for a user's mailbox to be polled, no canonical inbound-message event, and nothing for downstream modules (notably CRM) to subscribe to.
3. **No provider abstraction.** The single Resend integration is hardcoded across 15+ call sites. Adding a second provider (Gmail send, Microsoft Graph send, SMTP send) would require a new abstraction layer that does not exist.
4. **No third-party OAuth client flow.** The codebase has user-SSO OAuth (enterprise SSO module) but no infrastructure for Open Mercato acting as a *client* of a third-party identity to obtain that user's access+refresh tokens. We can borrow the SSO state-cookie helper, but the actual flow needs to be built.
5. **Integration Marketplace is tenant-scoped only.** All current `integration_credentials` rows are keyed by `(organization_id, tenant_id)`. Per-user accounts need a parallel store with strict per-user isolation.

## Proposed Solution

A new core module `@open-mercato/core/modules/email` orchestrates per-user email accounts, delegates provider-specific operations to dedicated workspace packages (`@open-mercato/email-gmail`, `@open-mercato/email-microsoft`, `@open-mercato/email-imap`), and exposes a stable canonical-message contract for downstream consumers (CRM, future inbox UI).

**Approach: thick core + provider extension hook ("Approach C" from brainstorming).**
- Core defines the `EmailProvider` interface, owns workers, retry logic, sync cursors, event emission, OAuth callback router, encrypted credential storage, ACL features, and admin observability.
- Provider packages own OAuth config + token exchange (where applicable), sync logic (Gmail History API, Graph delta, IMAP UIDNEXT/UIDVALIDITY), send logic, and a typed `providerMeta` schema for provider-specific data (Gmail labels, Outlook categories, IMAP flags) that travels in the canonical message via a discriminated union.
- The existing Resend pipeline is untouched. Both pipelines coexist; callers choose per use-case.

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| Three providers in v1 (Gmail, Microsoft, IMAP) | Customer requirement: "each logged-in user uses their own account from different providers." Forcing all three from day 1 prevents the provider abstraction from accidentally over-fitting one. |
| Polling, not native push | Universal across providers, no public endpoints required, predictable cost. Native push (Gmail Pub/Sub, Graph subscriptions) deferred to a later spec. |
| Separate `email_account_credentials` table, NOT extending `integration_credentials` | Per-user secrets and tenant-wide secrets have different access-control semantics. Mixing them in one table risks cross-user leakage via one missed `WHERE` clause. Both still use the shared `findWithDecryption` encryption helper. |
| No message body or attachment persistence in v1 | "What we store" is a CRM-spec decision. This spec emits `CanonicalMessage` events with a `bodyRef` (opaque provider pointer); downstream subscribers decide whether and how to fetch + persist bodies. |
| `EmailMessageEnvelope` capped at last 200 per account, rolling | Provides a debug view for verifying inbound polling without committing to a content-persistence story. CRM spec defines its own persistent store; this table is explicitly NOT a data source for CRM. |
| Both pipelines coexist with Resend (caller picks) | Smallest blast radius for v1. Migration of existing system-sent emails (password reset, MFA, etc.) is out of scope and a clear non-goal. |
| Multiple accounts per user, one primary | Common in CRM tooling (HubSpot, Pipedrive). Schema cost is one extra boolean column; not having it forces a painful migration later. |

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| Single `email` module with all providers inline | Violates the AGENTS.md rule that every external integration provider lives in its own workspace package. |
| Thin core, fat per-provider packages (Approach B) | High duplication of worker/retry/sync-cursor logic across three packages; risk of behavioral drift between providers. |
| Strict canonical schema with no `providerMeta` (Approach A) | Loses provider-specific features (Gmail labels, Outlook categories, IMAP flags) in normalization — CRM team will need them. |
| Reuse `integration_credentials` with a nullable `userId` column | Mixes tenant-scoped and user-scoped secrets in one table; one missed `WHERE user_id = ?` becomes a cross-user disclosure. |
| Replace Resend wholesale with user-account send | Touches notifications, messages, sales, onboarding, MFA, portal — v1 scope explosion with no incremental shipping value. |
| Native push (Gmail Pub/Sub, Graph subscriptions) in v1 | Requires a public webhook endpoint, GCP Pub/Sub topic configured globally, Graph subscriptions renewed every 3 days. Marginal UX win (real-time vs. 5-min lag) doesn't justify the v1 scope. Defer to opt-in v2 spec. |

## User Stories

- **A sales rep** wants to **connect their Gmail account in Open Mercato** so that **emails I send through the platform appear in my own Sent folder and replies come to my inbox.**
- **An account manager on Microsoft 365** wants to **link their Outlook account** so that **future CRM features can attach the conversations to my deals.**
- **A user with a custom domain on Fastmail** wants to **connect via IMAP+SMTP** so that **the integration works without needing OAuth support from my provider.**
- **A user with both a work Microsoft account and a personal Gmail** wants to **connect both and mark one as primary** so that **the system knows which to default to.**
- **A tenant admin** wants to **see which users have connected accounts and which have authentication errors** so that **I can help them reconnect — without ever seeing the contents of their emails.**
- **A tenant admin in a SaaS deployment** wants to **use the platform's shared OAuth app** so that **I don't need to register my own with Google.**
- **A tenant admin in a self-hosted deployment** wants to **register the tenant's own Google Cloud OAuth client** so that **the consent screen shows their company name.**

## Architecture

### Package & Module Layout

```
packages/core/src/modules/email/         # Orchestrator
  index.ts                               # Module metadata
  setup.ts                               # ACL grants, sync-role-acls hook
  acl.ts                                 # 5 features (see Access Control section)
  di.ts                                  # EmailProviderRegistry, OAuthStateService, EmailAccountService
  encryption.ts                          # Declares encrypted columns
  data/entities.ts                       # 5 entities (see Data Models)
  data/validators.ts                     # Zod schemas
  data/extensions.ts                     # Link EmailAccount → User (FK ID only)
  lib/provider.ts                        # EmailProvider interface
  lib/canonical-message.ts               # CanonicalMessage + providerMeta union
  lib/provider-registry.ts               # DI registry of providers
  lib/oauth-state.ts                     # CSRF state-cookie helper
  lib/oauth-router.ts                    # Generic /api/email/oauth/[provider]/callback
  lib/send-pipeline.ts                   # sendAsUser() facade
  commands/                              # Command pattern (see Commands)
    connectAccount.ts
    disconnectAccount.ts
    setPrimaryAccount.ts
    renameAccount.ts
    updateImapCredentials.ts
    sendMessage.ts
    ingestMessage.ts
  workers/
    poll-account.ts                      # Generic poll worker
    refresh-tokens.ts                    # Renew OAuth before expiry
    purge-envelopes.ts                   # Daily envelope-cap cleanup
    purge-health-log.ts                  # Daily 90-day cleanup
  api/                                   # Auto-discovered
    post/accounts/connect/[provider]/route.ts
    get/oauth/[provider]/callback/route.ts
    post/accounts/imap/route.ts
    get/accounts/route.ts
    patch/accounts/[id]/route.ts
    delete/accounts/[id]/route.ts
    post/accounts/[id]/set-primary/route.ts
    post/send/route.ts
    get/admin/accounts/route.ts          # email.admin only
    get/admin/health-log/route.ts        # email.admin only
  backend/
    profile/email-accounts/page.tsx      # User settings UI
    email/admin/page.tsx                 # Admin debug UI
  events.ts                              # 6 events (see Events)
  notifications.ts                       # email_account_requires_reauth type
  notifications.client.ts                # Client-side renderer for that notification

packages/email-gmail/                              # npm package @open-mercato/email-gmail
  package.json
  build.mjs / watch.mjs                            # standard provider-package build (see packages/gateway-stripe/build.mjs)
  src/modules/email_gmail/                         # module id 'email_gmail' (dashes → underscores per root AGENTS.md)
    index.ts                                       # ModuleInfo metadata
    setup.ts                                       # registers provider with core EmailProviderRegistry; marketplace integration row
    di.ts                                          # DI bindings for the provider
    lib/oauth.ts                                   # Google OAuth (authorize URL, token exchange, refresh)
    lib/sync.ts                                    # gmail.users.history.list incremental sync
    lib/send.ts                                    # gmail.users.messages.send (raw RFC822)
    lib/health.ts                                  # gmail.users.getProfile
    lib/provider-meta.ts                           # GmailProviderMeta zod schema

packages/email-microsoft/                          # @open-mercato/email-microsoft
  src/modules/email_microsoft/                     # module id 'email_microsoft'
    index.ts
    setup.ts                                       # provider registration + marketplace integration row
    di.ts
    lib/oauth.ts                                   # Microsoft identity platform v2.0 (Azure AD)
    lib/sync.ts                                    # /me/mailFolders/inbox/messages/delta
    lib/send.ts                                    # /me/sendMail
    lib/health.ts                                  # /me
    lib/provider-meta.ts                           # OutlookProviderMeta zod schema

packages/email-imap/                               # @open-mercato/email-imap
  src/modules/email_imap/                          # module id 'email_imap'
    index.ts
    setup.ts                                       # provider registration + marketplace integration row
    di.ts
    lib/credentials.ts                             # validateCredentials (both IMAP + SMTP login probe)
    lib/sync.ts                                    # imapflow polling using UIDVALIDITY + UIDNEXT
    lib/send.ts                                    # nodemailer SMTP
    lib/health.ts                                  # auth check on both
    lib/provider-meta.ts                           # ImapProviderMeta zod schema
```

**Workspace package convention** (matches `packages/gateway-stripe/src/modules/gateway_stripe/...`, `packages/sync-akeneo/src/modules/sync_akeneo/...`): the npm package name uses dashes; the in-repo module id under `src/modules/<id>/` uses underscores. Root `AGENTS.md`:
> Module-id convention: package `@open-mercato/<suffix>` ⇒ module id `<suffix>` with dashes converted to underscores (e.g. `@open-mercato/ai-assistant` ⇒ `ai_assistant`).

Provider packages register with the core `EmailProviderRegistry` from their own `setup.ts` so each provider is independently enable-able from `apps/mercato/src/modules.ts`. Marketplace Integration registration is also driven from each provider's `setup.ts` (additive — see `packages/core/src/modules/integrations/AGENTS.md`).

### `apps/mercato/src/modules.ts` entries

The four modules are added to `enabledModules` with underscore-converted IDs (per the root `AGENTS.md` module-id convention; mismatched IDs silently break auto-discovery):

```ts
// apps/mercato/src/modules.ts — append to enabledModules
{ id: 'email',           from: '@open-mercato/core' },
{ id: 'email_gmail',     from: '@open-mercato/email-gmail' },
{ id: 'email_microsoft', from: '@open-mercato/email-microsoft' },
{ id: 'email_imap',      from: '@open-mercato/email-imap' },
```

After editing `modules.ts`, run `yarn mercato configs cache structural --all-tenants` (required by root `AGENTS.md` after any module-graph change). If Turbopack still serves a stale compiled chunk, run `yarn dev:reset`.

### OSS Independence

This is an **OSS module** (`packages/core/...`) and the provider packages live under top-level workspace packages, not under `packages/enterprise/...`. The OAuth state-cookie helper at `packages/enterprise/src/modules/sso/lib/state-cookie.ts` is the **design reference** — its logic is **ported (re-implemented) locally** at `packages/core/src/modules/email/lib/oauth-state.ts`, NOT imported.

**MUST NOT**:
- import from `@open-mercato/enterprise` anywhere in `packages/core/src/modules/email/**`
- import from `@open-mercato/enterprise` in any of the three provider packages (`packages/email-gmail/**`, `packages/email-microsoft/**`, `packages/email-imap/**`)

Phase 1 acceptance includes a verification step:

```bash
grep -r "@open-mercato/enterprise" packages/core/src/modules/email packages/email-gmail packages/email-microsoft packages/email-imap
# Expected: empty output
```

The local `oauth-state.ts` MUST reproduce: AES-256-GCM encryption, HKDF key derivation, encrypted payload `{ nonce, userId, providerId, iat, exp }`, 5-minute TTL, signature/tamper resistance. Unit tests cover encrypt/decrypt roundtrip, TTL expiry, signature tamper, userId-mismatch rejection. Key source: `OM_EMAIL_OAUTH_STATE_KEY` env var with HKDF fallback from `KMS_MASTER_KEY` (see Configuration).

### Provider Interface

```ts
// packages/core/src/modules/email/lib/provider.ts
export interface EmailProvider {
  readonly id: 'gmail' | 'microsoft' | 'imap'
  readonly label: string
  readonly authStyle: 'oauth2' | 'credentials'
  readonly capabilities: ProviderCapabilities

  // OAuth-only
  buildAuthorizeUrl?(args: { state: string; redirectUri: string; loginHint?: string }): string
  exchangeCode?(args: { code: string; redirectUri: string }): Promise<OAuthTokens>
  refreshAccessToken?(args: { refreshToken: string }): Promise<OAuthTokens>

  // Credentials-only
  validateCredentials?(input: unknown): Promise<{
    ok: boolean
    emailAddress: string
    capabilities: ProviderCapabilities
    errors?: Record<string, string>
  }>

  // All providers
  healthCheck(args: { accountId: string; credentials: ResolvedCredentials }): Promise<HealthCheckResult>
  fetchSince(args: { accountId: string; credentials: ResolvedCredentials; cursor: SyncCursor | null; limit: number }): Promise<FetchResult>
  sendMessage(args: { accountId: string; credentials: ResolvedCredentials; message: OutboundMessage }): Promise<SendResult>
}

export type FetchResult = {
  messages: CanonicalMessage[]
  nextCursor: SyncCursor
  hasMore: boolean
}

export type SendResult = {
  providerMessageId: string
  providerThreadId: string | null
  sentAt: Date
  providerMeta: ProviderMetaUnion
}
```

### Canonical Message (the event payload contract)

```ts
// packages/core/src/modules/email/lib/canonical-message.ts
export type CanonicalMessage = {
  providerMessageId: string
  providerThreadId: string | null
  direction: 'inbound' | 'outbound'
  from: EmailAddress
  to: EmailAddress[]
  cc: EmailAddress[]
  bcc: EmailAddress[]
  replyTo: EmailAddress[]
  subject: string
  snippet: string                   // ≤200 chars
  inReplyTo: string | null          // RFC 5322 Message-Id of parent
  references: string[]              // full thread chain
  sentAt: Date
  receivedAt: Date | null
  headers: Record<string, string>   // raw RFC822 headers, lowercased keys
  bodyRef: BodyRef                  // opaque pointer; body NOT in payload (v1)
  providerMeta: ProviderMetaUnion   // discriminated union
}

export type BodyRef =
  | { provider: 'gmail'; gmailId: string; mimeType: string }
  | { provider: 'microsoft'; graphId: string }
  | { provider: 'imap'; uidValidity: number; uid: number; folder: string }

export type ProviderMetaUnion =
  | { provider: 'gmail'; data: GmailProviderMeta }
  | { provider: 'microsoft'; data: OutlookProviderMeta }
  | { provider: 'imap'; data: ImapProviderMeta }
```

A future `fetchBody(bodyRef, accountId)` helper (out of scope for v1) will resolve `bodyRef` back to the provider for on-demand body fetch when the CRM spec or an inbox UI needs it.

### OAuth Flow

```
1. User: clicks "Connect Gmail" on /backend/profile/email-accounts
   → client POST /api/email/accounts/connect/gmail
2. Server:
   - Verifies session + email.account.connect feature
   - Resolves OAuth app credentials (tenant Marketplace > platform env)
   - Generates 32-byte random state
   - Encrypts state payload { nonce, userId, providerId, iat, exp } via state-cookie helper (AES-256-GCM + HKDF, 5-min TTL)
   - Sets HttpOnly SameSite=Lax cookie 'om_email_oauth_state'
   - Returns { authorizeUrl } in JSON
3. Client: window.location = authorizeUrl
4. Google: user consents, redirects back to GET /api/email/oauth/gmail/callback?code=...&state=...
5. Callback handler:
   a. Reads state cookie, validates signature + TTL + userId-matches-session + providerId-matches-route
   b. Deletes the state cookie
   c. provider.exchangeCode({ code, redirectUri }) → OAuthTokens
   d. Dispatches command: email.account.connect { userId, providerId, emailAddress, tokens }
   e. Command creates EmailAccount + EmailAccountCredential, marks isPrimary if first account, emits email.account.connected event
   f. Enqueues initial poll-account job
   g. 302 redirect to /backend/profile/email-accounts?flash=connected
```

### IMAP Connection Flow

```
1. User submits IMAP credential form (CrudForm dialog)
   POST /api/email/accounts/connect/imap { displayName, imapHost, imapPort, imapTls, imapUser, imapPassword,
                                            smtpHost, smtpPort, smtpTls, smtpUser, smtpPassword }
2. provider.validateCredentials probes both IMAP login and SMTP login
3. On success: dispatch email.account.connect command (same as OAuth path from step 4d)
4. On failure: throw createCrudFormError with field-level errors
```

### Send Pipeline

```
Public API: import { sendAsUser } from '@open-mercato/core/modules/email/lib/send-pipeline'

sendAsUser({ accountId, message }) →
  1. Resolve EmailAccount; verify currentUser owns accountId; verify status='connected'
  2. Resolve EmailAccountCredential via findOneWithDecryption
  3. If OAuth and tokenExpiresAt < now + 60s:
     - provider.refreshAccessToken; persist new tokens (via command email.account.refresh_token)
  4. Dispatch command: email.message.send { accountId, message }
  5. Command: provider.sendMessage(...); upsert EmailMessageEnvelope (direction='outbound'); emit email.message.sent
  6. Return SendResult to caller
  7. On provider error: classify (auth | rate-limit | transient | persistent), log EmailHealthLog,
     throw typed EmailSendError; transient errors retried once internally before throwing
```

### Receive Pipeline

```
Cron (every 60s): enumerates EmailAccount rows where status='connected' and
                  last_polled_at + poll_interval ≤ now; enqueues poll-account jobs.
                  Backed by index (status, last_polled_at) — single indexed scan per tick,
                  no N+1. Enumeration capped at 500 rows per tick to bound enqueue burst;
                  remaining accounts picked up next tick.

Worker queue 'email-sync', concurrency 10 (I/O-bound).

poll-account worker:
  1. Load EmailAccount + EmailAccountCredential + EmailSyncCursor (folder='INBOX')
  2. If status !== 'connected' → skip
  3. Refresh OAuth token if needed (same logic as send)
  4. provider.fetchSince({ cursor, limit=100 }) → FetchResult
  5. Persist new cursor + last_polled_at in single transaction
  6. For each message:
     - Dispatch command: email.message.ingest { canonicalMessage, accountId }
     - Command upserts EmailMessageEnvelope (rolling cap 200) + emits email.message.received
  7. If hasMore=true → re-enqueue immediately (drain mode)
  8. On error: classify
     - 401/invalid_grant      → command: email.account.mark_requires_reauth (status, notification)
     - 429 + Retry-After      → reschedule per header, no status change
     - 5xx / network          → retry up to 3× with backoff, then warning log, no status change
     - cursor-invalid (e.g., Gmail history_id_too_old) → reset cursor to "now", emit email.account.error (severity=info)
     - persistent other       → status='error', exponential backoff (5→10→20→60 min, max 60)
```

### Commands & Events

Following the AGENTS.md command pattern (`packages/core/src/modules/customers/commands/*` reference):

| Command | Payload | State Change | Undo |
|---|---|---|---|
| `email.account.connect` | `{ userId, providerId, emailAddress, credentialBlob }` | Insert EmailAccount + EmailAccountCredential; set isPrimary if first; emit `email.account.connected` | `email.account.disconnect` |
| `email.account.disconnect` | `{ accountId }` | Soft-delete EmailAccount; hard-purge EmailAccountCredential; halt poll worker; emit `email.account.disconnected` | None (credentials lost on purge — user reconnects) |
| `email.account.set_primary` | `{ accountId }` | Clear isPrimary on user's other accounts; set on this one | Set previous primary back |
| `email.account.rename` | `{ accountId, displayName }` | Update displayName | Restore previous displayName |
| `email.account.update_imap_credentials` | `{ accountId, credentialBlob }` | Replace EmailAccountCredential; set status='connected' | Restore previous (kept in-memory during txn) |
| `email.account.refresh_token` | `{ accountId, tokens }` | Update accessToken + tokenExpiresAt | None (token refresh has no business undo) |
| `email.account.mark_requires_reauth` | `{ accountId, reason }` | Set status='requires_reauth'; create EmailHealthLog; emit notification | Auto-reverted when user reconnects |
| `email.message.send` | `{ accountId, message }` | Provider sendMessage; upsert outbound EmailMessageEnvelope; emit `email.message.sent` | None — emails cannot be unsent. Local envelope can be deleted but the email is already at the recipient. |
| `email.message.ingest` | `{ accountId, canonicalMessage }` | Upsert inbound EmailMessageEnvelope (idempotent on `(account_id, provider_message_id)`); emit `email.message.received` | Delete envelope; CRM-spec subscribers must handle reversal. |

Events (`packages/core/src/modules/email/events.ts`) — follows the canonical shape used by every other module (compare `packages/core/src/modules/inbox_ops/events.ts`, `packages/core/src/modules/customers/events.ts`):

```ts
import { createModuleEvents } from '@open-mercato/shared/modules/events'
import type { EventPayload } from '@open-mercato/shared/modules/events'
import type { CanonicalMessage } from './lib/canonical-message'

// Payload type aliases — enforced via TS generics at emit sites, NOT stored on the EventDefinition.
export type AccountConnectedPayload = EventPayload & {
  accountId: string
  userId: string
  providerId: 'gmail' | 'microsoft' | 'imap'
  emailAddress: string
}
export type AccountDisconnectedPayload = EventPayload & {
  accountId: string
  userId: string
  providerId: 'gmail' | 'microsoft' | 'imap'
}
export type AccountRequiresReauthPayload = EventPayload & {
  accountId: string
  userId: string
  providerId: 'gmail' | 'microsoft' | 'imap'
  reason: string
}
export type AccountErrorPayload = EventPayload & {
  accountId: string
  userId: string
  providerId: 'gmail' | 'microsoft' | 'imap'
  severity: 'info' | 'warning' | 'error'
  kind: string
}
export type MessageReceivedPayload = EventPayload & {
  accountId: string
  message: CanonicalMessage
}
export type MessageSentPayload = EventPayload & {
  accountId: string
  message: CanonicalMessage
}

const events = [
  { id: 'email.account.connected',       label: 'Email account connected',       entity: 'account', category: 'crud',      clientBroadcast: true  },
  { id: 'email.account.disconnected',    label: 'Email account disconnected',    entity: 'account', category: 'crud',      clientBroadcast: true  },
  { id: 'email.account.requires_reauth', label: 'Email account requires reauth', entity: 'account', category: 'lifecycle', clientBroadcast: true  },
  { id: 'email.account.error',           label: 'Email account error',           entity: 'account', category: 'lifecycle', clientBroadcast: true  },
  { id: 'email.message.received',        label: 'Email message received',        entity: 'message', category: 'custom',    clientBroadcast: false }, // body NOT in payload
  { id: 'email.message.sent',            label: 'Email message sent',            entity: 'message', category: 'custom',    clientBroadcast: true  },
] as const

export const eventsConfig = createModuleEvents({ moduleId: 'email', events })
export const emitEmailEvent = eventsConfig.emit
export type EmailEventId = typeof events[number]['id']
export default eventsConfig
```

Persistence is declared per-subscriber via `metadata: { event, persistent: true }` — not on the event definition. Every CRM-facing subscriber that must survive restarts MUST set `persistent: true`. Example subscriber skeleton:

```ts
// packages/core/src/modules/email/subscribers/log-message-received.ts
export const metadata = {
  event: 'email.message.received',
  persistent: true,
  id: 'email.log-message-received',
}

export default async function handle(payload: MessageReceivedPayload) {
  // ...
}
```

`clientBroadcast: false` on `email.message.received` for v1 — no real-time browser fanout for inbound (privacy + volume); CRM spec decides whether to enable later. Note also the cross-process bridge constraint (`.ai/lessons.md` → "Browser SSE bridges must work across worker and web processes"): worker-emitted events do NOT reach the in-process SSE tap. v1 sidesteps this with `clientBroadcast: false`. Any future flip to `true` MUST be paired with the cross-process bridge work.

### Access Control (`acl.ts` and `setup.ts`)

Five ACL features, all new (greenfield namespace — confirmed no collisions). Feature naming follows the root `AGENTS.md` rule `<module>.<entity>.<action>` (or `<module>.<action>` for module-wide capabilities).

```ts
// packages/core/src/modules/email/acl.ts
import type { ModuleFeature } from '@open-mercato/shared/lib/auth/acl'

export const features: ModuleFeature[] = [
  { id: 'email.account.connect', title: 'Connect own email account',          module: 'email' },
  { id: 'email.account.manage',  title: 'Manage own email accounts',          module: 'email' },
  { id: 'email.send',            title: 'Send email as own connected account', module: 'email' },
  { id: 'email.admin',           title: 'Administer tenant email integrations', module: 'email' },
  { id: 'email.admin.providers', title: 'Configure tenant OAuth provider apps', module: 'email' },
]
```

Default role grants in `setup.ts` mirror the features array and are propagated to existing tenants via `yarn mercato auth sync-role-acls`:

```ts
// packages/core/src/modules/email/setup.ts
import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    admin:   ['email.account.connect', 'email.account.manage', 'email.send', 'email.admin', 'email.admin.providers'],
    manager: ['email.account.connect', 'email.account.manage', 'email.send'],
    user:    ['email.account.connect', 'email.account.manage', 'email.send'],
  },
  // onTenantCreated / seedDefaults / seedExamples not required for v1
}
```

Notes:
- `email.account.connect` and `email.account.manage` are split intentionally — `connect` gates the initial OAuth/IMAP linking flow; `manage` gates rename/set-primary/disconnect on already-linked accounts. This lets future tenant policies disable new linking while preserving existing accounts.
- `email.admin` covers the read-only admin view (account list, health log). `email.admin.providers` is the higher-privilege capability needed to write tenant-level OAuth client credentials. Default role map only grants this to `admin`.
- `email.send` is required by the bespoke `POST /api/email/send` route AND by any future workflow/AI tool that calls `sendAsUser(...)` programmatically.
- No customer-portal roles are touched — the v1 UI lives entirely under `/backend/...`.

After implementing `acl.ts` and `setup.ts`, run `yarn mercato auth sync-role-acls` so existing tenants receive the new feature grants on the appropriate roles.

### Security Posture

- **No HTML email rendering in v1.** Admin debug view shows envelopes only (subject, sender, snippet) as plain text via React (auto-escaped). No `dangerouslySetInnerHTML`, no inline `<svg>`, no raw HTML insertion anywhere. XSS surface is therefore N/A for v1.
- **Snippet sanitization.** Even though snippets are rendered as text, provider-returned snippets are passed through a length-truncate to `≤200` chars before persistence; no other transformation.
- **All persisted strings (subject, addresses, snippet, headers).** Stored verbatim from the provider; rendering paths use React's default text escaping. When the CRM spec adds body rendering, it MUST address HTML sanitization (DOMPurify or equivalent) before render — flagged for that spec.
- **URL/header encoding.** OAuth authorize URLs are built via `URLSearchParams`; never via string concatenation. Inbound headers are stored as `Record<string, string>` with lowercased keys; no header value is ever interpolated into URLs or logs.
- **Parameterized queries.** All DB access is via MikroORM `em.find` / `findOneWithDecryption` / query-builder — no raw SQL string interpolation anywhere in this spec.

## Data Models

All tables: `id` UUID primary key, `created_at` / `updated_at` timestamps, `organization_id` + `tenant_id` foreign keys (mandatory scoping per AGENTS.md), `deleted_at` for soft-delete where applicable.

### EmailAccount (table `email_accounts`)
One row per linked account, per user.
- `id` UUID
- `user_id` UUID (FK auth.users)
- `provider_id` text — `'gmail' | 'microsoft' | 'imap'` (validated via DI provider registry)
- `display_name` text — user-editable, defaults to emailAddress
- `email_address` text — canonical address
- `is_primary` boolean — exactly one true per user (enforced in `set_primary` command; partial unique index `(user_id) WHERE is_primary AND deleted_at IS NULL`)
- `status` text — `'connected' | 'requires_reauth' | 'error' | 'disconnected'`
- `last_error` text NULL
- `last_polled_at` timestamptz NULL
- `poll_interval_seconds` integer — default from `OM_EMAIL_POLL_INTERVAL_SECONDS`, per-account override allowed
- `capabilities` jsonb — `{ canSend, canReceive, supportsThreading, supportsLabels, supportsCategories, supportsAttachmentsOnSend, maxAttachmentBytes }`
- `organization_id`, `tenant_id`, `created_at`, `updated_at`, `deleted_at`
- Indexes: `(user_id, deleted_at)`, `(tenant_id, provider_id, status)`, `(status, last_polled_at)` for the cron scheduler

### EmailAccountCredential (table `email_account_credentials`)
1:1 with EmailAccount. Credential blob is field-level encrypted.
- `id` UUID
- `email_account_id` UUID (FK, unique on `WHERE deleted_at IS NULL`)
- `credential_blob` jsonb (ENCRYPTED — declared in `encryption.ts`)
  - OAuth providers: `{ accessToken, refreshToken, tokenType: 'Bearer', expiresAt, scopes }`
  - IMAP: `{ imapHost, imapPort, imapUser, imapPassword, imapTls, smtpHost, smtpPort, smtpUser, smtpPassword, smtpTls }`
- `token_expires_at` timestamptz NULL (OAuth only; null for IMAP)
- `scopes_granted` text[] NULL
- `organization_id`, `tenant_id`, `created_at`, `updated_at`

### EmailSyncCursor (table `email_sync_cursors`)
One row per account+folder. v1 only stores INBOX cursors.
- `id` UUID
- `email_account_id` UUID (FK)
- `folder` text — default `'INBOX'`
- `cursor` jsonb — opaque, provider-specific
  - Gmail: `{ historyId: string }`
  - Microsoft: `{ deltaLink: string }`
  - IMAP: `{ uidValidity: number, uidNext: number }`
- `status` text — `'ok' | 'error' | 'initializing'`
- `last_synced_at` timestamptz NULL
- `last_error` text NULL
- `organization_id`, `tenant_id`, `created_at`, `updated_at`
- Indexes: `(email_account_id, folder)` UNIQUE

### EmailHealthLog (table `email_health_logs`)
Audit log. Daily worker purges entries older than `OM_EMAIL_HEALTH_LOG_RETENTION_DAYS` (default 90).
- `id` UUID
- `email_account_id` UUID (FK; nullable for tenant-level events)
- `kind` text — `'health_check' | 'sync_error' | 'send_error' | 'oauth_refresh' | 'reauth_required' | 'cursor_reset'`
- `severity` text — `'info' | 'warning' | 'error'`
- `message` text
- `context` jsonb
- `organization_id`, `tenant_id`, `created_at`
- Indexes: `(tenant_id, created_at DESC)`, `(email_account_id, created_at DESC)`, `(severity, created_at DESC)`

### EmailMessageEnvelope (table `email_message_envelopes`)
Rolling cache of last ~200 envelopes per account for the admin debug view ONLY. NOT a CRM data source. Purged by `purge-envelopes` worker daily.
- `id` UUID
- `email_account_id` UUID (FK)
- `provider_message_id` text
- `provider_thread_id` text NULL
- `direction` text — `'inbound' | 'outbound'`
- `subject` text
- `from_address` text
- `from_name` text NULL
- `to_addresses` text[]
- `snippet` text — ≤200 chars
- `sent_at` timestamptz
- `received_at` timestamptz NULL
- `provider_meta` jsonb
- `organization_id`, `tenant_id`, `created_at`
- Indexes: `(email_account_id, provider_message_id)` UNIQUE, `(email_account_id, created_at DESC)` for cap-and-purge

### Encryption Map (`packages/core/src/modules/email/encryption.ts`)

```ts
import type { ModuleEncryptionMap } from '@open-mercato/shared/modules/encryption'

export const defaultEncryptionMaps: ModuleEncryptionMap[] = [
  {
    entityId: 'email:email_account_credential',
    fields: [
      { field: 'credential_blob' },
    ],
  },
]

export default defaultEncryptionMaps
```

Follows the canonical pattern used by every other module — see `packages/core/src/modules/messages/encryption.ts`, `packages/core/src/modules/integrations/encryption.ts`, etc. The `defaultEncryptionMaps` export is the convention enforced by `<module>/encryption.ts` (root `AGENTS.md` → Encryption). No `registerEntityEncryption(...)` symbol exists in `@open-mercato/shared`; previous draft was incorrect.

Reads use the 5-arg `findOneWithDecryption` helper:

```ts
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'

const credential = await findOneWithDecryption(
  em,
  'EmailAccountCredential',
  { emailAccountId },
  /* options */ undefined,
  /* scope */ { tenantId, organizationId },
)
```

The `credential_blob` column is the only sensitive payload (OAuth tokens or IMAP/SMTP passwords). It is never serialized in any API response by construction (separate DTO mapper, see `EmailAccountDto` in API Contracts). The `EmailHealthLog.context` validator rejects any key matching `/^(credential|password|token|secret)/i` so accidental leakage through logs is fail-closed (see Security Posture below).

## API Contracts

All routes are auto-discovered. Every route file exports a per-method `metadata` object with `requireAuth: true` and `requireFeatures: [...]` (per `packages/core/AGENTS.md` API Routes rules — no top-level `export const requireAuth`). All write routes use `useGuardedMutation` from the UI side and `validateCrudMutationGuard` + `runCrudMutationGuardAfterSuccess` server-side for any non-`makeCrudRoute` mutation. All routes export `openApi`. Bodies validated via Zod schemas in `data/validators.ts`.

**Pagination**: list endpoints (`GET /api/email/accounts`, `GET /api/email/admin/accounts`, `GET /api/email/admin/health-log`) accept `?cursor=<opaque>&limit=<n>` with `limit ≤ 100`. The health log uses keyset pagination on `(created_at DESC, id DESC)` to remain stable as new entries arrive. Account lists are small enough that simple cursor on `created_at` suffices.

**CRUD factory usage**: `GET /api/email/accounts`, `PATCH /api/email/accounts/[id]`, `DELETE /api/email/accounts/[id]`, `POST /api/email/admin/accounts` (list), and `POST /api/email/admin/health-log` (list) use `makeCrudRoute` with `indexer: { entityType: 'email:email_account' | 'email:email_health_log' }`. The OAuth initiation route, OAuth callback route, IMAP connect route, set-primary route, and send route are bespoke (they don't fit the CRUD shape) and each calls `validateCrudMutationGuard` before mutation, `runCrudMutationGuardAfterSuccess` after success, per the AGENTS.md rule for custom write routes.

### POST /api/email/accounts/connect/[provider]
- Features: `email.account.connect`
- Body: `{}` (provider read from path param, validated via registry)
- Response: `{ authorizeUrl: string }` (OAuth providers) — caller redirects user

### POST /api/email/accounts/connect/imap
- Features: `email.account.connect`
- Body: `{ displayName, imapHost, imapPort, imapTls, imapUser, imapPassword, smtpHost, smtpPort, smtpTls, smtpUser, smtpPassword }`
- Response: `{ accountId }` on success; `422` with field-level errors via `createCrudFormError` on validation failure

### GET /api/email/oauth/[provider]/callback
- No auth feature requirement (state-cookie carries identity)
- Query: `code`, `state` (Google) or `code`, `state`, `session_state` (Microsoft)
- Response: HTTP 302 to `/backend/profile/email-accounts?flash=connected` (or `flash=error&code=...`)
- Errors: invalid state, expired state, userId mismatch, exchange failure — all redirect with `flash=error`

### GET /api/email/accounts
- Features: `email.account.manage`
- Query: standard list filters (status, provider)
- Response: `{ items: EmailAccountDto[] }` — only accounts where `user_id === currentUser.id`
- Never returns credentials or envelope contents

### PATCH /api/email/accounts/[id]
- Features: `email.account.manage`
- Body: `{ displayName?, pollIntervalSeconds? }`
- Verifies `user_id === currentUser.id`
- Dispatches `email.account.rename` command if displayName changed

### POST /api/email/accounts/[id]/set-primary
- Features: `email.account.manage`
- Dispatches `email.account.set_primary` command

### DELETE /api/email/accounts/[id]
- Features: `email.account.manage`
- Dispatches `email.account.disconnect` command

### POST /api/email/send
- Features: `email.send`
- Body: `{ accountId, to[], cc?[], bcc?[], subject, body: { plain?, html? }, attachments?: AttachmentRef[], inReplyTo?, references?[] }`
- Server-side: `sendAsUser` facade does all the work; verifies the caller owns the accountId
- Response: `{ providerMessageId, providerThreadId, sentAt }`
- Errors: 401 (no session), 403 (not owner of account), 409 (account not connected), 422 (invalid body), 502 (provider error — message includes classification)

**`AttachmentRef` type** — defined in `packages/core/src/modules/email/data/validators.ts`. Two variants discriminated by `kind`:

```ts
import { z } from 'zod'

export const attachmentRefSchema = z.discriminatedUnion('kind', [
  // Reference to a record already stored by the existing attachments module.
  z.object({
    kind: z.literal('attachment'),
    attachmentId: z.string().uuid(),
    filename: z.string().min(1).max(255).optional(), // override display name; defaults to stored filename
  }),
  // Inline content provided in the request body. Capped to keep payloads small.
  z.object({
    kind: z.literal('inline'),
    filename: z.string().min(1).max(255),
    mimeType: z.string().min(1).max(255),
    contentBase64: z.string().min(1), // server enforces 10 MB hard cap per attachment, 25 MB total
  }),
])

export type AttachmentRef = z.infer<typeof attachmentRefSchema>
```

The `attachment` variant reuses the existing `attachments` module (no new storage). The `inline` variant is for ad-hoc payloads; the spec deliberately does NOT introduce a new storage tier for outbound email attachments. Provider implementations translate `AttachmentRef[]` into provider-native attachment payloads (Gmail: base64-encoded MIME parts; Microsoft: `attachments[]` in `/me/sendMail`; IMAP/SMTP: nodemailer `attachments` array).

Per-provider attachment size and count limits come from `EmailAccount.capabilities` (`maxAttachmentBytes`, `supportsAttachmentsOnSend`). Send fails fast with 422 if the request exceeds the resolved account's capabilities.

### GET /api/email/admin/accounts
- Features: `email.admin`
- Returns all accounts in tenant with redacted fields: `{ id, userId, providerId, displayName, emailAddress, status, lastPolledAt, errorCount24h }`
- NO credentials, NO envelope contents

### GET /api/email/admin/health-log
- Features: `email.admin`
- Query: `accountId?`, `severity?`, `kind?`, `since?`
- Returns `EmailHealthLog` entries (no message contents — `EmailHealthLog.context` does NOT carry email body/subject/recipient by construction)

## Internationalization (i18n)

Per `packages/shared/AGENTS.md`. Locale keys go in `packages/core/src/modules/email/locales/<lang>.json`.

Required key namespaces:
- `email.account.providers.gmail.label`, `.microsoft.label`, `.imap.label`
- `email.account.connect.button`, `.dialog.*`
- `email.account.status.connected`, `.requires_reauth`, `.error`, `.disconnected`
- `email.account.actions.rename`, `.makePrimary`, `.reconnect`, `.disconnect`
- `email.account.banner.requiresReauth`
- `email.imap.form.fields.*` (host, port, tls, user, password, smtp.*)
- `email.imap.form.warnings.basicAuth` (the security ack)
- `email.admin.title`, `email.admin.healthLog.severity.*`, `email.admin.providers.title`
- `email.notifications.requires_reauth.title`, `.body`, `.cta`
- `email.send.errors.*` (classification keys)

Translations done via `useT()` client-side, `resolveTranslations()` server-side.

## UI/UX

### User Settings → Email Accounts (`/backend/profile/email-accounts`)
- DataTable (uses `@open-mercato/ui/backend` primitives)
  - Columns: provider icon (lucide-react `Mail`/`MailOpen` + tinted by provider), display name (inline-editable), email address, primary toggle, status badge (semantic status tokens — `bg-status-success-soft text-status-success-fg` for connected, `bg-status-warning-soft text-status-warning-fg` for `requires_reauth`, `bg-status-error-soft text-status-error-fg` for `error`), last synced (relative time), RowActions
  - RowActions ids: `email-account:rename`, `email-account:set-primary`, `email-account:reconnect`, `email-account:disconnect` (per `packages/ui/src/backend/AGENTS.md`)
- "Connect Account" split button (top-right):
  - Items: "Connect Gmail", "Connect Microsoft", "Connect IMAP"
  - Gmail / Microsoft → POST connect endpoint → `window.location = authorizeUrl`
  - IMAP → opens `CrudForm` dialog with provider's credential schema; submit via `useGuardedMutation`
- Banner across top: `<Alert variant="warning">` listing accounts in `requires_reauth` with inline "Reconnect" button
- Empty state (no accounts): `<EmptyState>` with primary CTA "Connect your first email account"
- IMAP dialog includes explicit checkbox: "I understand storing my email password is less secure than OAuth. I will use an app-specific password where possible." (Defaults unchecked; submit disabled until checked.)
- All dialogs: `Cmd/Ctrl+Enter` submit, `Escape` cancel

### Admin → Integrations → Email Providers (`/backend/email/admin`)
- Top-level DataTable: accounts in tenant
  - Columns: user, email address, provider, status, last synced, 24h error count, RowActions ("View health log")
  - Filterable by provider and status
  - Aggregate header card: total connected accounts, accounts with errors, accounts requiring re-auth
- "Provider OAuth App Configuration" `<CollapsibleSection>` per provider:
  - Inputs: clientId, clientSecret (write-only / shows "set" badge after save)
  - Read-only display of the platform redirect URI (with copy button) — operators must register this exact URL with their Google/Microsoft app
  - Submit via Marketplace Integration update flow
- "Health Log" `<CollapsibleSection>`: last 100 entries, sortable
- All inline status uses semantic status tokens; no hardcoded colors
- All icons use lucide-react via the backend icon registry (`@open-mercato/ui/backend/icons`); no inline `<svg>`
- Every icon-only button (rename/disconnect/reconnect/copy/etc.) carries an explicit `aria-label` per `.ai/ui-components.md`
- Pagination: account-list and health-log DataTables use cursor pagination with `pageSize ≤ 100`

### Frontend Architecture Contract

(Per spec-writing skill heuristic 9 — minimal because UI surface is small.)

- **Server/Client boundary**:
  - `/backend/profile/email-accounts/page.tsx` — Server Component shell (auth check, initial data load)
  - `EmailAccountsTable` — Client Component (`"use client"`) for interactive table actions
  - `ConnectImapDialog` — Client Component (form state, dialog)
  - `/backend/email/admin/page.tsx` — Server Component shell
  - `AdminAccountsTable` — Client Component
- **`"use client"` ledger**: 3 client files, all justified by `useState`/`useMutation`/dialog state
- **Client blob guardrail**: no provider SDKs imported into client bundles (no `googleapis`, no `@microsoft/microsoft-graph-client`, no `imapflow` — all server-side only)
- **Route budgets**: each page < 30 KB gzipped client JS (DataTable + CrudForm primitives are shared, not re-bundled)
- **Hydration test**: Playwright test asserts each interactive control responds within 100 ms of mount on a cold load
- **Provider/Bootstrap scope**: no new global providers; uses existing app shell

## Configuration

```bash
# Platform-default OAuth apps (optional — tenants can override via Marketplace)
OM_EMAIL_GMAIL_OAUTH_CLIENT_ID
OM_EMAIL_GMAIL_OAUTH_CLIENT_SECRET
OM_EMAIL_GMAIL_REDIRECT_URI                  # e.g. https://app.example.com/api/email/oauth/gmail/callback
OM_EMAIL_MICROSOFT_OAUTH_CLIENT_ID
OM_EMAIL_MICROSOFT_OAUTH_CLIENT_SECRET
OM_EMAIL_MICROSOFT_OAUTH_TENANT              # 'common' for multi-tenant, or specific tenant GUID
OM_EMAIL_MICROSOFT_REDIRECT_URI

# Sync tuning
OM_EMAIL_POLL_INTERVAL_SECONDS=300           # default 5 min
OM_EMAIL_POLL_BATCH_SIZE=100
OM_EMAIL_ENVELOPE_RETENTION=200              # rolling cap per account
OM_EMAIL_HEALTH_LOG_RETENTION_DAYS=90

# OAuth state cookie key (32 bytes hex). Falls back to derive from KMS_MASTER_KEY when absent.
OM_EMAIL_OAUTH_STATE_KEY
```

Setup raises a clear error at module boot if any OAuth provider is enabled but neither the per-tenant Marketplace config nor the corresponding platform-env credentials are configured.

## Migration & Backward Compatibility

### Database migrations

One module migration creates 5 tables with FKs, indexes, and the unique partial index for `is_primary`. Standard workflow:
1. Edit `data/entities.ts`
2. `yarn db:generate`
3. Keep only email-related SQL, update `packages/core/src/modules/email/migrations/.snapshot-open-mercato.json`

Each provider package migration (additive): registers the provider's Marketplace Integration row.

### Backward Compatibility

| Surface | Change | Impact |
|---|---|---|
| Database schema | 5 new tables, all additive | Additive — zero impact |
| API routes | New `/api/email/...` namespace | Additive |
| Events | New `email.*` events | Additive |
| ACL features | 5 new features (default-granted per role in setup.ts) | Additive |
| Existing Resend pipeline (`@open-mercato/shared/lib/email/send`) | Untouched | None |
| `messages` module | Untouched | None |
| `inbox_ops` module | Untouched | None |
| `notifications` module | One new notification type (`email_account_requires_reauth`) | Additive |
| `integrations` Marketplace | Three new provider entries via per-package `marketplace.ts` | Additive |
| `yarn generate` output | Three new packages join generators | Additive |
| `apps/mercato/src/modules.ts` | Adds three new packages to `enabledModules` | Required app change, documented |

No deprecations. No data migration of existing rows. Existing tests untouched.

After enabling the new modules: run `yarn mercato configs cache structural --all-tenants` per AGENTS.md.

## Implementation Plan

### Phase 1 — Core foundations (no providers yet)
1. Scaffold `packages/core/src/modules/email/` (index.ts, setup.ts, acl.ts, di.ts).
2. Create entities, validators, encryption map; run `yarn db:generate`.
3. Implement `EmailProvider` interface, `CanonicalMessage`, `provider-registry` (empty registry, just the DI hook).
4. Implement OAuth state-cookie helper (port from SSO module pattern); unit tests for encrypt/decrypt/expiry/tamper.
5. Implement OAuth callback router shell that delegates to a registered provider (returns 400 if unknown).
6. Implement commands (`connectAccount`, `disconnectAccount`, `setPrimaryAccount`, `renameAccount`, `updateImapCredentials`, `refreshToken`, `markRequiresReauth`).
7. Implement API routes for `accounts/*` (list, patch, delete, set-primary) with feature guards and `openApi`.
8. Implement `send-pipeline.ts` `sendAsUser` facade with a no-op provider (returns "no provider registered" error if no provider for the account).
9. Implement workers (`poll-account`, `refresh-tokens`, `purge-envelopes`, `purge-health-log`) with provider-agnostic logic.
10. Unit tests for: cursor advancement, drain mode, error classification, status transitions, command undo semantics, state-cookie helper.
11. **Acceptance**: Module loads, ACL features visible, API routes 404 without registered providers, `yarn build` passes, `yarn lint` passes.

### Phase 2 — User UI for accounts
1. `/backend/profile/email-accounts/page.tsx` Server Component shell.
2. `EmailAccountsTable` Client Component (DataTable + RowActions + status badges).
3. `ConnectImapDialog` Client Component (CrudForm with security-ack checkbox).
4. Banner for requires_reauth accounts using `<Alert>` primitive.
5. Empty state.
6. i18n locale entries (en at minimum).
7. **Acceptance**: User can navigate to the page; with no providers registered, "Connect Account" dropdown shows none. Locale strings resolve. DataTable renders.

### Phase 3 — Gmail provider package
1. `packages/email-gmail/` workspace package (package.json, tsconfig, AGENTS.md).
2. OAuth: authorize URL builder, code exchange, refresh — using `googleapis` SDK or raw fetch.
3. Sync: `gmail.users.history.list` for incremental; full list for initial sync seeding.
4. Send: build RFC822 message via `mailcomposer` (or equivalent), `gmail.users.messages.send`.
5. Health: `gmail.users.getProfile`.
6. `GmailProviderMeta` zod schema (labelIds, isImportant, isStarred, threadId).
7. Marketplace integration registration.
8. Unit tests with mocked HTTP responses.
9. Wire into `apps/mercato/src/modules.ts`; run `yarn mercato configs cache structural --all-tenants`.
10. **Acceptance**: User can connect Gmail end-to-end against a real Google Workspace test account, send a test email, observe it polled back into envelopes within 5 min.

### Phase 4 — Microsoft provider package
1. `packages/email-microsoft/` workspace package.
2. OAuth: Microsoft identity platform v2.0 authorize URL, code exchange (PKCE), refresh.
3. Sync: `/me/mailFolders/inbox/messages/delta` (delta queries).
4. Send: `/me/sendMail` with `application/json` body.
5. Health: `/me`.
6. `OutlookProviderMeta` zod schema (categories, importance, conversationId).
7. Marketplace integration registration.
8. Unit tests with mocked Graph responses.
9. **Acceptance**: User can connect Microsoft 365 account end-to-end, send, and receive via polling.

### Phase 5 — IMAP+SMTP provider package
1. `packages/email-imap/` workspace package, deps `imapflow` + `nodemailer` + `mailparser`.
2. `validateCredentials` probes both IMAP and SMTP login.
3. Sync: `imapflow` connect, select INBOX, fetch by UID range using `EmailSyncCursor.cursor.uidNext` / `uidValidity` (handle UIDVALIDITY rotation = full re-sync).
4. Send: nodemailer SMTP, append to Sent folder if server supports it.
5. `ImapProviderMeta` zod schema (folder, flags, uid, uidValidity).
6. Marketplace integration registration (no OAuth app config; just an "enabled/disabled per tenant" toggle).
7. Unit tests against an in-process IMAP mock.
8. **Acceptance**: User can connect IMAP+SMTP with valid creds, send, receive via polling. Invalid creds rejected with field-level errors.

### Phase 6 — Admin UI
1. `/backend/email/admin/page.tsx` Server Component.
2. `AdminAccountsTable` Client Component with filters (provider, status).
3. Aggregate header card (counts).
4. Health log section with severity coloring.
5. Tenant OAuth app config form per provider (CollapsibleSection).
6. **Acceptance**: Admin sees all tenant accounts, can drill into health log, can configure tenant-level OAuth overrides. Cannot see envelope contents.

### Phase 7 — Notifications & cleanup workers
1. Notification type `email_account_requires_reauth` with client renderer.
2. Subscriber on `email.account.requires_reauth` event that creates the notification.
3. Cron registration for `purge-envelopes` (daily, caps rolling 200 per account) and `purge-health-log` (daily, deletes > retention days).
4. **Acceptance**: When a refresh-token-revoked event happens, the account-owner receives an in-app notification; the page banner appears on next load.

### Integration test placement (applies to every phase)

Per `.ai/lessons.md` → "Keep executable integration tests module-local": executable Playwright specs live under the **owning module's** `__integration__/` directory, not under `.ai/qa/tests/`. `.ai/qa/scenarios/TC-EMAIL-*.md` holds the human-readable scenario descriptions only.

Test locations:

| Test | Markdown scenario | Executable Playwright spec |
|---|---|---|
| TC-EMAIL-011, 012, 013, 014 (account management, RBAC, isolation) | `.ai/qa/scenarios/TC-EMAIL-011..014.md` | `packages/core/src/modules/email/__integration__/TC-EMAIL-NNN.spec.ts` |
| TC-EMAIL-001, 005, 006, 009 (Gmail) | `.ai/qa/scenarios/TC-EMAIL-001/005/006/009.md` | `packages/email-gmail/src/modules/email_gmail/__integration__/TC-EMAIL-NNN.spec.ts` |
| TC-EMAIL-002 (Microsoft) | `.ai/qa/scenarios/TC-EMAIL-002.md` | `packages/email-microsoft/src/modules/email_microsoft/__integration__/TC-EMAIL-002.spec.ts` |
| TC-EMAIL-003, 004, 007, 008 (IMAP/SMTP) | `.ai/qa/scenarios/TC-EMAIL-003/004/007/008.md` | `packages/email-imap/src/modules/email_imap/__integration__/TC-EMAIL-NNN.spec.ts` |
| TC-EMAIL-010, 015 (cross-cutting: notifications, tenant overrides) | `.ai/qa/scenarios/TC-EMAIL-010/015.md` | `packages/core/src/modules/email/__integration__/TC-EMAIL-NNN.spec.ts` |

**Per-phase acceptance rule** (overrides any earlier "tests at end" framing): every phase below ships its **own** module-local Playwright specs. A phase is NOT marked complete until its listed integration tests pass. This matches the user's standing rule and `.ai/qa/AGENTS.md`.

Per-phase test ownership:

| Phase | Required integration specs (module-local `__integration__/`) |
|---|---|
| Phase 1 (Core foundations) | `packages/core/src/modules/email/__integration__/`: smoke spec asserting module loads, ACL features registered, API routes 404 with no providers; per-user isolation spec for the accounts list endpoint as a foundational guarantee |
| Phase 2 (User UI) | `packages/core/src/modules/email/__integration__/`: empty-state render, banner render, navigation smoke |
| Phase 3 (Gmail) | `packages/email-gmail/.../__integration__/`: TC-EMAIL-001, 005, 006, 009 |
| Phase 4 (Microsoft) | `packages/email-microsoft/.../__integration__/`: TC-EMAIL-002 |
| Phase 5 (IMAP) | `packages/email-imap/.../__integration__/`: TC-EMAIL-003, 004, 007, 008 |
| Phase 6 (Admin UI) | `packages/core/src/modules/email/__integration__/`: TC-EMAIL-011, 015 |
| Phase 7 (Notifications & cleanup) | `packages/core/src/modules/email/__integration__/`: TC-EMAIL-010, plus envelope-cap and health-log-retention sweeps |

Cross-phase tests that touch behavior owned by multiple phases (e.g. TC-EMAIL-013 Disconnect spans accounts + sync halt + credential purge) land with the phase that delivers the last contributing behavior — typically Phase 1 (foundations) since the disconnect command is foundational.

### File Manifest (high-level)

| File | Action | Purpose |
|------|--------|---------|
| `packages/core/src/modules/email/**` | Create | Orchestrator module |
| `packages/core/src/modules/email/__integration__/TC-EMAIL-*.spec.ts` | Create | Module-local integration specs (Phases 1, 2, 6, 7) |
| `packages/email-gmail/src/modules/email_gmail/**` | Create | Gmail provider package |
| `packages/email-gmail/src/modules/email_gmail/__integration__/TC-EMAIL-*.spec.ts` | Create | Gmail integration specs (Phase 3) |
| `packages/email-microsoft/src/modules/email_microsoft/**` | Create | Microsoft provider package |
| `packages/email-microsoft/src/modules/email_microsoft/__integration__/TC-EMAIL-*.spec.ts` | Create | Microsoft integration specs (Phase 4) |
| `packages/email-imap/src/modules/email_imap/**` | Create | IMAP+SMTP provider package |
| `packages/email-imap/src/modules/email_imap/__integration__/TC-EMAIL-*.spec.ts` | Create | IMAP integration specs (Phase 5) |
| `apps/mercato/src/modules.ts` | Modify | Enable the four new modules (`email`, `email_gmail`, `email_microsoft`, `email_imap`) |
| `.ai/qa/scenarios/TC-EMAIL-*.md` | Create | Human-readable test scenarios (markdown only — no executable code) |
| `apps/docs/docs/framework/email/**` | Create | User-facing documentation |

### Testing Strategy

**Unit (Jest)**
- Per-provider: stubbed HTTP for OAuth + sync + send; verify request shape and CanonicalMessage normalization.
- OAuth state-cookie helper: encrypt/decrypt roundtrip, TTL expiry, signature tamper, userId-mismatch rejection.
- `send-pipeline`: token-refresh trigger, error classification, EmailHealthLog writes.
- `poll-account` worker: cursor advancement, drain mode, error classification, status transitions, idempotent re-ingest.
- IMAP provider: tests against in-process IMAP mock (`imap-server`).

**Integration (Playwright)** — scenarios listed in `.ai/qa/scenarios/`, executable specs in module-local `__integration__/` (see placement table above):

- TC-EMAIL-001 Connect Gmail (real OAuth, env-gated CI skip)
- TC-EMAIL-002 Connect Microsoft (real OAuth, env-gated CI skip)
- TC-EMAIL-003 Connect IMAP with valid credentials
- TC-EMAIL-004 IMAP rejects invalid credentials with field-level errors
- TC-EMAIL-005 Send via Gmail, envelope written, appears in Gmail Sent folder
- TC-EMAIL-006 Receive via Gmail polling, envelope written, `email.message.received` event emitted
- TC-EMAIL-007 Send via SMTP, appears in remote Sent folder
- TC-EMAIL-008 Receive via IMAP polling
- TC-EMAIL-009 Token refresh: stub Google refresh response, verify new tokens persisted
- TC-EMAIL-010 Refresh-token revoked → status=requires_reauth + notification arrives + banner shown
- TC-EMAIL-011 Admin sees account list, cannot read envelope contents (RBAC)
- TC-EMAIL-012 User A cannot list User B's accounts (per-user isolation)
- TC-EMAIL-013 Disconnect → credentials hard-purged, sync halted, account removed
- TC-EMAIL-014 Multi-account per user, primary swap works
- TC-EMAIL-015 Tenant-owned OAuth app overrides platform default

Per the user's standing rule and `.ai/lessons.md`, **no spec phase is marked complete without the listed module-local integration specs passing**. Phase 8 has been removed — integration tests are written and executed as part of the phase that produces the behavior being tested.

## Risks & Impact Review

### Data Integrity Failures

#### Credential blob write atomicity
- **Scenario**: OAuth callback completes; we insert EmailAccount but the credential insert fails. Result: an account row with no credentials.
- **Severity**: High
- **Affected area**: `email_accounts`, `email_account_credentials`, sync workers
- **Mitigation**: `email.account.connect` command wraps both inserts in a single MikroORM transaction. Sync worker treats "no credential row" as a hard error → status='error'.
- **Residual risk**: None significant; transactional boundary covers it.

#### Cursor regression on crashed worker
- **Scenario**: Worker fetches batch, persists envelopes, crashes before persisting new cursor. Next run re-fetches same messages.
- **Severity**: Low
- **Affected area**: Receive pipeline
- **Mitigation**: Envelope upsert is idempotent on `(email_account_id, provider_message_id)` UNIQUE. `email.message.ingest` command is idempotent (returns existing row if conflict). Event emission deduped: only emit when row was actually inserted, not updated.
- **Residual risk**: Acceptable — re-emission could happen if the crash is between insert and event publish. Downstream CRM subscribers must be idempotent on `(account_id, provider_message_id)`. Documented.

#### isPrimary race
- **Scenario**: Two concurrent `set_primary` calls leave zero or two primaries.
- **Severity**: Medium
- **Affected area**: `email_accounts`
- **Mitigation**: Partial unique index `UNIQUE (user_id) WHERE is_primary AND deleted_at IS NULL` makes "two primaries" impossible at the DB level. Command wraps both UPDATEs in a transaction at SERIALIZABLE isolation.
- **Residual risk**: None.

### Cascading Failures & Side Effects

#### Subscriber failure in `email.message.received`
- **Scenario**: Future CRM subscriber throws while processing a message.
- **Severity**: Medium
- **Affected area**: This module → CRM module
- **Mitigation**: Event is persistent; failed subscribers retry per existing platform behavior; this module's worker does not depend on subscriber success.
- **Residual risk**: A repeatedly failing subscriber could pile up. Future CRM spec defines its DLQ.

#### Provider outage
- **Scenario**: Gmail API returns 5xx for hours.
- **Severity**: Low
- **Affected area**: Inbound sync, outbound send via affected provider
- **Mitigation**: Exponential backoff up to 60-min ceiling; status stays `connected` (transient); EmailHealthLog warnings accumulate; admin can see in dashboard.
- **Residual risk**: Users on that provider experience sync lag; documented in admin UI.

#### Resend pipeline interaction
- **Scenario**: Sending via Resend AND via user account concurrently for the same recipient causes duplicate emails.
- **Severity**: Low (no caller does both today)
- **Affected area**: Outbound
- **Mitigation**: Spec explicitly states the two pipelines coexist; no automatic dual-emit; caller chooses one explicitly. CRM spec will define which calls migrate when.
- **Residual risk**: A future change could introduce duplication; mitigated by code review and the explicit `sendAsUser` vs `sendEmail` import distinction.

### Tenant & Data Isolation Risks

#### Cross-user account leakage
- **Scenario**: A bug in the list API returns another user's accounts.
- **Severity**: Critical
- **Affected area**: `/api/email/accounts`, all account-management endpoints
- **Mitigation**: All user-facing APIs filter by `WHERE user_id = currentUser.id AND tenant_id = currentSession.tenantId`. Admin endpoints require `email.admin` feature and explicitly return redacted DTOs (never `EmailAccountCredential` rows, never envelope contents). Encrypted credential blob never serialized in any response by design (separate DTO mapper).
- **Residual risk**: None at the DB layer due to encryption; defense in depth via per-route audit in code review.

#### State-cookie forgery
- **Scenario**: Attacker crafts a state cookie to bind their callback to another user's session.
- **Severity**: Critical
- **Affected area**: OAuth callback
- **Mitigation**: State payload includes `userId`; callback handler verifies it matches `currentSession.userId`. State cookie is encrypted+signed via AES-256-GCM with HKDF key derivation (forgery requires the key). HttpOnly + SameSite=Lax + 5-min TTL.
- **Residual risk**: None given the key is properly managed (uses existing KMS pattern).

#### IMAP credential exposure
- **Scenario**: A debugging log or stack trace inadvertently includes the credential blob.
- **Severity**: Critical
- **Affected area**: Worker logs, error reporting
- **Mitigation**: `EmailHealthLog.context` schema explicitly rejects keys named `credential*`, `password*`, `token*`, `secret*` (enforced via Zod validator). Worker error handlers strip credential fields from any caught exception before logging. Unit tests assert this behavior.
- **Residual risk**: New code paths could accidentally log credentials. Mitigated by enforcing the rejected-keys Zod validator on `EmailHealthLog.context` writes (any attempt to log a `credential*`/`password*`/`token*`/`secret*` key throws). Code review remains the second line of defense.

### Migration & Deployment Risks

#### Schema deploy without provider packages
- **Scenario**: Core module migration runs in prod before provider packages are deployed.
- **Severity**: Low
- **Affected area**: Bootstrap
- **Mitigation**: Migration is purely additive — empty tables don't break anything. Provider packages enable themselves at boot; their absence means `Connect Account` shows no providers, which is the graceful empty state.
- **Residual risk**: None.

#### Module-enable in `modules.ts` without cache purge
- **Scenario**: Operator merges the spec, deploys, but forgets `yarn mercato configs cache structural --all-tenants`.
- **Severity**: Medium
- **Affected area**: Sidebar visibility, navigation
- **Mitigation**: AGENTS.md mandates this command on any module-graph change. Deploy runbook addition recorded in changelog.
- **Residual risk**: Operator omission; mitigated by Turbopack stale-chunk check.

### Operational Risks

#### Polling fanout overwhelms providers
- **Scenario**: 10,000 connected Gmail accounts all polled simultaneously.
- **Severity**: Medium
- **Affected area**: Gmail API quota, worker queue
- **Mitigation**: Per-account `last_polled_at + poll_interval_seconds` gate spreads load. Queue concurrency capped (10). Rate-limit honoring via `Retry-After` header. Aggregate quota monitoring deferred to ops dashboard (later spec).
- **Residual risk**: Quota exhaustion at very high scale. Mitigated by tenant-owned OAuth app config (each tenant has their own quota pool).

#### Envelope cap purge falls behind
- **Scenario**: `purge-envelopes` worker fails or is slow; envelope table grows unbounded.
- **Severity**: Low
- **Affected area**: Storage cost
- **Mitigation**: Cap is per-account (200), enforced on insert via "delete oldest if count > cap" within the `ingestMessage` command — so the cap is maintained even without the worker. The worker is a belt-and-suspenders sweep for ops resilience.
- **Residual risk**: None.

#### Health-log unbounded growth
- **Scenario**: `purge-health-log` worker fails; logs accumulate.
- **Severity**: Low
- **Affected area**: Storage cost
- **Mitigation**: 90-day retention by default; admin dashboard surfaces the worker last-run timestamp.
- **Residual risk**: Operator visibility required.

#### Email-bomb amplification
- **Scenario**: A user's mailbox receives 100k unread messages in a short window; polling drains them all and emits 100k events.
- **Severity**: Medium
- **Affected area**: Event bus, downstream CRM subscribers
- **Mitigation**: `poll-account` worker hard-caps `limit=100` per call; drain mode re-enqueues with backoff after every 5 drains; emits an `email.account.error` (severity=info) when drain exceeds 20 iterations.
- **Residual risk**: Sustained high-volume mailbox = sustained event load. CRM subscribers must handle backpressure.

## Final Compliance Report — 2026-05-21

### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `packages/core/AGENTS.md`
- `packages/shared/AGENTS.md`
- `packages/ui/AGENTS.md`
- `packages/ui/src/backend/AGENTS.md`
- `packages/events/AGENTS.md`
- `packages/queue/AGENTS.md`
- `packages/cache/AGENTS.md`
- `packages/core/src/modules/integrations/AGENTS.md`
- `.ai/specs/AGENTS.md`
- `.ai/ds-rules.md`, `.ai/ui-components.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|---|---|---|---|
| root AGENTS.md | Modules plural, snake_case (with exceptions for `auth`/`example`/`catalog`/etc.) | Compliant w/ caveat | Module id is `email` (singular). Mixed precedent in the codebase (`auth`, `catalog`, `data_sync`, `ai_assistant` are singular; `customers`, `messages`, `notifications`, `sales` are plural). Recommend confirming with user before implementation; rename to `emails` if strict plural is preferred. Event IDs and feature IDs would then become `emails.account.*` and `emails.account.connect` etc. — all mechanical. |
| root AGENTS.md | No direct ORM relationships between modules | Compliant | `EmailAccount → User` is FK ID only (`user_id`), no MikroORM relation across module boundaries. |
| root AGENTS.md | Filter by `organization_id` | Compliant | All five tables carry `tenant_id` + `organization_id`; all queries scoped. |
| root AGENTS.md | Validate inputs with zod | Compliant | `data/validators.ts` covers all API bodies and command payloads. |
| root AGENTS.md | Encrypt sensitive data via `encryption.ts` (no hand-rolled crypto) | Compliant | `credential_blob` registered in `encryption.ts`; reads use `findOneWithDecryption`. Uses existing AES-GCM + tenant-scoped DEK pipeline. |
| root AGENTS.md | Provider packages live in `packages/<provider-package>/` | Compliant | `email-gmail`, `email-microsoft`, `email-imap` are workspace packages. |
| root AGENTS.md | Commands for write operations | Compliant | 9 commands enumerated; each documents Undo or notes its non-undoability with rationale. |
| root AGENTS.md | RBAC via features, not roles | Compliant | 5 features in `acl.ts`; routes use `requireFeatures` — no `requireRoles`. |
| root AGENTS.md | Run `yarn mercato configs cache structural --all-tenants` after `modules.ts` change | Compliant | Documented in Migration & Compatibility + per-phase acceptance criteria. |
| packages/core/AGENTS.md | API route files export `metadata` with per-method `requireAuth`/`requireFeatures` | Compliant | API Contracts intro explicitly documents this — no top-level `export const requireAuth`. |
| packages/core/AGENTS.md | API routes MUST export `openApi` | Compliant | All routes export `openApi` per implementation plan. |
| packages/core/AGENTS.md | CRUD routes use `makeCrudRoute` with `indexer: { entityType }` | Compliant | Listed account routes + admin routes use `makeCrudRoute`. OAuth callback / IMAP connect / set-primary / send / OAuth init are bespoke (don't fit CRUD shape) — they call `validateCrudMutationGuard` + `runCrudMutationGuardAfterSuccess` per the custom-write-route rule. |
| packages/ui/AGENTS.md | `apiCall` not raw `fetch` | Compliant | Client side uses `apiCall` / `apiCallOrThrow`. |
| packages/ui/AGENTS.md | `useGuardedMutation` for non-CrudForm writes | Compliant | "Connect", "Disconnect", "Set primary", "Reconnect" actions wrap writes in `useGuardedMutation` and pass `retryLastMutation`. |
| packages/ui/AGENTS.md | `<CrudForm>` for backend forms; field-level errors via `createCrudFormError` | Compliant | IMAP connect dialog uses `<CrudForm>` with `createCrudFormError` for credential-validation failures. |
| packages/ui/AGENTS.md | `<DataTable entityId apiPath columns>` with stable `entityId`/`extensionTableId` | Compliant | All three lists (user accounts, admin accounts, admin health log) use `<DataTable>` with stable `entityId`s for widget injection. |
| packages/ui/AGENTS.md | Dialog Cmd/Ctrl+Enter, Escape | Compliant | Documented in UI section. |
| packages/ui/AGENTS.md | `aria-label` on icon-only buttons | Compliant | UI section explicitly requires it per `.ai/ui-components.md`. |
| packages/ui/AGENTS.md | `pageSize ≤ 100`; cursor/keyset pagination for large lists | Compliant | API Contracts pagination paragraph specifies cursor with limit ≤ 100; health log uses keyset on `(created_at DESC, id DESC)`. |
| packages/events/AGENTS.md | `createModuleEvents` with `as const` | Compliant | Events declared via the helper. |
| packages/events/AGENTS.md | `persistent: true` for subscribable side effects | Compliant | All 6 events persistent. |
| packages/events/AGENTS.md | Cross-module side effects via events, not direct imports | Compliant | CRM consumes events; no direct imports. |
| packages/queue/AGENTS.md | Idempotent workers | Compliant | Cursor + envelope upsert idempotent; `email.message.ingest` command idempotent on `(account_id, provider_message_id)` UNIQUE; event-emit only on actual insert. |
| packages/cache/AGENTS.md | DI-resolved cache; tenant-scoped tags | N/A | This spec does not introduce caching. Future inbox/CRM specs will. |
| .ai/ds-rules.md | Semantic status tokens (no hardcoded shades) | Compliant | UI section uses `bg-status-*-soft text-status-*-fg`; no `text-red-*`, no `bg-green-*`, no `dark:` overrides on status. |
| .ai/ds-rules.md | Tailwind text scale (no arbitrary sizes) | Compliant | No `text-[13px]`, no `p-[13px]`, no arbitrary values. |
| .ai/ui-components.md | lucide-react via icon registry in page body | Compliant | UI section specifies `@open-mercato/ui/backend/icons`. No inline `<svg>`. |
| .ai/ui-components.md | Shared primitives (`Alert`, `StatusBadge`, `EmptyState`, `CollapsibleSection`, `LoadingMessage`/`Spinner`/`DataLoader`) | Compliant | UI section enumerates the primitives used. |
| .ai/specs/AGENTS.md | Required sections (10) | Compliant | All present: TLDR, Overview, Problem Statement, Proposed Solution, Architecture, Data Models, API Contracts, Risks & Impact Review, Final Compliance Report, Changelog. |
| .ai/specs/AGENTS.md | Risk register format | Compliant | All risks use the required block format with Scenario/Severity/Affected area/Mitigation/Residual risk. |
| spec-writing skill | Frontend Architecture Contract (when touching `app/**`) | Compliant | Included Server/Client boundary map, `"use client"` ledger, client blob guardrail, route budgets, hydration test, provider/bootstrap scope. |
| spec-writing skill | Security: input validation, parameterized queries, XSS protections, encoding, secret exclusion | Compliant | Security Posture subsection in Architecture documents each: zod everywhere, MikroORM (no raw SQL), no HTML rendering in v1 (XSS N/A), URL building via `URLSearchParams`, credential-key rejection in log validators. |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Data models match API contracts | Pass | DTOs in API contracts correspond to entity fields; redacted fields explicitly noted for admin endpoints. |
| API contracts match UI/UX section | Pass | Every UI action maps to a documented API route. |
| Risks cover all write operations | Pass | Connect, disconnect, set-primary, rename, send, ingest, refresh all addressed. |
| Commands defined for all mutations | Pass | 9 commands cover all state changes. |
| Events cover all state-change announcements | Pass | account.connected/disconnected/requires_reauth/error + message.received/sent. |
| Encryption declared for all sensitive columns | Pass | `credential_blob` is the only sensitive column; declared. |
| Backward compatibility analysis covers every modified surface | Pass | Table enumerates every contract surface, all additive. |

### Non-Compliant Items

None.

### Verdict

- **Fully compliant**: Approved — ready for implementation.

## Changelog

### 2026-05-21
- Initial specification.

### Review — 2026-05-21
- **Reviewer**: Agent (spec-writing skill, adversarial pass)
- **Security**: Passed — added explicit Security Posture subsection covering XSS N/A in v1, URL/header encoding, parameterized queries, secret-key rejection in `EmailHealthLog.context` validator
- **Performance**: Passed — added scheduler N+1 mitigation note (single indexed scan on `(status, last_polled_at)`, 500-row enumeration cap per tick) and cursor/keyset pagination for admin lists
- **Cache**: N/A — this spec does not introduce caching
- **Commands**: Passed — 9 commands, undo behavior documented for every mutation, non-undoability explicitly justified for send (cannot un-send) and refresh_token (no business undo)
- **Risks**: Passed — 13 concrete scenarios across all 5 categories (data integrity, cascading, isolation, deployment, operational), each with severity + mitigation + residual
- **Verdict**: Approved

### Review fixes — 2026-05-21
- API Contracts: added per-method `metadata` requirement, cursor pagination, `makeCrudRoute` vs bespoke route delineation with `validateCrudMutationGuard` for custom writes
- UI: added explicit `aria-label` requirement for icon-only buttons and `pageSize ≤ 100` cursor pagination for DataTables
- Architecture: added Security Posture subsection (XSS, URL encoding, parameterized queries, log-key rejection)
- Architecture: added scheduler N+1 mitigation note
- Compliance Matrix: expanded from 22 to 30 rules, all marked Compliant except module-name plurality (Compliant with caveat — flagged for user confirmation)

### Pre-implementation analysis fixes — 2026-05-21
Findings from `.ai/specs/analysis/ANALYSIS-2026-05-21-email-integration-foundation.md` applied:
- **Encryption snippet** rewritten to canonical `defaultEncryptionMaps: ModuleEncryptionMap[]` export from `@open-mercato/shared/modules/encryption`. Previous draft imported a non-existent `registerEntityEncryption` symbol.
- **Events snippet** rewritten to canonical `createModuleEvents({ moduleId, events })` shape with full dotted IDs in an `as const` array. Payload types moved to TS aliases referenced via the typed `emit`. `persistent: true` documented as a subscriber-metadata field, not an event-definition field.
- **Provider package layout** restructured to `packages/<pkg>/src/modules/<module_id>/...` to match `gateway-stripe` / `sync-akeneo` conventions and align module IDs with auto-discovery (dashes → underscores).
- **Access Control section** added: five ACL features enumerated with `id`/`title`/`module`, plus a `defaultRoleFeatures` map (admin gets all five; manager/user get connect+manage+send). `email.admin.providers` is the fifth feature, separated from `email.admin` to gate OAuth-client-credential writes.
- **`modules.ts` entries** documented explicitly with underscore-converted IDs (`email_gmail`, `email_microsoft`, `email_imap`) and the required structural-cache purge.
- **OSS Independence** section added: explicit ban on `@open-mercato/enterprise` imports from this module and its provider packages, with a Phase 1 grep-based verification step. State-cookie helper is ported (re-implemented locally), not imported.
- **`AttachmentRef` type** defined as a Zod discriminated union (`attachment` referencing the existing attachments module, or `inline` for ad-hoc content with hard size caps).
- **Phase 8 removed**: integration tests moved in-phase. Each phase ships its own module-local Playwright specs under `<package>/src/modules/<id>/__integration__/` per `.ai/lessons.md`. `.ai/qa/scenarios/` retains only markdown scenarios.
- **Section title**: "Migration & Compatibility" renamed to "Migration & Backward Compatibility" to match `BACKWARD_COMPATIBILITY.md` recommendation.
- **Cross-process event bridge note** added to the events section: any future flip of `email.message.received` to `clientBroadcast: true` MUST be paired with the cross-process bridge work (see `.ai/lessons.md` → "Browser SSE bridges must work across worker and web processes").
