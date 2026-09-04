# Microsoft 365 email channel via Microsoft Graph — `@open-mercato/channel-ms365`

- **Status**: Phase 1 implemented on branch `feat/channel-ms365` (2026-09-04); pending PR review, manual QA against a real Entra tenant, and phase 2 (push)
- **Date**: 2026-09-04
- **Scope**: OSS
- **Hub**: `communication_channels` (SPEC-045d)
- **Related specs**:
  - `.ai/specs/implemented/2026-05-27-crm-email-integration.md` (email channel foundation: per-user
    channels, OAuth routes, credential storage, polling worker)
  - `.ai/specs/implemented/2026-05-27-email-integration-inbound-reliability-and-threading.md`
    (cursor semantics, threading, push architecture — Gmail)
  - `.ai/specs/implemented/SPEC-045a-foundation.md` § 8 (integrations OAuth requirement)
- **Reference implementation**: `packages/channel-gmail` (OAuth + REST provider),
  `packages/channel-imap` (MIME pipeline reuse)

---

## TLDR

**Key points**

- Add a **Microsoft 365 email channel provider** package `@open-mercato/channel-ms365`
  (module id `channel_ms365`, provider key `ms365`) under the existing `communication_channels`
  hub. It implements the existing `ChannelAdapter` contract; **no new framework primitives and no
  `packages/core` changes in phase 1**.
- **Transport is Microsoft Graph**, not IMAP/SMTP. Auth is the standard Entra ID OAuth 2.0
  authorization-code flow (v2.0 endpoints, PKCE S256, confidential client) through the hub's existing
  `/oauth/[provider]/initiate` + `/oauth/[provider]/callback` routes, exactly like Gmail.
- **Inbound** uses the Graph **delta query** on the Inbox folder as the incremental cursor (the
  Microsoft counterpart of Gmail `historyId`), polled by the hub's existing `poll-channel` worker
  (5-minute default). Messages are fetched as **raw MIME** (`/messages/{id}/$value`) and normalized
  through the shared `email-mime` helpers already used by Gmail and IMAP, so threading, attachments,
  and contact resolution behave identically across email providers.
- **Outbound** builds RFC 2822 bytes with the shared `assembleRfc2822` helper, creates a Graph draft
  from MIME (`POST /me/messages`) and sends it (`POST /me/messages/{id}/send`). Graph saves the copy
  to Sent Items itself — no Sent-folder append.
- **Phase 1 = polling only.** Graph change notifications (push) are phase 2 and are scoped in
  § Phase plan, including the small core generalisation they need.

**Concerns**

- Microsoft **rotates refresh tokens on every refresh**. The adapter MUST persist the new refresh
  token from each refresh response; the hub's in-process single-flight in `credential-refresh.ts`
  covers the concurrent-refresh race for the single-process case (same as Gmail).
- Delta tokens **expire** (Graph returns `410 Gone` / `syncStateNotFound`). The adapter re-bootstraps
  from a persisted `receivedDateTime` watermark so no mail is lost — see § Inbound sync model.
- The tenant admin may have **disabled the mailbox for REST/Graph access** or restricted user
  consent. Both surface as actionable, permanent errors (never as silent retries).
- `SocialButton` has no `microsoft` brand today. Phase 1 uses the plain DS `Button` (as IMAP does) to
  avoid touching design-system governance files; a `microsoft` brand is an optional follow-up.

---

## Overview

Open Mercato's Communications Hub connects per-user mailboxes so CRM users can send and receive
email from inside the platform. Two email providers exist today:

| Provider | Package | Auth | Inbound | Outbound |
|---|---|---|---|---|
| Gmail | `channel-gmail` | OAuth 2.0 (Google) | History API polling (+ optional Pub/Sub push) | `users.messages.send` |
| IMAP + SMTP | `channel-imap` | username/password (app password) | IMAP UID polling | SMTP + IMAP APPEND |

Microsoft 365 / Outlook mailboxes are the most common corporate mailbox after Gmail, and the user
guide currently says: *"There is no dedicated Microsoft 365 / Outlook connector; connect those
mailboxes through IMAP + SMTP using an app password."* That advice no longer works in practice:
Microsoft retired Basic authentication for IMAP/SMTP in Exchange Online, "app passwords" only exist
for personal accounts with legacy settings, and Security Defaults disable authenticated SMTP
tenant-wide. Corporate Microsoft 365 users therefore **cannot connect a mailbox today**.

This spec adds a first-class Microsoft 365 provider built on Microsoft Graph, mirroring the Gmail
provider's shape so the hub, the UI, the docs, and the operational model stay symmetrical.

---

## Problem statement

1. **No working path for Microsoft 365 mailboxes.** IMAP/SMTP with passwords is blocked by
   Microsoft; the hub has no OAuth-capable Microsoft provider.
2. **IMAP + XOAUTH2 was evaluated and rejected** (see § Design decisions). It would still depend on
   the IMAP protocol and on "Authenticated SMTP" being enabled per mailbox — both are routinely
   disabled by tenant security baselines and are outside our control.
3. **Parity with Gmail.** Users and operators expect the same experience: an admin registers an
   OAuth app once in Integrations, each user clicks *Connect*, consents, and the mailbox syncs
   without further configuration.

---

## Proposed solution

Ship `@open-mercato/channel-ms365` as a provider package that:

1. Registers a `ChannelAdapter` with `providerKey: 'ms365'`, `channelType: 'email'`,
   `channelScope: 'user'` (per-user mailbox, same as Gmail/IMAP).
2. Implements `buildOAuthAuthorizeUrl` / `exchangeOAuthCode` / `refreshCredentials` against Entra
   ID v2.0 endpoints, packing the PKCE verifier into the hub's signed state cookie via
   `BuildOAuthAuthorizeUrlResult.extra`.
3. Implements `fetchHistory` (delta polling), `importHistory` (operator back-fill), `sendMessage`,
   `convertOutbound`, `normalizeInbound`, `deleteMessage`, `resolveContact`, `getStatus`,
   `verifyWebhook` (returns `eventType: 'other'` — no webhook in phase 1).
4. Declares an `IntegrationDefinition` (`channel_ms365`) whose tenant-level credential fields are
   the OAuth client app config (Client ID, Client Secret, Directory/tenant ID, optional scopes) and
   whose health check validates that config (`makeClientConfigHealthCheck`).
5. Injects a *Connect Microsoft 365* button into the existing
   `profile:communication-channels:connect` widget spot using the shared `useConnectChannel` hook.
6. Ships unit tests (jest, stubbed Graph + OAuth clients), integration tests (Playwright, route
   wiring + tenant config + UI), a user-guide page, and this spec.

### Design decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | **Graph over IMAP/SMTP + XOAUTH2** | Graph needs only standard delegated permissions (`Mail.ReadWrite`, `Mail.Send`). IMAP requires the IMAP protocol *and* Authenticated SMTP to be enabled per mailbox, which Security Defaults and most conditional-access baselines turn off. Graph delta is one request per tick versus a full TLS+LOGIN+SELECT+SEARCH+FETCH cycle on Microsoft's slow IMAP front-ends. Graph is also the path to push (phase 2), shared mailboxes, and calendar/contacts reuse of the same token. The maintainer's own reliability spec records the same conclusion for Gmail ("native APIs are dramatically more reliable than IMAP-XOAUTH2"). |
| D2 | **Separate package, not an `authMethod` switch in `channel-imap`** | One `integration_id` would otherwise carry two credential schemas (tenant OAuth client config vs per-user IMAP passwords) and the IMAP health check parses the tenant row as passwords. A separate provider mirrors the Gmail/IMAP split already in the repo. |
| D3 | **Raw MIME in both directions** | `GET /messages/{id}/$value` and draft-from-MIME let the provider reuse `normalizeMimeInbound`, `assembleRfc2822`, `mailparser`, header sanitisation, and the contact-resolution path shared with Gmail and IMAP. No Graph-JSON-to-hub mapping layer to maintain. |
| D4 | **Draft-from-MIME + `/send` instead of `/me/sendMail`** | `sendMail` returns `202` with no body, so the `internetMessageId` Exchange actually stamps is unknown and may differ from the one we generate. Creating the draft first returns the authoritative `internetMessageId` and `conversationId`, which become `externalMessageId` / `conversationId` on the send result. One extra request per send is acceptable for a CRM send volume. |
| D5 | **Immutable IDs** | Every Graph call sends `Prefer: IdType="ImmutableId"`. Default Graph message ids change when a message moves folders, which would break `deleteMessage` and metadata lookups. |
| D6 | **`receivedDateTime` watermark next to the delta link** | Delta returns *changes* (new mail, flag updates, deletes). Ingesting flag updates on old mail would cost a `$value` fetch per change. The adapter ingests only items whose `receivedDateTime` is at or after the persisted watermark, and the same watermark drives re-bootstrap after a `410`. |
| D7 | **Confidential client with client secret, plus PKCE** | Matches the Gmail pattern (secret stored encrypted at tenant scope). PKCE is cheap, supported by Entra, and hardens the code exchange. Certificates are out of scope. |
| D8 | **`tenantId` field defaults to `organizations`** | Personal Microsoft accounts (Outlook.com, Hotmail) are **not** accepted by default: `organizations` restricts consent to work/school accounts in any Entra directory. Admins pin a directory (tenant) GUID to allow only their own directory, or set `common` to also accept personal accounts (Outlook.com uses the same Graph mail API, so the adapter works unchanged). The value is only used to build the authority URL. |
| D9 | **Phase 1 polling only** | Push (Graph change notifications) requires a provider-owned webhook route with the validation-token handshake, subscription renewal (≤ 3 days lifetime), and generalising three `provider === 'gmail'` hardcodes in the hub. Kept in phase 2 to keep phase 1 core-change-free. |
| D10 | **No DS changes** | Connect button uses `Button variant="outline"` like IMAP. Adding a `microsoft` `SocialButton` brand touches design-system governance files and is deferred. |

---

## Architecture

### Package layout (`packages/channel-ms365/`)

Same scaffold as `channel-gmail` (`build.mjs`, `watch.mjs`, `jest.config.cjs`, `tsconfig.json`,
`package.json` with the `./*` export map, `AGENTS.md`).

| File (`src/modules/channel_ms365/`) | Purpose |
|---|---|
| `index.ts` | Module `metadata` (`id: 'channel_ms365'`) |
| `integration.ts` | `IntegrationDefinition` — `providerKey: 'ms365'`, tenant credential fields, `healthCheck.service: 'channelMs365HealthCheck'`, detail widget spot |
| `di.ts` | `register(container)` — registers the adapter (idempotent) and `channelMs365HealthCheck` under the exact `healthCheck.service` name |
| `setup.ts` | Registers the adapter at import time; `defaultRoleFeatures` (`channel_ms365.view`, `channel_ms365.configure` for `superadmin`/`admin`) |
| `acl.ts` | `channel_ms365.view`, `channel_ms365.configure` |
| `lib/credentials.ts` | Zod schemas: tenant OAuth client config, per-user tokens, channel sync state, default scopes |
| `lib/oauth.ts` | `MicrosoftOAuthClient` — authorize URL (PKCE), code exchange, refresh, `/me` profile; swappable via `setMicrosoftOAuthClient` |
| `lib/graph-client.ts` | `GraphMailClient` — delta, list, get MIME, create draft from MIME, send draft, move to Deleted Items; `GraphApiError` with `status`, `code`, `retryAfterMs`; swappable via `setGraphMailClient` |
| `lib/adapter.ts` | `Ms365ChannelAdapter` — implements `ChannelAdapter` |
| `lib/convert-outbound.ts` | Hub payload → RFC 2822 bytes via shared `assembleRfc2822` (Gmail-equivalent) |
| `lib/normalize-inbound.ts` | Raw MIME + Graph metadata → `NormalizedInboundMessage` via shared `normalizeMimeInbound` |
| `lib/capabilities.ts` | `baseEmailCapabilities` + `deleteMessage: true` |
| `lib/health.ts` | `channelMs365HealthCheck = makeClientConfigHealthCheck(...)` |
| `lib/errors.ts` | Graph error → hub classification (`requires_reauth` sentinel, `transient`, `status`) |
| `widgets/injection-table.ts` | Spot `profile:communication-channels:connect`, priority `110` |
| `widgets/injection/connect/widget.ts` / `widget.client.tsx` | *Connect Microsoft 365* button → `useConnectChannel({ providerKey: 'ms365' })` |
| `lib/__tests__/*.test.ts` | Jest unit tests (stubbed clients) |
| `__integration__/TC-CHANNEL-MS365-*.spec.ts` | Playwright integration tests |

Registration touch-points (every place the existing channel packages are listed — verified by
`grep -rn channel-gmail` outside the package itself):

| Touch-point | Change |
|---|---|
| `apps/mercato/package.json` | dependency `"@open-mercato/channel-ms365": "workspace:*"` |
| `apps/mercato/src/modules.ts` | `{ id: 'channel_ms365', from: '@open-mercato/channel-ms365' }` next to `channel_gmail` |
| `packages/create-app/template/src/modules.ts` | same entry so standalone apps scaffold with the provider |
| `Dockerfile` (3× `COPY packages/<pkg>/package.json`) | add `channel-ms365` lines beside `channel-gmail` |
| `.github/workflows/package-previews.yml` | add `./packages/channel-ms365` to the preview package list |
| `eslint.ds.config.mjs` | strict `error`-severity `om-ds/*` override block for the new package (new modules start with zero DS debt) |
| `apps/docs/sidebars.ts` | new user-guide page entry |
| `packages/core/src/modules/communication_channels/i18n/*.json` | `communication_channels.profile.connect.ms365` label (en, pl, de, es, ko) |

`CHANGELOG.md` is release-managed (CONTRIBUTING → Releasing, Stage 0) and is not edited by the
feature PR. Publishing needs nothing extra: `scripts/publish-packages.sh` discovers every
non-private workspace under `packages/`. After wiring, run `yarn generate`.

### OAuth flow (Entra ID v2.0)

Reuses the hub routes unchanged:

```
POST /api/communication_channels/oauth/ms365/initiate   → adapter.buildOAuthAuthorizeUrl
GET  /api/communication_channels/oauth/ms365/callback   → adapter.exchangeOAuthCode → channel row
```

| Step | Detail |
|---|---|
| Authority | `https://login.microsoftonline.com/{tenantId}/oauth2/v2.0` where `tenantId` comes from the tenant client config (default `common`). |
| Authorize URL | `/authorize?client_id&redirect_uri&response_type=code&response_mode=query&scope&state&code_challenge&code_challenge_method=S256&prompt=select_account[&login_hint]`. `state` is the hub-minted value verbatim. |
| PKCE | Adapter generates a 43–128 char verifier, returns `{ extra: { codeVerifier, scopes } }`; the hub encrypts it into the state cookie and hands it back as `stateExtra` on the callback. |
| Scopes (default) | `offline_access openid profile email https://graph.microsoft.com/User.Read https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Mail.Send`. Admin may override via the optional `scopes` field; `offline_access` is always re-added (no refresh token without it). |
| Code exchange | `POST /token` form: `grant_type=authorization_code, code, redirect_uri, client_id, client_secret, code_verifier, scope`. Uses shared `requestOAuthToken` (timeout, error mapping). |
| Identity | `GET https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName,displayName`. `externalIdentifier = (mail ?? userPrincipalName).toLowerCase()`. Fallback when `/me` fails: `preferred_username` from the `id_token` payload (decoded, not verified — it only seeds a display value; the hub already binds the session). |
| Refresh | `POST /token` form: `grant_type=refresh_token, refresh_token, client_id, client_secret, scope`. Microsoft returns a **new** `refresh_token` on every call; the adapter persists it (fallback to the previous one only if absent). `expiresAt` computed via shared `tokenResponseToExpiresAt`. Missing refresh token or `invalid_grant` ⇒ throw `requires_reauth`. |
| Client config resolution | Tenant row `integration_credentials(integration_id='channel_ms365', user_id=NULL)` resolved by the hub (`resolveOAuthClientCredentials`) for initiate, callback, and `RefreshCredentialsInput.oauthClient`. The adapter reads `oauthClient` first and falls back to the deprecated `credentials._client` shape only for parity with Gmail fixtures. |

### Inbound sync model (delta polling)

Executed by the hub's `poll-channel` worker through `adapter.fetchHistory` with the persisted
`channelState`; the adapter returns `nextCursor` = base64 JSON of the new state (shared
`encodeCursor`/`decodeCursor`).

All Graph requests carry `Authorization: Bearer`, `Prefer: IdType="ImmutableId"`, and on delta
`Prefer: odata.maxpagesize=<limit>`.

```
                       channelState
  ┌──────────────────────────────────────────────────────────────────────┐
  │ (empty)            → BOOTSTRAP                                        │
  │ nextLink           → CONTINUE (mid-drain page)                        │
  │ deltaLink          → INCREMENTAL                                      │
  └──────────────────────────────────────────────────────────────────────┘

BOOTSTRAP
  floor := now - 2 min                                // BOOTSTRAP_OVERLAP_MS
  GET /me/mailFolders/inbox/messages/delta
      ?$select=id,internetMessageId,receivedDateTime,isDraft,conversationId
      &$filter=receivedDateTime ge {floor}
  drain nextLink pages until deltaLink (nothing is normalized)
  state := { deltaLink, receivedWatermark: floor, lastSyncedAt }
  return { messages: [], hasMore: false }            // no back-fill, as Gmail

  Why the 2-minute overlap: a mail received a second before the delta token is
  minted is neither in a `receivedDateTime ge now` initial page nor in any later
  change page (it never changes again). Filtering from `now - 2 min` and letting
  the watermark rule re-read that window on the first incremental tick closes
  the race; the hub dedups by message id.

INCREMENTAL / CONTINUE
  GET {deltaLink | nextLink}
  for each item:
     skip if "@removed" | isDraft | receivedDateTime < receivedWatermark
     GET /me/messages/{id}/$value  → raw MIME
     normalize → NormalizedInboundMessage (channelMetadata: graphMessageId, conversationId)
  on page success:
     if @odata.nextLink  → state := { ...state, nextLink, deltaLink,
                                      pendingWatermark: max(pending, seen) }   ; hasMore: true
     if @odata.deltaLink → state := { deltaLink, nextLink: undefined,
                                      receivedWatermark: max(prev, pending, seen) }
  on transient $value failure (hardFailed):
     state unchanged (same link re-read next tick), hasMore: true
```

Invariants (carried over from the Gmail L3 rule in the reliability spec):

- The stored link only advances **after every message of the page was normalized**. A transient
  failure mid-page throws; the hub keeps the previous `channelState` and re-fetches the same page
  next tick. Hub-level dedup on `(channel_id, external_message_id)` makes the replay idempotent.
- A `$value` fetch that returns `404` (message deleted between delta and fetch) is skipped, not
  fatal.
- `410 Gone` (`syncStateNotFound`, `resyncRequired`, `syncStateInvalid`) ⇒ re-bootstrap with
  `$filter=receivedDateTime ge {receivedWatermark}` and **ingest** that page (unlike the first
  connect) so mail received while the token was dead is still picked up. The watermark is never
  moved backwards.
- `429` ⇒ throw `GraphApiError` with `transient: true` and `status: 429`; the hub's classifier
  retries with backoff. `Retry-After` is surfaced in the error for logging.
- `401` ⇒ throw with the `requires_reauth` sentinel; the hub flips the channel and emits
  `communication_channels.channel.requires_reauth` (existing behaviour).
- `403` with Graph codes `ErrorAccessDenied`, `MailboxNotEnabledForRESTAPI`,
  `ErrorInvalidUser` ⇒ permanent error with an operator-actionable message (mailbox not licensed /
  REST disabled / consent missing). Not retried.

Known limitation (documented in the user guide): a message *moved* into the Inbox whose
`receivedDateTime` predates the watermark is not ingested by polling. `importHistory` covers it.

### Historical import (`importHistory`)

Operator-triggered via the existing `/import-history` endpoint and `channel-import-history` worker.

```
GET /me/mailFolders/inbox/messages
    ?$select=id,internetMessageId,receivedDateTime,isDraft
    &$filter=receivedDateTime ge {now - sinceDays}[ and (from/emailAddress/address eq 'a' or ...)]
    &$orderby=receivedDateTime desc&$top={pageSize}&$count=true
    ConsistencyLevel: eventual
```

- `contactEmails` chunked into OR groups of at most 15 addresses per request (Graph filter length
  limits); pages are merged and capped by `maxMessages`.
- `cursor` = base64 JSON `{ nextLink, chunkIndex, fetched }`; `totalCandidates` from `@odata.count`
  on the first page when available.
- Each candidate is fetched as MIME and normalized exactly like polling.

### Outbound (`sendMessage`)

```
convertOutbound → assembleRfc2822 (shared) → MIME bytes
POST /me/messages            Content-Type: text/plain   body = base64(MIME)
  → { id, internetMessageId, conversationId }
POST /me/messages/{id}/send  → 202
result: { externalMessageId: internetMessageId, conversationId, status: 'sent',
          metadata: { graphMessageId, graphConversationId } }
```

- `From` is the connected mailbox (`credentials.email`); Graph rejects a mismatch, which surfaces as
  a permanent `ErrorSendAsDenied` message.
- Reply threading: `In-Reply-To` / `References` from `channelMetadata` are written into the MIME as
  today for Gmail; Exchange also threads on them and assigns the `conversationId`.
- `401` ⇒ `{ status: 'failed', error: 'requires_reauth' }` (sentinel, same as Gmail).
- If the draft was created but `/send` fails permanently, the adapter deletes the draft
  (best-effort) so the user's Drafts folder does not accumulate orphans.
- Attachments: `fileSharing: false` in phase 1 (same as Gmail/IMAP — the shared converter does not
  stitch attachment bytes yet). Re-enable together with the other providers.

### Delete (`deleteMessage`)

Mirrors Gmail's trash semantics: look up the Graph id
(`channelMetadata.graphMessageId` when present, else
`GET /me/messages?$filter=internetMessageId eq '{externalMessageId}'&$select=id`), then
`POST /me/messages/{id}/move { destinationId: 'deleteditems' }`. A `404` is swallowed (already gone).

### Contact resolution

`resolveContact` returns `{ email, displayName }` from the normalized sender — identical to Gmail.

### Health check

`makeClientConfigHealthCheck({ schema: ms365ClientCredentialsSchema, providerLabel: 'Microsoft 365',
healthyDetails: ({ tenantId }) => ({ tenantId }) })`. The hub passes the tenant-scoped client config,
so no network call; per-user token validity surfaces on the channel (`requires_reauth`).

### UI

- Connect button widget in spot `profile:communication-channels:connect`, feature
  `communication_channels.connect_user_channel`, priority `110`. Label key
  `communication_channels.profile.connect.ms365` (`Connect Microsoft 365`), plus the existing
  `connecting` / `notConfigured` / `oauthFailed` keys already used by `useConnectChannel`.
- Integrations page: `channel_ms365` appears in the Communication category with the tenant
  credential form generated from `integration.credentials.fields`.
- i18n keys are added to `packages/core/src/modules/communication_channels/i18n/*.json` (the same
  files that hold the Gmail and IMAP connect labels) for `en`, `pl`, `de`, `es`, `ko`.

### Adapter method map

| `ChannelAdapter` method | Implemented | Notes |
|---|---|---|
| `sendMessage` | ✅ | draft-from-MIME + send |
| `verifyWebhook` | ✅ (no-op) | returns `eventType: 'other'` — polling provider, no webhook in phase 1 |
| `getStatus` | ✅ | `{ status: 'sent' }` placeholder (Graph has no per-message delivery status), same as Gmail |
| `convertOutbound` | ✅ | shared `assembleRfc2822` |
| `normalizeInbound` | ✅ | shared `normalizeMimeInbound` |
| `fetchHistory` | ✅ | delta polling |
| `importHistory` | ✅ | date/sender-filtered list |
| `deleteMessage` | ✅ | move to Deleted Items |
| `resolveContact` | ✅ | email + display name |
| `buildOAuthAuthorizeUrl` / `exchangeOAuthCode` / `refreshCredentials` | ✅ | Entra v2.0 + PKCE |
| `validateCredentials` | ❌ | OAuth provider — callback proves validity (Gmail parity) |
| `registerPush` / `unregisterPush` / `applyPushNotification` | ❌ (phase 2) | Graph change notifications |
| `listSenders`, reactions, edit, `normalizeInboundReaction` | ❌ | not applicable to email |

---

## Data models

**No database schema changes.** Everything lives in existing JSONB columns.

### Tenant OAuth client config — `integration_credentials` (`integration_id = 'channel_ms365'`, `user_id IS NULL`)

```ts
export const ms365ClientCredentialsSchema = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  /** Entra directory (tenant) id, `organizations`, `common`, or `consumers`. Default `organizations`. */
  tenantId: z.string().min(1).default('organizations'),
  /** Space/comma-separated scope override; blank = defaults. */
  scopes: z.string().optional(),
}).strict()
```

### Per-user tokens — `integration_credentials` (`integration_id = 'channel_ms365'`, `user_id = <user>`)

```ts
export const ms365UserCredentialsSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().optional(),      // absent ⇒ requires_reauth at first refresh
  expiresAt: z.string().datetime().optional(),
  scopes: z.array(z.string()).optional(),
  email: z.string().email().optional(),     // mail ?? userPrincipalName
  displayName: z.string().optional(),
  /** Entra tenant the user authenticated against (`tid` claim) — diagnostics only. */
  tenantId: z.string().optional(),
}).passthrough()
```

### Channel sync state — `communication_channels.channel_state`

```ts
export const ms365ChannelStateSchema = z.object({
  /** Opaque Graph delta link — terminal cursor, advanced only after a full page drain. */
  deltaLink: z.string().optional(),
  /** Opaque Graph next link — present only while a multi-page drain is in progress. */
  nextLink: z.string().optional(),
  /** ISO receivedDateTime; ingest only items at/after it; re-bootstrap floor after 410. */
  receivedWatermark: z.string().datetime().optional(),
  /** Highest receivedDateTime seen mid-drain; promoted to receivedWatermark at the deltaLink. */
  pendingWatermark: z.string().datetime().optional(),
  lastSyncedAt: z.string().datetime().optional(),
}).partial().passthrough()
```

`preservePushState` in the poll worker keeps unrelated keys, so phase 2 can add push fields
additively.

### Normalized message metadata

`channelMetadata` on ingested messages: `{ graphMessageId, graphConversationId, internetMessageId }`.
`externalMessageId` = MIME `Message-ID` (fallback `ms365:<graphMessageId>@<account>`);
`externalConversationId` = root of the `References` chain (shared helper) — Graph `conversationId`
is stored as metadata, not used as the hub conversation key, so cross-provider threading semantics
stay uniform.

---

## API & adapter contracts

### Reused hub routes (no change)

| Route | Use |
|---|---|
| `POST /api/communication_channels/oauth/ms365/initiate` | start consent (requires `communication_channels.connect_user_channel`) |
| `GET /api/communication_channels/oauth/ms365/callback` | exchange code, persist tokens, create channel |
| `GET /api/communication_channels/me/channels` | list the user's channels |
| `POST /api/communication_channels/channels/[id]/test-send` | outbound smoke |
| `POST /api/communication_channels/channels/[id]/import-history` | back-fill |
| `POST /api/communication_channels/channels/[id]/poll-now` | manual poll trigger |
| `DELETE /api/communication_channels/channels/[id]` | disconnect |
| `PUT /api/integrations/channel_ms365/credentials` (Integrations UI) | tenant OAuth client config |

### Microsoft endpoints used

| Endpoint | Purpose |
|---|---|
| `https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize` | consent |
| `https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token` | code exchange, refresh |
| `GET https://graph.microsoft.com/v1.0/me` | identity |
| `GET /v1.0/me/mailFolders/inbox/messages/delta` | incremental cursor |
| `GET /v1.0/me/mailFolders/inbox/messages` | historical import |
| `GET /v1.0/me/messages/{id}/$value` | raw MIME |
| `GET /v1.0/me/messages?$filter=internetMessageId eq …` | id lookup for delete |
| `POST /v1.0/me/messages` (MIME body) | create draft |
| `POST /v1.0/me/messages/{id}/send` | send draft |
| `POST /v1.0/me/messages/{id}/move` | delete (to Deleted Items) |
| `DELETE /v1.0/me/messages/{id}` | orphan draft cleanup |

### New provider-owned surface

| Surface | Value |
|---|---|
| Package | `@open-mercato/channel-ms365` |
| Module id | `channel_ms365` |
| Provider key | `ms365` |
| Integration id | `channel_ms365` |
| ACL features | `channel_ms365.view`, `channel_ms365.configure` |
| DI keys | `channelMs365Adapter`, `channelMs365HealthCheck` |
| Widget id / spot | `channel_ms365.injection.connect` @ `profile:communication-channels:connect` |
| i18n keys | `communication_channels.profile.connect.ms365` (+ reuse of existing connect keys) |
| Env vars (optional) | `OM_CHANNEL_MS365_GRAPH_BASE_URL` (default `https://graph.microsoft.com/v1.0`, for sovereign clouds), `OM_CHANNEL_MS365_LOGIN_BASE_URL` (default `https://login.microsoftonline.com`), `OM_CHANNEL_MS365_DELTA_PAGE_SIZE` (default `50`, max `200`) |

### Error contract (adapter → hub)

| Graph / OAuth condition | Adapter behaviour | Hub outcome |
|---|---|---|
| `401` on any call, `invalid_grant` on refresh, missing refresh token | throw / return `requires_reauth` sentinel | channel `requires_reauth`, event emitted |
| `429`, `5xx`, network timeout | throw `GraphApiError { transient: true, status }` | retry with backoff, cursor pinned |
| `403 ErrorAccessDenied` / `MailboxNotEnabledForRESTAPI` / `ErrorInvalidUser` | throw `{ transient: false, status: 403 }` with actionable message | permanent failure, operator-visible |
| `410 syncStateNotFound` / `resyncRequired` | internal re-bootstrap from watermark | none (self-healing) |
| `404` on `$value` | skip item | none |
| Send `ErrorSendAsDenied` / `ErrorMessageSizeExceeded` | `{ status: 'failed', error }` | outbound failed, no retry |

---

## Microsoft 365 configuration (run & test)

### 1. Register the application in Entra ID

1. Entra admin center → **App registrations** → **New registration**.
2. Supported account types: *Accounts in any organizational directory and personal Microsoft
   accounts* (multi-tenant; matches `tenantId = common`), or single-tenant if you will pin
   `tenantId` to your directory id.
3. Redirect URI, platform **Web**:
   `https://<your-open-mercato-host>/api/communication_channels/oauth/ms365/callback`
   (must match byte-for-byte; `toAbsoluteUrl` derives it from the configured app URL, so set
   `NEXT_PUBLIC_APP_URL` / forwarded headers correctly behind a proxy).
4. **API permissions** → *Microsoft Graph* → **Delegated**: `Mail.ReadWrite`, `Mail.Send`,
   `User.Read`, `offline_access`, `openid`, `email`, `profile`. Grant admin consent if the tenant
   disallows user consent.
5. **Certificates & secrets** → new client secret; copy the *value* (not the id).
6. Note the *Application (client) ID* and *Directory (tenant) ID*.

### 2. Register the credentials in Open Mercato

Integrations → **Microsoft 365** → Client ID, Client Secret, Tenant ID (`common` or your directory
id), optional scopes → Save. The card should report *healthy* (client config valid).

### 3. Connect a mailbox

Profile → Communication channels → **Connect Microsoft 365** → Microsoft consent → redirected back
with the channel in *Connected* state. First poll runs within `pollIntervalSeconds` (default 300).

### 4. Run and test locally

```bash
yarn install
yarn generate
yarn dev            # app + workers (poll-channel picks up ms365 channels automatically)
```

- Send yourself a mail from another account → appears in Messages after the next poll.
- Reply from Open Mercato → arrives threaded; a copy appears in the mailbox's Sent Items.
- Channel page → *Import history* → older Inbox mail lands in Messages.
- Revoke the app in the Microsoft account's *Apps and services* → next poll flips the channel to
  *Requires re-auth*; *Reconnect* restores it.
- For a local callback URL use ngrok/Cloudflare tunnel and register that HTTPS redirect URI
  (Entra rejects plain `http://` except `http://localhost`).

---

## Integration test coverage

Tests ship in the implementing PR, are self-contained, and make **no live Microsoft calls**. Unit
tests stub the Graph and OAuth clients through `setGraphMailClient` / `setMicrosoftOAuthClient`.
Integration tests exercise hub wiring (the same depth the Gmail suite has, since a real consent
flow cannot run in CI).

### Playwright (`packages/channel-ms365/src/modules/channel_ms365/__integration__/`)

| ID | Path / behaviour | Asserts |
|---|---|---|
| TC-CHANNEL-MS365-001 | `POST /oauth/ms365/initiate` | provider is registered: never `404`/`5xx`; without tenant config returns `409` with `code: 'oauth_client_not_configured'` |
| TC-CHANNEL-MS365-002 | Tenant client config via Integrations API + health check | saving `clientId/clientSecret/tenantId` yields `healthy`; missing `clientId` yields `unhealthy` with `reason: 'invalid_oauth_client'`; cleanup deletes the row |
| TC-CHANNEL-MS365-003 | `POST /oauth/ms365/initiate` with config present | `200` with `authorizeUrl` on `login.microsoftonline.com/<tenantId>/oauth2/v2.0/authorize`, containing `state`, `code_challenge_method=S256`, all default scopes; state cookie set `HttpOnly` |
| TC-CHANNEL-MS365-004 | `GET /oauth/ms365/callback` with tampered/missing state | `302` back to the profile page with `flash=error` and a state error code; no channel row created |
| TC-CHANNEL-MS365-005 | Profile → Communication channels (UI) | *Connect Microsoft 365* button rendered and enabled for both default roles carrying `connect_user_channel` (admin, employee) |
| TC-CHANNEL-MS365-006 | Integrations detail API + list (UI) | `GET /api/integrations/channel_ms365` declares the four credential fields and `providerKey: ms365`; the Integrations page lists *Microsoft 365* |

### Jest (`lib/__tests__/`)

| File | Covers |
|---|---|
| `credentials.test.ts` | schemas, `tenantId` default + charset guard, scope parsing always re-adds `offline_access`, channel-state passthrough |
| `oauth.test.ts` | authority/base-URL resolution (sovereign-cloud overrides, https only), PKCE pair + RFC 7636 vector, authorize URL shape (PKCE, `select_account`, `login_hint`), exchange with `code_verifier`, refresh at the home tenant, `/me` profile, `id_token` claim decoding |
| `graph-client.test.ts` | headers (`ImmutableId`, page size), `$select`/`$filter`, same-origin link guard, `$value` bytes, draft-from-MIME + send, lookup escaping, move/delete, permanent vs transient classification, `429` retry with `Retry-After`, `410` resync mapping, list with `$count` |
| `adapter.test.ts` | wiring (providerKey, capabilities, exported/omitted methods); OAuth flow (extra carries verifier/scopes/tenant, exchange resolves mailbox + home tenant, claim fallback, missing verifier rejected); refresh (rotated token persisted, missing/revoked ⇒ `requires_reauth`, secret required); `fetchHistory` (bootstrap overlap + no ingest, watermark filter skips old/removed/draft, mid-drain `nextLink` + `pendingWatermark`, `410` re-sync ingests from watermark, `404` skip + transient pin, `401` sentinel, permanent `403` message); `importHistory` (filter shape, `nextLink` paging + count, sender chunking, `maxMessages`); `sendMessage` (MIME headers, authoritative `internetMessageId`, `401` sentinel, orphan-draft cleanup, missing mailbox); `deleteMessage`; `resolveContact`; `normalizeInbound` |
| `normalize-inbound.test.ts` / `convert-outbound.test.ts` | MIME ↔ hub mapping parity with the Gmail/IMAP providers |
| `health.test.ts` | healthy (tenant echoed, blank tenant defaults) / unhealthy |

Unit coverage at implementation time: 7 suites, 76 tests, all green (`yarn workspace @open-mercato/channel-ms365 test`).

---

## Risks & impact review

| Risk | Severity | Affected area | Mitigation | Residual |
|---|---|---|---|---|
| **Refresh-token rotation race** — two workers refresh the same channel; the second exchange invalidates the first's new token. | High | poll + outbound workers | Persist the rotated token on every refresh; hub single-flight per `channelId` (in-process). Document that multi-process deployments should keep `refreshWindowMs` default so refreshes are rare and short. | Multi-process race remains theoretically possible (same as Gmail); recovers via `requires_reauth` + reconnect. |
| **Delta token expiry / `410`** | Medium | inbound | Re-bootstrap from `receivedWatermark`; watermark never moves back. | Mail moved into Inbox with an old `receivedDateTime` is skipped (documented; `importHistory` covers). |
| **Tenant disables Graph mail access / blocks user consent** | Medium | connect | `403` mapped to an actionable message; docs list admin-consent step. | None beyond operator action. |
| **`preferred_username` ≠ primary SMTP** | Low | identity/dedup | Prefer `/me.mail`; UPN only as fallback. | Rare mismatch changes the dedup key vs an IMAP channel of the same mailbox. |
| **Message-ID rewritten by Exchange** | Medium | threading | Draft-from-MIME returns the authoritative `internetMessageId`, which is what we store. | None. |
| **Graph throttling (429)** on large tenants | Low | inbound/outbound | Transient classification + backoff; page size cap; one `$value` per new message only (watermark filter). | Bursty tenants may lag one tick. |
| **Duplicate mailbox via IMAP and ms365** | Low | connect | Existing `MailboxAlreadyConnectedError` check (case-insensitive email) already blocks it. | None. |
| **Sovereign clouds (21Vianet, GCC High)** | Low | config | Base URLs overridable via env. | Untested in phase 1. |
| **Secret handling** | High | security | Client secret and tokens only in encrypted `integration_credentials`; never logged; PKCE on exchange; state cookie bound to user + tenant by the hub. | None new. |
| **Tenant isolation** | High | security | All Graph calls use the per-user token resolved from the channel's own credentials row; tenant scope comes from the hub's signed state / channel row. No cross-tenant lookups. | None new. |

---

## Backward compatibility

- **Additive only.** New package, new provider key `ms365`, new module id, new ACL features, new DI
  keys, new widget id, new i18n keys, optional new env vars. No existing event ids, API routes, DB
  schema, DI names, widget spot ids, or adapter interface members change.
- The Gmail and IMAP providers are untouched. The IMAP user guide keeps working for non-Microsoft
  providers; its Microsoft paragraph is replaced by a link to the new page.
- Phase 2 (push) will need three additive core edits (see below); they are deliberately excluded
  from phase 1 so this spec ships with zero `packages/core` changes.

---

## Phase plan

### Phase 1 — this spec

OAuth + polling + import + send + delete + docs + tests. Zero core changes.

### Phase 2 — Graph change notifications (push)

- Provider-owned route `POST /api/channel_ms365/webhooks/graph` handling the `validationToken`
  handshake (respond `200 text/plain` within 10 s) and `clientState` verification (fail-closed),
  enqueueing to the hub's push workers.
- `registerPush` → `POST /subscriptions` on `/me/mailFolders('inbox')/messages` (`created`),
  lifetime ≤ 4230 minutes; `unregisterPush` → `DELETE /subscriptions/{id}`;
  `applyPushNotification` → delegate to `fetchHistory` (drain since delta link).
- Renewal worker (analogous to `gmail-renew-watch`).
- **Core generalisation (additive):** replace the `provider === 'gmail'` checks in
  `api/get/oauth/[provider]/callback/route.ts`, `commands/push-register.ts`, and
  `commands/connect-credential-channel.ts` with "adapter implements `registerPush`". Gmail
  behaviour unchanged.

### Phase 3 — optional

- Shared mailboxes (`/users/{shared}/…`, `Mail.Read.Shared`).
- `microsoft` brand for `SocialButton`.
- Attachment stitching (shared across email providers).

---

## Open questions

| # | Question | Proposed default |
|---|---|---|
| Q1 | Provider key: `ms365` vs `outlook` vs `microsoft`. | `ms365` — matches the product name used in docs and admin UIs; `outlook` suggests the consumer client. |
| Q2 | Should personal Microsoft accounts be allowed by default? | **Decided 2026-09-04: no.** Default `tenantId = organizations` (work/school accounts only); admins may pin a directory id or opt into `common`. |
| Q3 | Bootstrap without back-fill (Gmail parity) vs seeding the last N days. | No back-fill; operators use *Import history*. Keeps first-poll cost bounded. |

None block implementation; defaults apply unless the maintainer objects in review.

---

## Final compliance report

- **Module boundaries**: all Microsoft-specific code in `packages/channel-ms365/`; nothing added to
  `packages/core` in phase 1. ✅
- **Reuse over reinvention**: OAuth routes, state cookie, credential refresh, polling worker,
  import worker, MIME normalisation, RFC 2822 assembly, cursor encoding, health-check factory, and
  connect hook are all reused from the hub. ✅
- **Tenant isolation & security**: per-user tokens under per-user credential rows; tenant OAuth
  client config at tenant scope; PKCE; no secret logging; fail-closed on state verification (hub). ✅
- **RBAC**: `channel_ms365.view` / `.configure` in `acl.ts` + `setup.ts` defaults. ✅
- **i18n / DS**: strings via `useT` + locale JSON; DS `Button`; no hardcoded status colours. ✅
- **Generated files**: `yarn generate` after adding the module; nothing generated edited by hand. ✅
- **Backward compatibility**: additive only; `BACKWARD_COMPATIBILITY.md` contract surfaces
  untouched. ✅
- **Tests**: TC-CHANNEL-MS365-001..006 + jest suites listed above, shipped with the implementing
  PR; no live external calls. ✅
- **Docs**: new `apps/docs/docs/user-guide/communication-channels-ms365.mdx`, sidebar entry,
  updates to `communication-channels.mdx` and `communication-channels-imap.mdx`, package
  `AGENTS.md`. ✅
- **Dependencies**: no new third-party runtime dependency (Graph and Entra via `fetch`;
  `mailparser` already used by the email providers). ✅

---

## Changelog

### 2026-09-04 — Initial draft

- Scoped the Microsoft 365 provider on Microsoft Graph with polling (phase 1), documented the
  IMAP/XOAUTH2 alternative and why it was rejected, defined delta-cursor semantics, outbound
  draft-from-MIME flow, error contract, configuration steps, test coverage, and the phase 2 push
  plan including the core generalisation it requires.
- Review decision: personal Microsoft accounts are not accepted by default — `tenantId` defaults
  to `organizations` (D8, Q2).
- Added the full list of repo registration touch-points for a new provider package.

### 2026-09-04 — Phase 1 implementation

- Added `packages/channel-ms365` (module `channel_ms365`, provider `ms365`): credentials schemas,
  Entra OAuth client with PKCE, Graph mail client (delta, list, `$value`, draft-from-MIME, send,
  move, delete) with retry/backoff and a same-origin link guard, adapter (`fetchHistory`,
  `importHistory`, `sendMessage`, `deleteMessage`, OAuth + refresh, contact resolution), health
  check, DI/setup/ACL, connect widget, package `AGENTS.md`.
- Wired the package into `apps/mercato`, the create-app template, `Dockerfile`, the package
  preview workflow, the strict DS-lint escalation block, and the five `communication_channels`
  locale files. No `packages/core` code changes.
- Implementation deltas vs the draft: bootstrap uses a 2-minute overlap window instead of
  `receivedDateTime ge now` (closes the race for mail received just before the delta token);
  channel state gained `pendingWatermark` for multi-page drains; refresh calls the user's home
  tenant (`tid` claim captured at exchange) rather than the configured alias; send failures keep
  the Graph error code in the operator-visible message; `CHANGELOG.md` is left to the release flow.
- Docs: new `communication-channels-ms365.mdx`, sidebar entry, overview page updated (no more
  "no Microsoft connector" guidance).
- Verification (Docker one-off container, dev server paused): `yarn generate`, package build,
  typecheck, app lint, 76 unit tests, i18n sync check; live smoke on the dev stack confirmed the
  adapter is registered (`initiate` → 409 `oauth_client_not_configured` without tenant config,
  `GET /api/integrations/channel_ms365` → 200). Integration specs TC-CHANNEL-MS365-001..006 ship
  in `__integration__/` and all passed against the Docker dev stack (Playwright + Alpine Chromium
  inside the app container): 001, 002, 003, 004 ×2, 005 ×2, 006 ×2. Note for local runs: the
  dev-mode Turbopack compile of the backend UI peaks at ~8 GB, so the Docker VM needs ≥ 16 GB
  when it also hosts another stack. Not verified: an end-to-end consent + mail round-trip against
  a real Entra tenant (requires an app registration).

### 2026-09-04 — First live run against a real Entra tenant

- Single-tenant app registration (`http://localhost:3100/...` redirect URI, delegated Graph
  permissions with admin consent, assignment-required so only chosen users can connect) →
  tenant credentials saved in Integrations → *Connect Microsoft 365* completed: channel created
  with the mailbox address and display name from Graph, first poll persisted a real Inbox
  `deltaLink` + watermark, no errors.
- Fix found by the live test: the hub calls `adapter.convertOutbound` **without** recipients
  (test-send only passes `to` on `sendMessage.metadata`), so `convertOutbound` now only shapes
  the body and defers the RFC 2822 assembly to `sendMessage` (unit test added, 77 tests).
- Test-send through Graph (draft-from-MIME + `/send`) returned `status: sent` with the
  `internetMessageId` Exchange kept from our MIME (`<uuid>@<your-domain>`).
