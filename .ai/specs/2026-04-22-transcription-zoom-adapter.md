# Transcription Provider Adapter — Zoom

| Field | Value |
|---|---|
| **Date** | 2026-04-22 |
| **Status** | Proposed (revised 2026-04-22: adopts WebhookEndpointAdapter + call_transcripts module) |
| **Author** | Maciej Gren (with om-superpowers + Claude) |
| **Scope** | OSS |
| **Module(s)** | new `packages/transcription-zoom` — registers into `call_transcripts` module + `@open-mercato/webhooks` inbound pipeline |
| **Parent spec** | `.ai/specs/2026-04-21-crm-call-transcriptions.md` (CRM Call Transcriptions) |
| **Sibling sub-specs** | `.ai/specs/2026-04-22-transcription-tldv-adapter.md` |
| **Implements** | `CallTranscriptProvider<ZoomCredentials>` from `@open-mercato/shared/modules/call_transcripts/provider` (created by parent spec Phase 1) + `WebhookEndpointAdapter` from `@open-mercato/webhooks` |
| **Depends on** | (1) Parent spec `2026-04-21-crm-call-transcriptions.md` must ship first (this adapter is provider #1, the reference implementation). (2) Additive `WebhookEndpointAdapter.handleHandshake` hook in `@open-mercato/webhooks` — hard prerequisite for Zoom's synchronous URL-validation response. See parent spec §3 "URL-validation handshakes" for the contract and this doc's API Contracts section for the response-body implications. |

---

## TLDR

- Implement `CallTranscriptProvider` for Zoom as the **reference adapter** in `packages/transcription-zoom`. Ships alongside the parent and is the model other provider packages copy.
- Auth: **Server-to-Server OAuth**, account-wide. One Zoom connection per OM tenant; the Zoom Admin authorizes once. Credentials stored in the SPEC-045 integrations vault at **tenant scope** (not per-user). Tenant resolution on webhook is by a **signed tenant token in the webhook URL** (see §Tenant routing); `payload.account_id` is cross-checked against the vault entry as defense-in-depth.
- Triggers: (a) `recording.transcript_completed` webhook (primary) — webhook intake flows through the shared `@open-mercato/webhooks` inbound pipeline via a registered `WebhookEndpointAdapter`. The intake URL `POST /api/webhooks/inbound/zoom` is owned by `@open-mercato/webhooks`, not by this package. The adapter's `verifyWebhook` handles HMAC-SHA256 (`x-zm-signature: v0=<hex>` + `x-zm-request-timestamp`, 5-minute replay window), the URL-validation handshake, and tenant resolution via a signed tenant token in the URL query param (`?t=`). The adapter's `processInbound` calls `fetchTranscript` and invokes `call_transcripts.ingest` via the command bus. (b) Scheduled polling fallback via `GET /users/{userId}/recordings` iterated across all users under the connected account.
- **Plan gate is hard at connect time.** Zoom Cloud Recording + Audio Transcript requires Business / Education / Enterprise. The connect flow calls `GET /accounts/{accountId}/settings?option=recording` before saving credentials; if Audio Transcript is disabled (or the plan is below Business), the route returns 400 with a localized "upgrade required" message. Silent non-ingest on Pro is explicitly rejected — fail loud on detectable hard gates.
- **Attendee matching is materially richer than tl;dv.** `GET /past_meetings/{meetingUUID}/participants` returns `user_email` for every participant who joined while signed into a Zoom account. A typical sales call with 1 host + 2 external prospects who sign in gets 3 `CustomerInteractionParticipant` rows — all `matched_via='primary_email'` when they're in the CRM. Anonymous guest joiners (joined without signing into Zoom) lack `user_email` → stored as display-name-only `CallTranscriptParticipant` rows (`matchable=false` per the parent's relaxed CHECK `email OR phone OR display_name`), visible in segments + unmatched-inbox summary, but NOT promoted to `CustomerInteractionParticipant` (whose CHECK still requires email or phone). Calendar enrichment remains the v2 escape hatch for turning those anonymous speakers into matchable identities, identical to tl;dv's follow-up track.
- Transcript format: **WebVTT**. The adapter fetches the VTT via `download_url` using the **short-lived `download_token`** delivered in the webhook payload (or a fresh OAuth access token on the polling path), parses each cue into `{ speaker, startSec, endSec, text }`, and stores the joined plain text as `TranscriptResult.text`.
- Webhook URL validation: Zoom sends `endpoint.url_validation` on webhook configuration; adapter MUST reply within 3 seconds with `{ plainToken, encryptedToken: hex(HMAC-SHA256(plainToken, secretToken)) }`.
- Throttling: Zoom's cloud-recording endpoints sit in the "Medium" rate-limit tier (≈ 10 req/sec per account per-endpoint-class). Adapter self-throttles at 10 req/sec per account and honors `Retry-After` on 429/5xx with capped exponential backoff.

---

## Relationship to parent spec

This sub-spec is **purely additive** to the parent. It does NOT change:

- The `CallTranscriptProvider<TCredentials>` contract in `@open-mercato/shared/modules/call_transcripts/provider`.
- The `call_transcripts` module's ingest command / routing / staging / inbox / ACL / events.
- The customers module's `CustomerInteraction` model or its new `create_from_transcript` command.

It does add:

- A new workspace package `packages/transcription-zoom` (npm workspace, OSS).
- Provider-package-local ACL features (`transcription_zoom.view`, `transcription_zoom.configure`).
- A `WebhookEndpointAdapter` registered via `registerWebhookEndpointAdapter` (from `@open-mercato/webhooks`).
- A `CallTranscriptProvider` registered via `registerCallTranscriptProvider` (from `@open-mercato/core/modules/call_transcripts/lib/adapter-registry` — note: module-level registry, NOT a DI token).
- An integrations-marketplace registry entry (SPEC-045) declaring `hub: 'call_transcripts'`.
- Env-backed preconfiguration for `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET`, `ZOOM_WEBHOOK_SECRET_TOKEN`, applied from the provider's own `setup.ts`.

If the parent spec is unimplemented when this sub-spec is picked up, this work blocks until the parent's Phase 1 (data model + contract + internal ingest route) lands.

---

## Relationship to the tl;dv sub-spec

Same structure; different characteristics:

| Dimension | Zoom (this spec) | tl;dv (sibling spec) |
|---|---|---|
| Credential scope | Per-**tenant** (Server-to-Server OAuth; one admin connect) | Per-**user** (one API key per OM user) |
| Webhook signing | HMAC-SHA256 over `v0:<ts>:<rawBody>` (standard, strong) | Shared secret in custom HTTP header (weaker, mitigated by idempotency) |
| URL-validation handshake | Required (`endpoint.url_validation` event) | None |
| Replay window | Timestamp check enforced (5 min) | Idempotency-only (no timestamp in headers) |
| Participant coverage | All Zoom-authenticated attendees via `/past_meetings/{uuid}/participants` | Organizer only (tl;dv's `invitees[]` is empty) |
| Plan gate | Hard block at connect (Business+ required) | Soft; ships assuming Pro works |
| Transcript format | VTT (parse required) | JSON segments (direct) |
| Self-throttle | 10 req/sec per account | 1 req/sec per user |
| Polling default | 15 min (configurable) | 15 min (configurable) |

---

## Provider profile — Zoom API surface

Cited from Zoom's public REST API reference (https://developers.zoom.us/docs/api/) and the Webhook reference. Live-verified endpoint paths and header names; response shapes below are the stable public shape. **Implementation MUST verify the recording-settings field path (§ Plan gate) against a real Business-plan account before the adapter ships** — Zoom's settings response has nested variants across plan types. Flagged in Assumptions.

### REST endpoints used

| Method | Path | Purpose | Scope |
|---|---|---|---|
| POST | `/oauth/token?grant_type=account_credentials&account_id={id}` (on `https://zoom.us`) | Exchange Server-to-Server OAuth credentials for a 1h access token. Basic auth = `client_id:client_secret`. | — (auth) |
| GET  | `/v2/accounts/{accountId}/settings?option=recording` | Read recording-related account settings (used for plan gate at connect). | `account:read:admin` |
| GET  | `/v2/users?page_size=100&next_page_token=` | List users under the account (polling iterates each user). | `user:read:admin` |
| GET  | `/v2/users/{userId}/recordings?from=&to=&page_size=100&next_page_token=` | List Cloud Recordings for a user within a date window. `from`/`to` are `YYYY-MM-DD`. | `cloud_recording:read:admin` |
| GET  | `/v2/meetings/{meetingUUID}/recordings` | Fetch recording bundle for a specific meeting by UUID (double-URL-encode if UUID starts with `/` or contains `//`). | `cloud_recording:read:admin` |
| GET  | `/v2/meetings/{meetingId}` | Meeting metadata (topic, start_time, duration) — used for enrichment when the webhook payload is missing a field. | `meeting:read:admin` |
| GET  | `/v2/past_meetings/{meetingUUID}/participants?page_size=300&next_page_token=` | Participants for a past meeting (ONE call, cursor-paginated). Returns `user_email` for authenticated participants; empty string for anonymous. | `meeting:read:admin` + `report:read:admin` depending on account type |

**Required OAuth scopes** (declared in the SPEC-045 marketplace entry):

```
cloud_recording:read:admin
meeting:read:admin
user:read:admin
account:read:admin
report:read:admin            // participants for past meetings
```

### Webhook events

| Event | Trigger | Handled in v1 | Payload fields used |
|---|---|---|---|
| `endpoint.url_validation` | Fired once when the webhook URL is added to the Zoom app configuration | YES (handshake) | `payload.plainToken` |
| `recording.transcript_completed` | Cloud recording transcript has finished processing | YES (primary path) | `payload.account_id`, `payload.object.uuid`, `payload.object.id`, `payload.object.host_id`, `payload.object.host_email`, `payload.object.topic`, `payload.object.start_time`, `payload.object.duration`, `payload.object.recording_files[].{id,file_type,file_extension,download_url,recording_start,recording_end}`, top-level `download_token`, `event_ts` |
| `recording.completed` | Cloud recording (audio/video) is available even if transcript isn't | v1.1 fallback: track the recording id so we know to expect a `transcript_completed` later; if none arrives within 24h, degrade gracefully with an admin-visible alert | same object shape as above, without TRANSCRIPT file |
| `recording.deleted` | Host or admin deleted a recording in Zoom | NO in v1 (documented as v1.1 follow-up) | — |

v1 ignores `recording.completed` and `recording.deleted` to keep scope tight. The polling fallback is the safety net for any `transcript_completed` that never arrives (e.g. Zoom webhook queue delay, firewall drop).

### Auth and account scope

- One **Server-to-Server OAuth app** is installed in the customer's Zoom account by their Zoom Admin. The app's `account_id`, `client_id`, `client_secret` are captured during OM's connect flow.
- Access tokens are fetched on demand via `POST https://zoom.us/oauth/token?grant_type=account_credentials&account_id={id}` with Basic auth; each token is valid for ~1 hour and is cached in memory with a ~55 min effective TTL. No refresh tokens are used (this is the Server-to-Server OAuth flow).
- Webhook secret token is configured alongside the app; OM generates and displays it during setup, and the Zoom Admin pastes it into the Zoom app's Event Subscriptions page.

### Rate limits

- Cloud recording endpoints are **Medium-tier** (Zoom's published docs). Practical target: 10 req/sec per account, per endpoint class. Adapter self-throttles globally at 10 req/sec and honors `Retry-After` headers on 429.
- Listing users and recordings under an account with many hosts + back-catalog recordings can be the single most expensive step at connect time. Initial backfill is bounded by a default `from = now() - 30 days`.

### What is NOT in scope for v1

- Raw meeting audio / video storage. OM stores only the transcript text.
- `recording.deleted` event handling — no cascade into CRM.
- Zoom Phone (CTI) — belongs to the parent spec's v2 track.
- Zoom Summary (`file_type='SUMMARY'`) — Zoom-generated meeting summary file. Out of scope; the parent spec's "AI layer" is the right owner when it lands.

---

## Architecture

```
 Zoom Account (Business+ plan; Server-to-Server OAuth app installed by Zoom admin)
        │
        │ recording.transcript_completed webhook
        │   (HMAC-SHA256 over v0:<ts>:<rawBody>, x-zm-signature header)
        ▼
 ┌──────────────────────────────────────────────────────────────────────┐
 │ @open-mercato/webhooks — shared inbound pipeline                      │
 │                                                                       │
 │  POST /api/webhooks/inbound/zoom?t=<signedTenantToken>                │
 │    (shared route, owned by @open-mercato/webhooks)                    │
 │                                                                       │
 │    1. Raw-body preservation (middleware)                              │
 │    2. Rate limit                                                      │
 │    3. Dedup                                                           │
 │    4. adapter.verifyWebhook({ headers, body, method })                │
 │         → extracts tenantId from ?t=, verifies HMAC, handles          │
 │           endpoint.url_validation, returns envelope                   │
 │    5. Emit webhooks.inbound.received                                  │
 │    6. Subscriber calls adapter.processInbound(...)                    │
 └──────────────────────────────────────────────────────────────────────┘
        │
        ▼
 ┌──────────────────────────────────────────────────────────────────────┐
 │ packages/transcription-zoom                                           │
 │   src/modules/transcription_zoom/webhook-adapter.ts                   │
 │                                                                       │
 │  verifyWebhook({ headers, body, method }):                            │
 │    - Read ?t=<signedTenantToken>, extract tenantId                    │
 │    - Constant-time-verify HMAC of the signed token                    │
 │    - If body.event === 'endpoint.url_validation':                     │
 │        return { eventType: 'endpoint.url_validation',                 │
 │                 payload: { plainToken },                              │
 │                 tenantId, organizationId }                            │
 │    - Else verify x-zm-signature over v0:<ts>:<rawBody>                │
 │    - Reject if |now - x-zm-request-timestamp| > 300s                  │
 │    - Return { eventType, payload, tenantId, organizationId }          │
 │                                                                       │
 │  processInbound({ eventType, payload, tenantId, organizationId,       │
 │                   providerKey: 'zoom' }):                             │
 │    - Resolve ZoomCredentials from integrations vault by               │
 │      (tenantId, organizationId)                                       │
 │    - Consistency check payload.account_id === vault.accountId         │
 │    - fetchTranscript(payload.object.uuid, ctx) =                      │
 │        Promise.all([                                                  │
 │          GET /meetings/{uuid}/recordings,                             │
 │          GET /past_meetings/{uuid}/participants?page_size=300         │
 │        ])                                                             │
 │    - Fetch VTT via download_url (download_token; OAuth Bearer fallbk) │
 │    - Parse VTT cues → segments[]                                      │
 │    - Compose normalized TranscriptResult                              │
 │    - commandBus.execute('call_transcripts.ingest', {                  │
 │        tenantId, organizationId,                                      │
 │        providerKey: 'zoom',                                           │
 │        transcript: result,                                            │
 │      })                                                               │
 │                                                                       │
 │  workers/poll-zoom.ts (scheduled, per-tenant)                         │
 │    Fetch OAuth token                                                  │
 │    For each user under account (GET /users):                          │
 │      - GET /users/{id}/recordings?from=<lastPolledAt>&to=<now>        │
 │      - For each recording with a TRANSCRIPT file:                     │
 │          - Skip if already ingested (idempotency via call_transcripts │
 │            module's (providerKey='zoom', sourceRecordingId) check)    │
 │          - Execute fetchTranscript(meetingUUID, ctx)                  │
 │          - commandBus.execute('call_transcripts.ingest', {...})       │
 │      - Persist lastPolledAt per (tenantId, zoomUserId)                │
 │                                                                       │
 │  Self-throttling: 10 req/sec per account; Retry-After honored;        │
 │  exponential backoff 500ms → 8s, max 5 retries per call.              │
 └──────────────────────────────────────────────────────────────────────┘
        │
        ▼
 ┌──────────────────────────────────────────────────────────────────────┐
 │ call_transcripts.ingest command (parent spec)                        │
 │   Routing algorithm runs unchanged.                                   │
 │   For Zoom-sourced TranscriptResults: typically all authenticated     │
 │   attendees produce CustomerInteractionParticipant rows with          │
 │   matched_via='primary_email'. Anonymous guest joiners are NOT        │
 │   promoted to junction rows (no email); their words are preserved     │
 │   in TranscriptResult.segments.                                       │
 └──────────────────────────────────────────────────────────────────────┘
```

---

## Authentication & credentials

### Credential type (registered with the SPEC-045 integrations vault)

```ts
// packages/transcription-zoom/src/credentials.ts
export type ZoomCredentials = {
  accountId: string              // Zoom account_id (used for token fetch + webhook tenant resolution)
  clientId: string               // Server-to-Server OAuth app client_id
  clientSecret: string           // Server-to-Server OAuth app client_secret (encrypted at rest)
  webhookSecretToken: string     // Zoom webhook secret token (encrypted at rest)
  connectedBy: string            // OM user id that performed the connect
  verifiedAt: Date               // set when plan-gate check + first token fetch pass
}

export const zoomCredentialsSchema = z.object({
  accountId: z.string().min(1),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  webhookSecretToken: z.string().min(1),
  connectedBy: z.string().uuid(),
  verifiedAt: z.coerce.date(),
})
```

Vault scope: **per tenant** (one row). Unlike tl;dv's per-user scope, the Zoom adapter resolves webhooks by `account_id`, which maps 1:1 to a tenant. All fields flagged `sensitive: true` except `accountId`.

**Uniqueness**: the vault entry is unique on `(account_id, tenantId)`, NOT on `account_id` alone. Two OM tenants (e.g. a customer running separate staging and production tenants) may legitimately register the same Zoom account during test runs; the shared `(account_id, tenantId)` key supports this while still deterministically resolving webhook events to exactly one tenant (webhook payload carries only `account_id`; in the unusual case where two tenants share an `account_id`, the dispatcher fans out — see §Webhook security).

**`verifiedAt` lifecycle**: `verifiedAt` is written on the first successful connect (OAuth token fetch + plan-gate check both pass) and re-written whenever either of the following completes successfully: the `POST /api/integrations/transcription-zoom/update-webhook-secret` route (which triggers a fresh OAuth token fetch as part of its flow), or an explicit call to `POST /api/integrations/transcription-zoom/test` when that call reaches the plan-gate step without error. Token-fetch failures and plan-gate failures do NOT update `verifiedAt`. Poll-worker runs do not touch `verifiedAt` — transient polling errors must not appear to downgrade the credential's verification state.

### Integrations marketplace hub

This adapter registers against the marketplace hub `call_transcripts`, which is introduced by the parent `call_transcripts` **module** (NOT by customers) — see `.ai/specs/2026-04-21-crm-call-transcriptions.md` §Proposed Solution. Verified existing hubs in `packages/*`: `payment_gateways`, `shipping_carriers`, `data_sync`, `webhook_endpoints` — none fit transcription providers. The new `call_transcripts` hub is owned by the parent spec's new module; this sub-spec only consumes it. The provider's `integration.ts` declares:

```ts
export const integration: IntegrationDefinition = {
  id: 'transcription_zoom',
  title: 'Zoom (call transcripts)',
  description: 'Automatically ingest Zoom Cloud Recording transcripts into the OM CRM.',
  category: 'call_transcripts',
  hub: 'call_transcripts',
  providerKey: 'zoom',
  icon: 'zoom',
  docsUrl: 'https://developers.zoom.us/docs/api/',
  package: '@open-mercato/transcription-zoom',
  version: '1.0.0',
  author: 'Open Mercato Team',
  license: 'MIT',
  tags: ['call', 'transcript', 'meeting', 'cloud-recording'],
}
```

If the parent spec has not yet introduced the `call_transcripts` hub when this sub-spec is picked up, the implementing PR blocks behind a parent-spec update. This dependency is explicit in §Dependencies at the top of the doc.

### Env-backed preconfiguration

Per the root `AGENTS.md` rule ("integration providers MUST own their env-backed preconfiguration inside the provider package"), `packages/transcription-zoom/src/setup.ts` reads:

```
ZOOM_CLIENT_ID            # required to apply preset
ZOOM_CLIENT_SECRET        # required to apply preset
ZOOM_WEBHOOK_SECRET_TOKEN # required to apply preset
ZOOM_ACCOUNT_ID           # optional; if not set, admin must enter in the UI
```

When all three (or four, with account_id) are present at setup time, the provider is pre-applied to a single-tenant install so the Admin doesn't have to re-enter values in the UI on a greenfield boot. A rerunnable CLI command `yarn mercato transcription-zoom apply-preset` is exposed for reapplying after rotation. Env values alone never grant access — the admin must still confirm in the integrations card before the provider goes active.

### Connect flow (in the integrations marketplace)

1. Admin in OM opens `/backend/integrations` and clicks **Connect Zoom**.
2. OM presents a form with four fields:
   - **Account ID** (from Zoom → Admin → Advanced → Account Profile)
   - **Client ID** and **Client Secret** (from the Server-to-Server OAuth app in the Zoom Marketplace → App Credentials)
   - **Webhook Secret Token** (generated in the Zoom app's Event Subscriptions page; the admin pastes it here)
3. On submit, the adapter:
   - Fetches an OAuth token against `POST https://zoom.us/oauth/token`. Fail → 400 "Invalid Zoom client credentials" (do not reveal which field is wrong).
   - Calls `GET /accounts/{accountId}/settings?option=recording` with the token. Inspects the recording settings object for the "auto_transcription" (or plan-equivalent) flag and the effective recording plan. If Audio Transcript is disabled or the plan tier is below Business, returns 400 with i18n key `transcription_zoom.connect.plan_gate_failed` — "Zoom Audio Transcript is not available on this account. Upgrade to Business or above and enable Audio Transcript, then reconnect." *(Exact field path flagged for verification in §Assumptions.)*
   - On both checks passing, stores credentials in the vault with `verifiedAt = now()`, generates the **signed tenant token** `t = base64url(tenantId) + "." + hex(HMAC-SHA256(tenantId, OM_INTERNAL_WEBHOOK_KEY))`, and returns `{ webhookUrl, setupInstructions }` to the UI where `webhookUrl` already includes `?t=<signedTenantToken>`.
4. The UI then shows the webhook setup panel:
   - Webhook URL (copy-ready, including the signed tenant token): `https://<om-host>/api/webhooks/inbound/zoom?t=<signedTenantToken>`
   - Events to subscribe: `recording.transcript_completed` (required), `recording.completed` (recommended fallback)
   - The admin pastes this URL as-is into Zoom's Event Subscriptions page. There is no "edit it twice" step. Validation succeeds immediately because the URL binds the webhook to the tenant deterministically (§Webhook security).

### Disconnect flow

`DELETE /api/integrations/transcription-zoom/disconnect` removes the credential entry. Ingested CRM data is preserved. The Zoom-side app uninstallation is the admin's responsibility (OM doesn't have a revoke scope).

### Token refresh

Access tokens last ~1h. The adapter uses an in-memory token cache keyed by `tenantId`, with a 55-min soft TTL and automatic refresh on 401. No persistent refresh-token storage is needed — Server-to-Server OAuth doesn't issue refresh tokens.

---

## Ingestion

### Webhook path (primary)

**Intake route**: `POST /api/webhooks/inbound/zoom?t=<signedTenantToken>` — owned by `@open-mercato/webhooks`, NOT by this package. This package registers a `WebhookEndpointAdapter` via `registerWebhookEndpointAdapter` (from `@open-mercato/webhooks`); the shared route dispatches to it based on the path segment `/zoom`.

Steps:

1. External Zoom webhook hits the shared route `/api/webhooks/inbound/zoom?t=<signedTenantToken>` with headers (`x-zm-signature`, `x-zm-request-timestamp`, `Content-Type`) and raw body. The shared pipeline preserves raw bytes (any reformatting breaks the HMAC).
2. **Synchronous handshake path (`adapter.handleHandshake`)** — called BEFORE `verifyWebhook` by the shared route:
   - This package's `handleHandshake({ headers, body, method })` parses the body and checks `event === 'endpoint.url_validation'`. If so:
     - Reads query param `t` (signed tenant token); verifies the HMAC; extracts `tenantId`/`organizationId`. On tamper → throws (shared route maps to 401).
     - Loads `ZoomCredentials` for the resolved tenant to get `webhookSecretToken`.
     - Computes `encryptedToken = hex(HMAC-SHA256(body.payload.plainToken, webhookSecretToken))`.
     - Returns `{ status: 200, body: { plainToken, encryptedToken } }` — the shared route sends this verbatim to Zoom, skipping the standard persist/emit/subscriber path. Zoom validates and webhook registration succeeds.
   - On all other event values (including malformed bodies), `handleHandshake` returns `null`, and the shared route falls through to the standard `verifyWebhook` → persist → emit → `processInbound` flow.

   **Dependency**: `handleHandshake` is an additive extension to the `WebhookEndpointAdapter` interface in `@open-mercato/webhooks`, introduced by the parent spec (§Proposed Solution.3 "URL-validation handshakes"). Landing this extension is a **hard prerequisite for Phase 2** of this sub-spec; it cannot be worked around adapter-side because the current shared route returns a fixed JSON ack and `processInbound` runs asynchronously in a subscriber — neither allows a synchronous provider-specific response body. tl;dv does not need this (no synchronous handshake requirement).

3. **Standard event path — `adapter.verifyWebhook({ headers, body, method })`** for every non-handshake request. Inside `verifyWebhook`:
   - Read query param `t` from the request URL; split on `.`, base64url-decode the left half to `tenantId`, constant-time-compare the right half against `hex(HMAC-SHA256(tenantId, OM_INTERNAL_WEBHOOK_KEY))`. Reject (throw) on missing/invalid token.
   - Load `ZoomCredentials` from the integrations vault using `(tenantId, organizationId)`.
   - Verify `x-zm-signature`: compute `"v0=" + hex(HMAC-SHA256(vault.webhookSecretToken, "v0:" + x_zm_request_timestamp + ":" + rawBody))` and constant-time-compare. Fail → throw (shared pipeline maps to 401).
   - Reject if `|now - x-zm-request-timestamp| > 300s` (replay window).
   - Validate the parsed JSON against the zod schema for `recording.transcript_completed`. Fail → throw.
   - Return `{ eventType, payload, tenantId, organizationId }` on success.

4. On real events, the shared pipeline runs dedup + rate limit, then emits `webhooks.inbound.received`. A subscriber calls `adapter.processInbound({ eventType, payload, tenantId, organizationId, providerKey: 'zoom' })`. Inside `processInbound`:
   - Resolve `ZoomCredentials` from the integrations vault at `(tenantId, organizationId)`.
   - Consistency check: if `payload.account_id !== vault.accountId`, reject with 409 and log `zoom.webhook.account_mismatch` (see §Webhook security).
   - Call `provider.fetchTranscript(payload.object.uuid, ctx)` — internally:
     - Locate `recording_files[]` entry with `file_type='TRANSCRIPT'` and `file_extension='VTT'`. If none, swallow with a structured log `zoom.webhook.no_transcript_file` — a `recording.transcript_completed` without a VTT file would be a Zoom oddity worth tracking but not worth retrying.
     - Fetch VTT via `download_url` using the `download_token` from the webhook payload: `GET <download_url>?access_token=<download_token>`. On 401/403 (token expired), fall back to a freshly-issued OAuth access token via the `Authorization: Bearer` header.
     - Fetch `GET /past_meetings/{uuid}/participants?page_size=300` with cursor pagination until exhausted.
     - Compose `TranscriptResult` (see §Provider implementation).
   - Submit the normalized `TranscriptResult` via `commandBus.execute('call_transcripts.ingest', { tenantId, organizationId, providerKey: 'zoom', transcript: result })` (owned by the parent `call_transcripts` module).

Failure handling: verification failures throw from `verifyWebhook` and the shared pipeline maps them to 401/400/409. Any internal error in `processInbound` bubbles up to the subscriber's error handler, letting Zoom retry per their webhook policy (up to 3 retries with exponential backoff). The parent's `call_transcripts.ingest` command is idempotent on `(providerKey='zoom', sourceRecordingId)`, so retries don't produce duplicates.

### Polling fallback

Worker: `packages/transcription-zoom/src/workers/poll-zoom.ts`
- Queue: `transcription-poll-zoom`.
- Concurrency: 1 per tenant (per OM queue contract).
- Trigger: cron every `pollIntervalMinutes` minutes (default 15; configurable per tenant via `ZoomPollCursor.pollIntervalMinutes` column).
- For each connected tenant:
  1. Fetch OAuth access token (cache-aware).
  2. Page through `GET /users?page_size=100` to list every user under the account.
  3. For each user, read `ZoomPollCursor(tenant_id, zoom_user_id).lastPolledAt` (default: `now() - 30 days` on first poll) and page `GET /users/{id}/recordings?from=<lastPolledAt>&to=<now>&page_size=100`.
  4. For each recording item with a `recording_files[]` entry of `file_type='TRANSCRIPT'`:
     - Skip if `(providerKey='zoom', sourceRecordingId=meeting.uuid)` is already known via the `call_transcripts` module's query-index (idempotency).
     - Execute `provider.fetchTranscript(meeting.uuid, ctx)`.
     - Submit via `commandBus.execute('call_transcripts.ingest', { tenantId, organizationId, providerKey: 'zoom', transcript: result })`.
  5. Update `lastPolledAt = now()` only after all pages for this user are fully processed.
- Self-throttling: 10 req/sec per account; exponential backoff (500ms → 8s) on 429/5xx; honor `Retry-After` header; max 5 retries per call.

### Manual reingest

Reuses the parent `call_transcripts` module's reingest command. The command resolves `providerKey='zoom'` from the transcript's staging record, then calls our `provider.fetchTranscript` with the existing `sourceRecordingId` (the meeting UUID) and re-runs `call_transcripts.ingest`.

---

## Webhook security

### HMAC-SHA256 verification

Zoom's standard. The signature is computed over the string:

```
v0:<x-zm-request-timestamp>:<rawBody>
```

with the webhook secret token as the key. Format delivered in the header: `x-zm-signature: v0=<hex>`.

Adapter requirements (enforced inside `adapter.verifyWebhook`):

1. **Preserve raw body.** The shared `@open-mercato/webhooks` pipeline handles raw-body preservation upstream of the adapter; this package does NOT own a route or middleware of its own. `adapter.verifyWebhook` receives the raw bytes as its `body` argument.
2. **Constant-time compare** (`crypto.timingSafeEqual`). No string equality — applies to both the `?t=` signed-token compare and the `x-zm-signature` compare.
3. **Replay protection.** Reject if `|now - x-zm-request-timestamp|` exceeds 300 seconds. Protects against replay of captured requests.
4. **URL validation handshake.** On `endpoint.url_validation`, `verifyWebhook` returns a synthetic envelope; the adapter's response path (either `processInbound` returning a typed response, or a dedicated handshake responder exposed to the shared route) computes `hex(HMAC-SHA256(plainToken, secretToken))` and returns both tokens. Zoom's mandatory cooperative handshake; failure prevents webhook registration. Because the webhook URL carries a signed tenant token (§Tenant routing), the handler knows exactly which tenant's secret to use.
5. **Account-id consistency.** On real events, `payload.account_id` MUST equal the vault's `accountId` for the URL-resolved tenant. Enforced inside `processInbound`. Defense-in-depth against a legitimate signed token being replayed against a webhook payload that originated from a different Zoom account.

### Tenant routing (URL-validation AND real events)

**(Redesigned per ANALYSIS 2026-04-22-transcription-provider-specs.md findings #2 and #3. Earlier drafts of this spec proposed either a two-step admin URL edit with a `?t=` hint, or a server-side "scan tenants and respond with whichever secret matches" handshake. The two-step edit is fragile operator UX; the scan approach is not implementable — the server can only send ONE response to the URL-validation request and has no oracle that tells it which tenant's secret Zoom would accept before it replies.)**

**Strategy: the webhook URL carries a self-verifying tenant token.**

The URL the admin pastes into Zoom's Event Subscriptions page is:

```
https://<om-host>/api/webhooks/inbound/zoom?t=<signedTenantToken>
```

Where `signedTenantToken = base64url(tenantId) + "." + hex(HMAC-SHA256(tenantId, OM_INTERNAL_WEBHOOK_KEY))`. The key is an OM-internal secret (env `OM_INTERNAL_WEBHOOK_KEY`, 32-byte random); it does NOT rotate with tenant-visible secrets. Properties:

- **Unforgeable.** Without `OM_INTERNAL_WEBHOOK_KEY` an attacker cannot mint a token.
- **Self-verifying.** The handler validates the token and extracts `tenantId` without any DB round-trip.
- **Deterministic routing.** Every inbound webhook to this URL — both the one-time URL-validation handshake and every real event afterwards — is bound to exactly one tenant by the URL itself.
- **One URL, one paste.** The admin copies the URL from OM's integrations card and pastes it into Zoom once. No editing twice. No re-configuration after validation.

### URL-validation handshake

Given the tenant is known from the URL token, the handshake is straightforward:

1. Extract `tenantId` from `t`; constant-time-compare the HMAC signature; reject with 401 on tampering.
2. Load the tenant's `webhookSecretToken` from the integrations vault entry keyed by `(integrationId='transcription_zoom', tenantId, organizationId)`.
3. Compute `encryptedToken = hex(HMAC-SHA256(plainToken, webhookSecretToken))`.
4. Respond 200 `{ plainToken, encryptedToken }` within 3 seconds.
5. Zoom validates; handshake succeeds.

No scanning. No guessing. No cache needed.

### Real-event routing

1. Extract `tenantId` from `t`; verify signature; reject with 401 on tampering.
2. Load the tenant's credentials from the vault.
3. Verify `x-zm-signature` HMAC against the tenant's `webhookSecretToken`; reject with 401 on mismatch.
4. Reject if `|now - x-zm-request-timestamp| > 300s` (replay window).
5. **Consistency check**: if `payload.account_id !== vault.accountId` for the tenant, reject with 409 and log a structured alert. This defends against a malicious or misconfigured webhook payload that matches a valid signed token but came from the wrong Zoom account (vanishingly unlikely given the tenant's secret is unique, but defense-in-depth).
6. Proceed with the ingest flow (§Ingestion).

### Uniqueness restored

Because the URL (not the payload) decides the tenant, `(accountId, tenantId)` UNIQUE in the vault no longer creates routing ambiguity. Two OM tenants may legitimately register the same Zoom account — they'll have different signed tokens in their webhook URLs, and Zoom will deliver events to each URL independently. There is no "fan-out" scenario and no cross-tenant ingest risk.

### Secret rotation

`POST /api/integrations/transcription-zoom/rotate-secret` is NOT offered by OM — the webhook secret is owned by Zoom's app configuration, not by OM. To rotate:

1. Admin regenerates the Webhook Secret Token in the Zoom app's Event Subscriptions page.
2. Admin opens the OM integrations card → **Update Webhook Secret** → pastes the new token. OM re-verifies by issuing a synthetic verification request (call the stored webhook URL internally with a crafted signed body? — not practical; instead, the UI triggers an immediate poll run to confirm auth still works end-to-end and updates the vault).

A drift between the Zoom-side secret and OM's stored secret causes all webhooks to fail signature → 401; the integrations card surfaces a red status with "Webhook secret mismatch — update the token in OM." The polling fallback keeps ingest alive through the drift.

### TLS + scope discipline

- Webhook URL must be HTTPS; HTTP is rejected at the route level.
- Zoom scope list is minimal (read-only + admin + report). No mutation scopes. Reviewed during SPEC-045 marketplace registration.

---

## Routing details (how Zoom data maps to the parent's pipeline)

### Participants → junction rows

Adapter builds `TranscriptResult.participants`:

```ts
const participants: TranscriptResult['participants'] = []
for (const p of participantsResponse.participants ?? []) {
  if (!p.user_email) continue                                    // skip anonymous joiners
  participants.push({
    email: p.user_email,
    displayName: p.name,
    role: p.user_id === recording.host_id ? 'host' : 'participant',
  })
}
// Guarantee the host is represented even if the participants endpoint misses them
if (recording.host_email && !participants.some((x) => x.email === recording.host_email)) {
  participants.unshift({
    email: recording.host_email,
    displayName: recording.host_email,
    role: 'host',
  })
}
```

Anonymous joiners (no `user_email`) **are** added to `participants[]` as display-name-only rows (`{ displayName: vttSpeakerLabel, role: 'participant' }`). The parent spec's relaxed CHECK on `CallTranscriptParticipant` (email OR phone OR display_name) accepts these; the rows are stored with `matchable = false` and are skipped by `CustomerMatchingService.matchParticipants`. They do NOT propagate to `CustomerInteractionParticipant` (whose CHECK still requires email or phone) — the CRM-side junction table is the matchable-identity subset by design. They remain visible inside the transcript segments via their VTT speaker label, and in the unmatched-inbox participant summary, so operators can see who spoke even when the speaker has no contact identity.

### VTT parsing → segments

```ts
function parseVtt(vtt: string): Array<{ speaker?: string; startSec: number; endSec: number; text: string }> {
  const segments: ReturnType<typeof parseVtt> = []
  const blocks = vtt.split(/\r?\n\r?\n/).slice(1) // drop "WEBVTT" header
  for (const block of blocks) {
    const lines = block.split(/\r?\n/).filter(Boolean)
    if (!lines.length) continue
    const timeLine = lines.find((ln) => ln.includes('-->'))
    if (!timeLine) continue
    const [startStr, endStr] = timeLine.split('-->').map((s) => s.trim())
    const textLines = lines.slice(lines.indexOf(timeLine) + 1)
    const rawText = textLines.join('\n').trim()
    const match = rawText.match(/^([^:]{1,80}):\s*(.*)$/s)  // "Speaker: text"
    segments.push({
      speaker: match?.[1]?.trim() || undefined,
      startSec: parseVttTimestamp(startStr),
      endSec: parseVttTimestamp(endStr),
      text: (match ? match[2] : rawText).trim(),
    })
  }
  return segments
}
```

`parseVttTimestamp('00:12:34.567')` → `754.567`. Fixture-tested in `lib/__tests__/vtt.test.ts` with real Zoom VTT output.

### Joined plaintext

`TranscriptResult.text = segments.map((s) => (s.speaker ? `${s.speaker}: ${s.text}` : s.text)).join('\n')`. This is what the parent's search indexer and `<CallTranscriptCard>` display.

### `providerMetadata`

The parent spec types `providerMetadata` as `Record<string, JsonValue>` — each provider is free to emit its own shape. The keys below are **Zoom-private** metadata; consumers that need provider-portable fields should read the top-level `TranscriptResult` fields (`participants`, `segments`, `durationSec`, `occurredAt`, `title`, `sourceMeetingUrl`), not reach into `providerMetadata`. The shared `<CallTranscriptCard>` component does read one Zoom-specific key (`anonymousParticipantCount`) for the anonymous-notice caption; the caption is gated on `interaction.custom_values.sourceProvider === 'zoom'` AND `providerMetadata.anonymousParticipantCount > 0` so other providers emitting unrelated metadata don't trigger it.

```ts
providerMetadata: {
  meetingUuid: recording.uuid,
  meetingId: recording.id,
  hostId: recording.host_id,
  hostEmail: recording.host_email,
  anonymousParticipantCount: totalParticipants - emailMatchedCount,   // Zoom-private; read by the anonymous-notice UI caption
  vttSizeBytes: Buffer.byteLength(vtt, 'utf8'),
}
```

`anonymousParticipantCount` is surfaced in the integrations admin UI so operators can see at a glance how often participants are dropped due to anonymous joining.

---

## Data models (delta from parent)

### One new local-state table (per-user polling cursor)

Table name is plural per the root `AGENTS.md` convention ("Database tables and columns: snake_case; **table names plural**"). The entity is `ZoomPollCursor` (singular) and the table is `transcription_zoom_poll_cursors` (plural).

```ts
// packages/transcription-zoom/src/modules/transcription_zoom/data/entities.ts
@Entity({ tableName: 'transcription_zoom_poll_cursors' })
@Unique({ name: 'zoom_poll_cursor_tenant_user_unique', properties: ['tenantId', 'zoomUserId'] })
@Index({ name: 'zoom_poll_cursor_tenant_idx', properties: ['tenantId'] })
@Index({ name: 'zoom_poll_cursor_org_idx', properties: ['organizationId', 'tenantId'] })
export class ZoomPollCursor {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' }) id!: string
  @Property({ name: 'zoom_user_id', type: 'text' }) zoomUserId!: string
  @Property({ name: 'organization_id', type: 'uuid' }) organizationId!: string
  @Property({ name: 'tenant_id', type: 'uuid' }) tenantId!: string
  @Property({ name: 'last_polled_at', type: Date, nullable: true }) lastPolledAt?: Date | null
  @Property({ name: 'poll_interval_minutes', type: 'int', default: 15 }) pollIntervalMinutes: number = 15
  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() }) createdAt: Date = new Date()
  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() }) updatedAt: Date = new Date()
}
```

### No changes to parent's data model

No new entities in the customers module. No changes to `CustomerInteractionParticipant`, `CustomerUnmatchedTranscript`, encryption maps, or the customer_interaction custom fields.

---

## Provider implementation

```ts
// packages/transcription-zoom/src/provider.ts
import type {
  CallTranscriptProvider,
  ProviderCtx,
  TranscriptResult,
  RecordingSummary,
} from '@open-mercato/shared/modules/call_transcripts/provider'
import type { ZoomCredentials } from './credentials'
import { fetchZoomAccessToken } from './lib/token'
import { throttledFetch } from './lib/throttled-fetch'
import { parseVtt } from './lib/vtt'
import { encodeMeetingUuid } from './lib/meeting-uuid'

const BASE_URL = 'https://api.zoom.us/v2'

export class ZoomCallTranscriptProvider implements CallTranscriptProvider<ZoomCredentials> {
  id = 'zoom'
  label = 'Zoom'
  viewLabel = 'Open in Zoom'
  pollIntervalMinutes = 15

  async fetchTranscript(meetingUuid: string, ctx: ProviderCtx<ZoomCredentials>): Promise<TranscriptResult> {
    const token = await fetchZoomAccessToken(ctx)
    const encoded = encodeMeetingUuid(meetingUuid)
    const headers = { Authorization: `Bearer ${token}` }
    const [bundle, participantsPages] = await Promise.all([
      this.request<ZoomRecordingBundleResponse>(`/meetings/${encoded}/recordings`, headers, ctx),
      this.pagedRequest<ZoomParticipantsResponse>(`/past_meetings/${encoded}/participants?page_size=300`, headers, ctx),
    ])

    const transcriptFile = bundle.recording_files.find(
      (f) => f.file_type === 'TRANSCRIPT' && f.file_extension === 'VTT',
    )
    if (!transcriptFile) {
      throw new ZoomMissingTranscriptError(meetingUuid)
    }
    const vtt = await this.fetchVtt(transcriptFile.download_url, token, ctx)

    return this.normalize(vtt, participantsPages, bundle)
  }

  async *listRecentRecordings(
    ctx: ProviderCtx<ZoomCredentials>,
    since: Date,
  ): AsyncIterable<RecordingSummary> {
    const token = await fetchZoomAccessToken(ctx)
    const headers = { Authorization: `Bearer ${token}` }
    const from = since.toISOString().slice(0, 10)
    const to = new Date().toISOString().slice(0, 10)

    for await (const user of this.pageAll<ZoomUserListResponse, ZoomUser>(`/users?page_size=100`, headers, ctx, 'users')) {
      for await (const rec of this.pageAll<ZoomUserRecordingsResponse, ZoomRecording>(
        `/users/${encodeURIComponent(user.id)}/recordings?from=${from}&to=${to}&page_size=100`,
        headers,
        ctx,
        'meetings',
      )) {
        const hasTranscript = rec.recording_files?.some(
          (f) => f.file_type === 'TRANSCRIPT' && f.file_extension === 'VTT',
        )
        if (!hasTranscript) continue
        yield {
          externalRecordingId: rec.uuid,
          occurredAt: new Date(rec.start_time),
          title: rec.topic,
        }
      }
    }
  }

  private async fetchVtt(downloadUrl: string, oauthToken: string, ctx: ProviderCtx<ZoomCredentials>): Promise<string> {
    const res = await throttledFetch(downloadUrl, {
      headers: { Authorization: `Bearer ${oauthToken}` },
    })
    if (!res.ok) throw new ZoomApiError(res.status, await res.text())
    return res.text()
  }

  private normalize(
    vtt: string,
    participantsPages: ZoomParticipantsResponse[],
    bundle: ZoomRecordingBundleResponse,
  ): TranscriptResult {
    const segments = parseVtt(vtt)
    const allParticipants = participantsPages.flatMap((p) => p.participants)

    const participants: TranscriptResult['participants'] = []
    const seenEmails = new Set<string>()
    for (const p of allParticipants) {
      if (!p.user_email) continue
      if (seenEmails.has(p.user_email)) continue
      seenEmails.add(p.user_email)
      participants.push({
        email: p.user_email,
        displayName: p.name,
        role: p.user_id === bundle.host_id ? 'host' : 'participant',
      })
    }
    if (bundle.host_email && !seenEmails.has(bundle.host_email)) {
      participants.unshift({
        email: bundle.host_email,
        displayName: bundle.host_email,
        role: 'host',
      })
    }

    const text = segments.map((s) => (s.speaker ? `${s.speaker}: ${s.text}` : s.text)).join('\n')

    return {
      externalRecordingId: bundle.uuid,
      sourceMeetingUrl: bundle.share_url ?? `https://zoom.us/recording/detail?meeting_id=${encodeURIComponent(bundle.uuid)}`,
      occurredAt: new Date(bundle.start_time),
      durationSec: Math.round((bundle.duration ?? 0) * 60),   // Zoom returns duration in minutes
      title: bundle.topic,
      text,
      segments,
      participants,
      providerMetadata: {
        meetingUuid: bundle.uuid,
        meetingId: bundle.id,
        hostId: bundle.host_id,
        hostEmail: bundle.host_email,
        anonymousParticipantCount: allParticipants.length - participants.length,
        vttSizeBytes: Buffer.byteLength(vtt, 'utf8'),
      },
    }
  }

  // request / pagedRequest / pageAll helpers defined in lib/http.ts
}
```

Local response types (`ZoomRecordingBundleResponse`, `ZoomParticipantsResponse`, `ZoomUser`, etc.) are zod-validated at the API boundary — no `unknown` leaks past the provider class.

---

## Files to create

Follows the established provider-package layout (verified against `packages/gateway-stripe` and `packages/sync-akeneo`): a top-level kebab-case package containing a single snake-case module folder at `src/modules/<module_id>/` that OM's auto-discovery scans.

```
packages/transcription-zoom/
├── package.json
├── README.md
├── docs/setup-screenshots/
└── src/
    ├── index.ts                               // re-exports module bootstrap
    └── modules/
        └── transcription_zoom/
            ├── index.ts                       // module metadata
            ├── integration.ts                 // IntegrationDefinition (SPEC-045 marketplace entry)
            ├── provider.ts                    // ZoomCallTranscriptProvider
            ├── webhook-adapter.ts             // WebhookEndpointAdapter (verifyWebhook + processInbound)
            ├── credentials.ts                 // ZoomCredentials + zod schema
            ├── acl.ts                         // transcription_zoom.view, .configure
            ├── setup.ts                       // defaultRoleFeatures, onTenantCreated, env preset
            ├── di.ts                          // registers provider via registerCallTranscriptProvider + webhook adapter via registerWebhookEndpointAdapter
            ├── cli.ts                         // apply-preset (reapply env presets post-rotation); ping (health-check: token fetch + plan-gate dry run, prints JSON)
            ├── api/
            │   ├── schemas.ts                 // zod schemas (Zoom REST + webhook payloads)
            │   └── POST/
            │       └── integrations/
            │           └── transcription-zoom/
            │               ├── connect.ts
            │               ├── update-webhook-secret.ts
            │               ├── test.ts
            │               └── disconnect.ts  // (method-folder = DELETE for this one; see note)
            ├── data/
            │   └── entities.ts                // ZoomPollCursor
            ├── workers/
            │   └── poll-zoom.ts
            ├── lib/
            │   ├── token.ts                   // fetchZoomAccessToken (cached, refresh-on-401)
            │   ├── throttled-fetch.ts         // 10 req/sec, backoff, Retry-After
            │   ├── vtt.ts                     // parseVtt + parseVttTimestamp
            │   ├── http.ts                    // request / pagedRequest / pageAll
            │   ├── meeting-uuid.ts            // encodeMeetingUuid (double URL-encode when needed)
            │   ├── preset.ts                  // applyZoomEnvPreset (mirrors gateway-stripe preset)
            │   └── url-validation.ts          // handshake response helper
            ├── i18n/
            │   ├── en.json
            │   └── pl.json
            ├── migrations/                    // generated by yarn db:generate
            └── __integration__/
                ├── meta.ts
                └── TC-ZOOM-001.spec.ts ... TC-ZOOM-019.spec.ts
```

Note on `disconnect.ts`: OM's auto-discovery convention dispatches by HTTP method via the method-named parent folder (`api/POST/`, `api/DELETE/`, etc.). `disconnect` lives under `api/DELETE/integrations/transcription-zoom/disconnect.ts` rather than `POST/`.

---

## API Contracts (delta from parent)

### Webhook intake (via `@open-mercato/webhooks` shared route)

**This package does NOT expose a new webhook route URL.** The shared inbound route `POST /api/webhooks/inbound/zoom` (owned by `@open-mercato/webhooks`) dispatches to the `WebhookEndpointAdapter` that this package registers from `di.ts` via `registerWebhookEndpointAdapter`. The earlier plan to ship an auto-discovered `api/POST/webhooks/transcription/zoom.ts` file has been retired per PR #1645 feedback; all provider webhooks now flow through the shared pipeline.

`POST /api/webhooks/inbound/zoom?t=<signedTenantToken>` — served by `@open-mercato/webhooks`. The behavior below describes what happens inside the adapter hooks (`verifyWebhook` + `processInbound`) for Zoom events:

- **Auth** (layered, all enforced inside `adapter.verifyWebhook`):
  1. Query param `t` — validated as `base64url(tenantId).hex(HMAC-SHA256(tenantId, OM_INTERNAL_WEBHOOK_KEY))`. Missing or tampered → throw (shared pipeline maps to 401).
  2. `x-zm-signature` header — verified against the resolved tenant's stored `webhookSecretToken`. Fails constant-time compare → throw (401).
  3. Replay window — reject if `|now - x-zm-request-timestamp| > 300s` on real events.
  4. Consistency — on real events (inside `processInbound`), `payload.account_id` must equal `vault.accountId` for the resolved tenant, else 409.
- **Body schema**: raw body preserved by the shared pipeline, zod-validated. `endpoint.url_validation` is handled inside the new `adapter.handleHandshake` hook (synchronous short-circuit path — see parent spec §3 "URL-validation handshakes"); `recording.transcript_completed` flows through the normal `verifyWebhook` → receipt → subscriber path. Other events → 200 + no-op in v1.
- **Response**:
  - `endpoint.url_validation`: 200 `{ plainToken, encryptedToken }` returned synchronously by `handleHandshake`, short-circuiting the receipt / emit pipeline. **This path depends on the additive `handleHandshake` hook landing in `@open-mercato/webhooks` — it is a hard prerequisite for Phase 2 of this sub-spec (see §Implementation Phases) and is tracked separately from this adapter's own commits.**
  - Real events: 200 `{ ok: true }` from the shared pipeline default.
  - 401 on signed-token / signature failure (thrown from `verifyWebhook` or `handleHandshake`).
  - 409 on account-id mismatch (thrown inside `processInbound`; the receipt still lands, but the event is discarded).
  - 400 on payload schema failure.
  - 500 on internal error.
- **Idempotency**: handled downstream by the parent `call_transcripts.ingest` command (idempotent on `(providerKey='zoom', sourceRecordingId=meetingUuid)`).

### Provider connect (this package)

`POST /api/integrations/transcription-zoom/connect`
- **Auth**: `requireAuth`, `requireFeatures: ['transcription_zoom.configure']`.
- **Body**: `{ accountId: string, clientId: string, clientSecret: string, webhookSecretToken: string }`.
- Fetches an OAuth token + calls the plan-gate endpoint. On success, stores `ZoomCredentials` in the vault and returns `{ webhookUrl, setupInstructions, scopes, preconfigured: boolean }`.

`POST /api/integrations/transcription-zoom/update-webhook-secret`
- **Auth**: `requireAuth`, `requireFeatures: ['transcription_zoom.configure']`.
- **Body**: `{ webhookSecretToken: string }`.
- Updates the token in the vault; triggers a synthetic token-fetch call to confirm the OAuth side still works; returns the new setup instructions.

`POST /api/integrations/transcription-zoom/test`
- **Auth**: `requireAuth`, `requireFeatures: ['transcription_zoom.configure']`.
- Runs a dry-run: fetch OAuth token → call `GET /users?page_size=1` → call `GET /accounts/{id}/settings?option=recording` → return a health JSON with token-cache state, plan-gate state, user-count, and rate-limit headroom.

`DELETE /api/integrations/transcription-zoom/disconnect`
- **Auth**: same.
- Removes the credential entry; preserves all already-ingested transcripts.

All routes export `openApi`.

---

## Commands & Events (delta from parent)

No new events declared by this package — the adapter relies on the parent `call_transcripts` module's events (`call_transcripts.transcript.ingested`, `.unmatched`, `.reingested`).

The adapter does NOT declare its own commands — connect/disconnect/update-webhook-secret are direct API routes, not undoable commands (provider lifecycle, not domain mutations). The ingestion entry point is the parent's `call_transcripts.ingest` command, invoked from `processInbound` and the polling worker.

---

## UI & UX (delta from parent)

### Integrations marketplace card

A new card in `/backend/integrations` for "Zoom (call transcripts)" with:

- **Status pill**:
  - *Green* when last successful webhook or poll run was < 30 min ago.
  - *Amber* when last activity > 30 min but OAuth + plan-gate checks still pass.
  - *Red* on auth failure, plan-gate failure, or webhook-signature mismatch.
- **Connected-as line**: shows the account ID and the email of `connectedBy`. `connectedBy` is stored as the OM user UUID in the vault; the integrations card joins to the auth module's user store at render time to resolve the display email. Fallback when the user has been deleted: render "Deleted user" with a muted tone.
- **Primary action**: **Connect Zoom** (when not connected) or **Reconfigure** (when connected).
- **Secondary actions**: **Update Webhook Secret** (gated by `transcription_zoom.configure`), **Test Connection** (same), **Disconnect** (gated, with a destructive confirm via `useConfirmDialog()`).
- **Metrics**: last 24h ingest count, last poll time, anonymous-participant-ratio (aggregated from `providerMetadata.anonymousParticipantCount` on recent ingests — helps admins see if lots of attendees are dropping off routing).

### Connect dialog

Four fields laid out in a single `<CrudForm>`-style panel:

- **Account ID** (`FormField` with help-text "Zoom Admin → Advanced → Account Profile").
- **Client ID** + **Client Secret** (two `FormField`s; secret is a password input).
- **Webhook Secret Token** (password input).
- A `<CollapsibleSection title="Step-by-step setup">` with `docs/setup-screenshots/` rendered inline (1. create Server-to-Server OAuth app with the listed scopes; 2. copy credentials; 3. configure event subscriptions with the displayed URL; 4. paste the Webhook Secret Token here).
- Submit runs `POST /api/integrations/transcription-zoom/connect`. Dialog honors `Cmd/Ctrl+Enter` + `Escape` per DS rules. Errors render via `<Alert variant="destructive">`.

### No provider-specific UI hints on `<CallTranscriptCard>`

Unlike the tl;dv adapter (which needs the "organizer-matched only" notice), Zoom's matching is rich enough that no special UI warning is needed for the normal case. When `providerMetadata.anonymousParticipantCount > 0` on a specific transcript, `<CallTranscriptCard>` renders a small muted caption under the participants strip: *"{{count}} anonymous attendee(s) in this meeting — their words appear in the transcript but aren't linked to a CRM contact."* (translatable; key `call_transcripts.provider_notices.zoom.anonymous_notice` — owned by this Zoom package and merged into the `call_transcripts` i18n namespace at runtime). This notice is driven by data, not provider id — it only fires when the count is > 0 — so it stays silent for clean-call cases.

---

## Internationalization

New i18n keys (`packages/transcription-zoom/src/i18n/<locale>.json`):

```
transcription_zoom.connect.title
transcription_zoom.connect.account_id_label
transcription_zoom.connect.client_id_label
transcription_zoom.connect.client_secret_label
transcription_zoom.connect.webhook_secret_label
transcription_zoom.connect.submit
transcription_zoom.connect.invalid_credentials
transcription_zoom.connect.plan_gate_failed
transcription_zoom.connect.missing_scope
transcription_zoom.connect.success
transcription_zoom.setup.webhook_url_label
transcription_zoom.setup.events_to_subscribe
transcription_zoom.setup.scopes_required
transcription_zoom.setup.instructions_heading
transcription_zoom.update_secret.title
transcription_zoom.update_secret.success
transcription_zoom.test.title
transcription_zoom.test.success
transcription_zoom.test.token_cache_state
transcription_zoom.disconnect.confirm
transcription_zoom.disconnect.success
transcription_zoom.status.connected
transcription_zoom.status.stale
transcription_zoom.status.auth_failed
transcription_zoom.status.secret_mismatch
transcription_zoom.status.last_activity_at
transcription_zoom.metrics.anonymous_ratio
```

Plus one additional key in this package's i18n bundle under the shared transcript-module namespace: `call_transcripts.provider_notices.zoom.anonymous_notice`. This key is owned by the Zoom package but merged into the `call_transcripts` runtime namespace so `<CallTranscriptCard>` (owned by the transcript module) can resolve it via `useT()` without the card needing provider-specific wiring.

Locales: `en` (mandatory) and `pl` (user is Polish-speaking; same as tl;dv).

---

## Access Control

New ACL features (`packages/transcription-zoom/src/modules/transcription_zoom/acl.ts`), mirroring the established convention from `packages/gateway-stripe/src/modules/gateway_stripe/acl.ts` (`<module>.view` + `<module>.configure`):

```ts
export const features = [
  { id: 'transcription_zoom.view',      title: 'View Zoom transcription integration',      module: 'transcription_zoom' },
  { id: 'transcription_zoom.configure', title: 'Configure Zoom transcription integration', module: 'transcription_zoom' },
]

export default features
```

Default role assignments (`setup.ts`, via `defaultRoleFeatures`):

| Feature | superadmin | admin | manager | employee |
|---|:-:|:-:|:-:|:-:|
| `transcription_zoom.view`      | ✓ | ✓ | ✓ | — |
| `transcription_zoom.configure` | ✓ | ✓ | — | — |

- `transcription_zoom.view` gates read-only access to the integrations card (status pill, last-activity metrics, anonymous-ratio metric).
- `transcription_zoom.configure` gates the `/connect`, `/update-webhook-secret`, `/test`, `/disconnect` routes.

The webhook intake route is NOT gated by an ACL feature — it's public by URL and authenticates by HMAC-SHA256 signature against the tenant-specific secret token. This matches the webhooks-package norm: webhooks are signature-authenticated, not role-gated. (Earlier drafts introduced a `transcription_zoom.webhook.receive` audit feature; removed — it has no analogue in any existing OM provider package and the audit concern is served by the integrations-module log service.)

Transcript view ACL remains the parent spec's `call_transcripts.view` (owned by the `call_transcripts` module, unchanged by this package).

---

## Backward Compatibility

Reviewed against the 13 contract surfaces in `BACKWARD_COMPATIBILITY.md`. All changes are **additive**.

| # | Surface | This sub-spec's changes |
|---|---|---|
| 1 | Auto-discovery file conventions | New package follows existing conventions. |
| 2 | Type definitions & interfaces | Implements the parent's `CallTranscriptProvider` — no contract change. New local types are package-internal. |
| 3 | Function signatures | None changed. |
| 4 | Import paths | New: `@open-mercato/transcription-zoom`. Internal package; not consumed elsewhere. |
| 5 | Event IDs | None new. |
| 6 | Widget injection spot IDs | Uses the existing integrations-marketplace spot; no new spot ID. |
| 7 | API route URLs | New: `/api/integrations/transcription-zoom/{connect,update-webhook-secret,test,disconnect}`. No new webhook route — registers a `WebhookEndpointAdapter` for the existing shared route `/api/webhooks/inbound/zoom`. |
| 8 | Database schema | One new table `transcription_zoom_poll_cursors`. Owned by this package. |
| 9 | DI service names | Two additive registrations: `registerCallTranscriptProvider(ZoomCallTranscriptProvider)` + `registerWebhookEndpointAdapter(zoomWebhookAdapter)`. Matches the `payment_gateways` / `data_sync` module-level registry pattern — no DI multi-provider token. |
| 10 | ACL feature IDs | 2 new in `transcription_zoom.*`. |
| 11 | Notification type IDs | None new. |
| 12 | CLI commands | 2 new: `yarn mercato transcription-zoom apply-preset`, `yarn mercato transcription-zoom ping`. Additive. |
| 13 | Generated file contracts | None changed. |

---

## Risks & Impact Review

| Risk | Severity | Affected area | Mitigation | Residual |
|---|---|---|---|---|
| Zoom rotates a customer's Webhook Secret Token without notifying OM; all webhooks start failing signature | Medium | Reliability | Red status pill on the integrations card; polling fallback keeps ingest alive until the admin updates the secret in OM. | Low |
| `download_token` expires before the webhook handler fetches the VTT (slow downstream ingest) | Low | Reliability | Handler falls back to OAuth Bearer on 401/403 against `download_url`. Token-cache refresh covers OAuth token expiry. | Low |
| Meeting UUID contains `/` and is passed un-double-encoded to Zoom API → 404/400 | Medium | Reliability | `encodeMeetingUuid` helper double-URL-encodes when the UUID starts with `/` or contains `//`. Unit tested. | Low |
| Zoom rate-limit burst during initial backfill on an account with 1000s of historical recordings | Medium | Performance | Self-throttle at 10 req/sec; `Retry-After` honored; `lastPolledAt` default of `now() - 30 days` bounds first-run work; polling worker runs concurrency=1 per tenant. | Low |
| Admin misconfigures the Zoom app scopes (e.g. forgets `account:read:admin`) → plan-gate call fails with 403 on connect | Low | UX | Connect flow returns a structured 400 with the missing-scope name when Zoom's error body includes it; `transcription_zoom.connect.missing_scope` i18n key guides remediation. | Low |
| Account plan downgraded from Business → Pro mid-life; transcripts stop arriving silently | Medium | Data quality | Polling fallback will start seeing "no transcript file" on all new recordings; after N consecutive empty polls the adapter flips status to amber/red with "Audio Transcript appears disabled on this Zoom account". | Low |
| VTT file size extremely large (long all-hands meetings) | Low | Performance | VTT size captured in `providerMetadata.vttSizeBytes`; parent's search indexer already caps to 4000 chars per call. | Low |
| `OM_INTERNAL_WEBHOOK_KEY` leaks → attacker mints tokens for arbitrary tenants | High | Security | Key is an OM-internal secret never served via any API; rotation procedure documented in ops runbook. Rotation invalidates ALL tenants' webhook URLs simultaneously — acceptable cost if a leak is suspected, and surfaces immediately because Zoom webhooks start failing on the old tokens; each admin then regenerates their URL via the integrations card. | Low |
| Signed tenant token captured from network (passive MITM on a broken TLS link) and replayed against OM | Low | Security | Signed token alone is insufficient — the attacker still needs to forge `x-zm-signature` with the tenant's per-tenant `webhookSecretToken`, which is never exposed on the wire. TLS enforced. | Low |
| Legitimate signed token replayed with a different tenant's Zoom `account_id` in the payload | Low | Security | Consistency check (`payload.account_id === vault.accountId`) rejects the event with 409 and alerts. | Low |
| Anonymous joiners in sensitive meetings still have their display names in the transcript text | Medium | Privacy | Documented behavior (parent spec's `<CallTranscriptCard>` renders transcript as-is); anonymous-notice caption on the card surfaces the count; the source tool (Zoom) is the consent capture point. | Medium — operators may need policy guidance. |
| Zoom webhook payload schema changes unilaterally | Medium | Reliability | Webhook handler zod-validates and returns 400 on shape mismatch; integrations card surfaces the failure; polling fallback continues to work because it uses documented REST endpoints. | Low |

---

## Integration Test Coverage

All tests self-contained per `.ai/qa/AGENTS.md`. Mocks Zoom's REST API + webhook calls at the HTTP layer (using `msw` or equivalent); no calls to real Zoom in CI.

| ID | Covers |
|---|---|
| TC-ZOOM-001 | Signed tenant token: valid `?t=base64url(tenantId).hex(HMAC)` → handler extracts tenantId; missing `t` → 401; tampered HMAC → 401; `OM_INTERNAL_WEBHOOK_KEY` rotated on the server → previously valid token → 401. |
| TC-ZOOM-002 | Webhook URL-validation handshake: `?t=<valid>` + body `endpoint.url_validation` → 200 with `encryptedToken = hex(HMAC-SHA256(plainToken, vault.webhookSecretToken))`. Deterministic, no scanning. |
| TC-ZOOM-003 | Webhook signature verification: valid `v0=…` → 200; tampered body → 401; stale timestamp (> 5 min) → 401. |
| TC-ZOOM-004 | Account-id consistency check: `payload.account_id` matches `vault.accountId` → 200; mismatch → 409 + structured `zoom.webhook.account_mismatch` log. |
| TC-ZOOM-005 | `provider.fetchTranscript`: happy path. VTT fetched, parsed into segments; participants call returns 2 authenticated attendees → participants array has 2 rows + host. |
| TC-ZOOM-006 | `provider.fetchTranscript`: anonymous participants (no `user_email`) — dropped from participants array; `providerMetadata.anonymousParticipantCount` populated. |
| TC-ZOOM-007 | `provider.fetchTranscript`: VTT missing in `recording_files[]` → `ZoomMissingTranscriptError`; `processInbound` swallows with structured log, shared pipeline responds 200 (no retry). |
| TC-ZOOM-008 | VTT parser: real Zoom-format VTT with and without speaker prefix; timestamp math (`00:12:34.567` → 754.567). |
| TC-ZOOM-009 | Meeting UUID encoding: UUID starting with `/` (e.g. `/ABC=`) double-encoded correctly in REST path. |
| TC-ZOOM-010 | OAuth token: cache returns same token within TTL; 401 on API call triggers refresh; invalid client credentials → 400 on connect. |
| TC-ZOOM-011 | Plan gate: `account:read:admin` recording settings with Audio Transcript disabled → connect returns 400 with `plan_gate_failed`; enabled → success. |
| TC-ZOOM-012 | `provider.listRecentRecordings`: pagination across users AND per-user recordings; stops cleanly at `to` boundary; skips recordings without TRANSCRIPT file. |
| TC-ZOOM-013 | Polling worker: respects `lastPolledAt`; updates only after full page; 10 req/sec throttle observed; `Retry-After` honored on simulated 429. |
| TC-ZOOM-014 | Polling worker: skips meetings already ingested (idempotency via parent `call_transcripts` module's `(providerKey, sourceRecordingId)` check). |
| TC-ZOOM-015 | Connect API: missing scopes in OAuth app → Zoom returns 403 → connect returns 400 with `missing_scope` error. |
| TC-ZOOM-016 | Test API (`/test`): returns health JSON with token-cache state + plan-gate state + user count. |
| TC-ZOOM-017 | Disconnect API: credential entry removed; subsequent webhook with a previously-valid signed token → 401 (no vault entry for the tenant). |
| TC-ZOOM-018 | End-to-end (mocked Zoom + real `call_transcripts` module + real DB): webhook arrives at `/api/webhooks/inbound/zoom?t=<signedToken>` → shared pipeline calls `adapter.verifyWebhook` → `adapter.processInbound` → `commandBus.execute('call_transcripts.ingest', ...)` → `customers.interactions.create_from_transcript` → CustomerInteraction + Attachment + N participants created on the test tenant; `call_transcripts.transcript.ingested` event fired. |
| TC-ZOOM-019 | End-to-end: transcript downloaded via `download_token` initially, then falls back to OAuth Bearer when the `download_token` returns 401. |

UI tests inherit from the parent spec's `<CallTranscriptCard>` coverage. Adapter-specific UI tests:

| ID | Flow |
|---|---|
| TC-ZOOM-UI-001 | Connect dialog: fill 4 fields → submit → plan-gate success → setup panel renders with webhook URL, events list, scope list, screenshots. |
| TC-ZOOM-UI-002 | Connect dialog: submit with credentials for a Pro-plan account → inline `<Alert variant="destructive">` with `plan_gate_failed` copy. |
| TC-ZOOM-UI-003 | Integrations card: status pill transitions green → amber → red across the state thresholds. |
| TC-ZOOM-UI-004 | `<CallTranscriptCard>` on a Zoom-sourced interaction with `anonymousParticipantCount > 0` → anonymous-notice caption renders under participants strip. |

---

## Implementation Phases

Each phase = a working app increment; a phase is only "done" when its tests pass and code-review gate succeeds.

### Phase 1 — Provider scaffolding + connect flow + manual ingest

1. Scaffold `packages/transcription-zoom/` (package.json, tsconfig, OM module conventions).
2. Implement `ZoomCallTranscriptProvider` (provider.ts, credentials.ts, api/schemas.ts, lib/{token, throttled-fetch, vtt, http, meeting-uuid}).
3. Register provider via `registerCallTranscriptProvider(ZoomCallTranscriptProvider)` (from `@open-mercato/core/modules/call_transcripts/lib/adapter-registry`) in `di.ts`. The provider contract is re-exported from `@open-mercato/shared/modules/call_transcripts/provider`. No DI multi-provider token — this is a module-level registry, matching the verified `registerGatewayAdapter` / `registerDataSyncAdapter` pattern.
4. ACL features + setup defaults + env preset + CLI (`apply-preset`, `ping`).
5. Connect / update-webhook-secret / test / disconnect API routes.
6. Integrations marketplace card UI + connect dialog.
7. Tests TC-ZOOM-005..011, 015, 016, 017.
8. Manual ingest exercised via the parent `call_transcripts` module's reingest command after a TranscriptResult is hand-submitted through `commandBus.execute('call_transcripts.ingest', ...)`.

**Result**: an admin connects Zoom, plan-gate passes, manual reingest of a known meeting UUID produces a transcript on the matched person's timeline.

### Phase 2 — Webhook adapter intake (via `@open-mercato/webhooks`)

**Prerequisite (blocker)**: `@open-mercato/webhooks` must first ship the `handleHandshake(input) → Promise<null | { status, headers?, body }>` optional hook on the `WebhookEndpointAdapter` interface, and the shared inbound route must invoke it BEFORE `verifyWebhook` (bypassing the standard persist/emit/subscriber path when a non-null result is returned). This is verified as currently NOT supported (route persists a receipt + returns a fixed JSON ack + runs `processInbound` asynchronously — see `packages/webhooks/src/modules/webhooks/api/inbound/[endpointId]/route.ts:54-106` and `.../subscribers/inbound-process.ts`). Size: ~1 atomic commit in `packages/webhooks`. Without this extension, Zoom's URL-validation step fails in 3 seconds and webhook registration is impossible.

1. (Prerequisite) Land the `handleHandshake` extension in `@open-mercato/webhooks` per the parent spec §Proposed Solution.3. Ship with a shared-route test that asserts a non-null `handleHandshake` result bypasses receipt/emit.
2. Implement `webhook-adapter.ts` at the module root — `WebhookEndpointAdapter` with:
   - `handleHandshake`: parses body, checks `event === 'endpoint.url_validation'`, computes `{ plainToken, encryptedToken }`, returns `{ status: 200, body: {...} }`; otherwise returns `null`.
   - `verifyWebhook`: signed-token tenant resolution, HMAC-SHA256 signature verification, 300s replay window (no longer responsible for URL-validation short-circuit — that moved into `handleHandshake`).
   - `processInbound`: account-id consistency check, `fetchTranscript` call, `commandBus.execute('call_transcripts.ingest', ...)`.
3. Register the adapter via `registerWebhookEndpointAdapter(zoomWebhookAdapter)` (from `@open-mercato/webhooks`) in `di.ts`. The shared route `POST /api/webhooks/inbound/zoom` will dispatch to it.
4. Tests TC-ZOOM-001, 002, 003, 004, 018, 019. TC-ZOOM-002 MUST assert that a URL-validation payload hitting `/api/webhooks/inbound/zoom` round-trips correctly and returns the expected `{ plainToken, encryptedToken }` body within the 3-second Zoom handshake budget.

**Result**: real Zoom `recording.transcript_completed` webhooks land transcripts automatically end-to-end through the shared `@open-mercato/webhooks` pipeline, with no per-provider webhook route code in this package.

### Phase 3 — Polling fallback

1. `data/entities.ts` for `ZoomPollCursor`; `yarn db:generate` → commit migration.
2. `workers/poll-zoom.ts` scheduled worker.
3. Tests TC-ZOOM-012, 013, 014.

**Result**: tenants behind firewalls (or with a misconfigured webhook) get automatic ingest with a polling lag.

### Phase 4 — UI hardening + i18n + docs

1. Status pill thresholds + metrics panel on the integrations card.
2. Anonymous-notice caption on `<CallTranscriptCard>` (key `call_transcripts.provider_notices.zoom.anonymous_notice` shipped in this package's i18n bundle and merged into the `call_transcripts` runtime namespace; no customers-module change).
3. Onboarding screenshots in `docs/setup-screenshots/`.
4. Polish translation pass.
5. README in the package root.
6. Tests TC-ZOOM-UI-001..004.
7. Code-review gate (`om-code-review`).
8. Move spec to `.ai/specs/implemented/` after deploy.

**Result**: production-ready reference adapter; the model other transcription provider packages follow.

---

## Assumptions

1. **Server-to-Server OAuth is the correct Zoom auth model for our marketplace entry.** The parent spec's `ZOOM_CLIENT_ID/SECRET/WEBHOOK_SECRET_TOKEN` env vars and `account_id`-based tenant resolution both point to it.
2. **Zoom Business+ is the minimum plan.** Cloud Recording + Audio Transcript is not available on Pro. Connect flow verifies this.
3. **Recording settings field path for Audio Transcript gate needs live verification.** Zoom's `GET /accounts/{id}/settings?option=recording` response has nested variants; the exact boolean path (`recording.auto_transcripts` vs `recording.cloud_recording_settings.audio_transcript` vs similar) must be confirmed against a real Business-plan account before the adapter ships. Implementation task lists this explicitly. Failure mode if the field path is wrong: connect rejects all accounts including valid ones → visible and fixable with a patch, no data-correctness risk.
4. **VTT is Zoom's transcript format** (stable, documented, `file_extension='VTT'` on TRANSCRIPT files). Changes would be announced via Zoom's API changelog.
5. **Anonymous joiners lack `user_email`** in the `/past_meetings/{uuid}/participants` response. v1 drops them from the junction; preserves in segments. Calendar enrichment deferred to a separate v2 spec.
6. **Per-tenant credential scope** matches Zoom's account-level OAuth app model.
7. **Polling default 15 minutes** per tenant is acceptable lag; tenants wanting real-time use the webhook path.
8. **No mutation operations.** Adapter is read-only against Zoom. No create/update/delete calls.
9. **Zoom's `recording.deleted` event is ignored in v1.** If an admin deletes a recording in Zoom, OM keeps the ingested CRM data. Documented as a v1.1 follow-up.
10. **Download-token lifetime is at least several minutes.** Webhook handler fetches the VTT synchronously; if handling is deferred (e.g. queued), the OAuth Bearer fallback is used.
11. **Zoom's rate-limit tier for Cloud Recording = Medium (10 req/sec).** Confirmed against Zoom docs; adapter may need tuning if Zoom changes tiers.

---

## Changelog

- **2026-04-22** — Initial draft. Skeleton + Open Questions gate presented. Q1 (auth model) resolved by Mat proxy → Server-to-Server OAuth (fact-derivation from parent spec). Q3 (anonymous joiners) resolved by Mat proxy → preserve in segments, no junction rows (lessons #2 + #3). Q2 (plan gate) escalated to user → answer: hard-block at connect. New proxy lesson saved: "fail loud on detectable hard gates" (2026-04-22). Full sub-spec written mirroring the tl;dv sub-spec's structure: provider profile from public Zoom API reference, HMAC-SHA256 webhook verification with URL-validation handshake, polling fallback keyed on `lastPolledAt` per (tenant, zoom_user_id), VTT parsing, rich attendee matching via `/past_meetings/{uuid}/participants`. Plan-gate field path flagged for live verification in §Assumptions.
- **2026-04-22** — Architectural review pass against the actual codebase (`packages/gateway-stripe`, `packages/sync-akeneo`, `packages/webhooks`) flagged 14 findings. F1–F10 addressed in-line; F11–F14 addressed in-line:
  - **F1 (Critical)** Package internal structure — restructured §Files to create under `packages/transcription-zoom/src/modules/transcription_zoom/` per verified OM provider-package convention; every path reference in the spec updated.
  - **F2 (High)** Webhook registration mechanism — clarified that OM's auto-discovered `api/POST/webhooks/transcription/zoom.ts` materializes the route; explicitly noted that `registerWebhookHandler` is payment-gateway-only and not used here; §Phase 2 updated.
  - **F3 (High)** Table name — renamed `transcription_zoom_poll_state` → `transcription_zoom_poll_cursors` (plural) per the root `AGENTS.md` convention; entity renamed `ZoomPollState` → `ZoomPollCursor`; swept all references.
  - **F4 (High)** Marketplace hub — parent spec must introduce a new `call_transcripts` hub; §Authentication & credentials adds an explicit `integration.ts` sketch that references `hub: 'call_transcripts'`; §Dependencies explicitly marks this parent-spec-gap dependency.
  - **F5 (High)** ACL feature naming — aligned to the established `<module>.view` + `<module>.configure` convention (verified against `packages/gateway-stripe/src/modules/gateway_stripe/acl.ts`); removed `transcription_zoom.webhook.receive` (no analogue exists; webhooks are signature-authenticated, not role-gated).
  - **F6 (Medium)** i18n namespace consistency — flow references `customers.integrations.zoom.*` replaced with `transcription_zoom.*`; added `transcription_zoom.connect.missing_scope` to the i18n inventory.
  - **F7 (Medium)** URL-validation UX — removed the two-step `?t=<tenantId>` admin-edit flow; §Webhook security briefly switched to a single-path tenant-scanning flow. *(Superseded later the same day by the F2 redesign below — tenant-scanning is not implementable. The resulting design uses a mandatory signed `?t=` token in the URL, copy-pasted once by the admin.)*
  - **F8 (Medium)** `verifiedAt` lifecycle — §Authentication & credentials explicitly lists the events that update `verifiedAt` and the ones that don't.
  - **F9 (Medium)** Test gap — TC-ZOOM-001b added for the multi-tenant handshake scan path + rate-limit enforcement. *(Superseded by the F2 redesign below; TC-ZOOM-001b removed when scan was removed. Signed-token validation is covered by the new TC-ZOOM-001.)*
  - **F10 (Medium)** Vault uniqueness — added `(account_id, tenantId)` UNIQUE rule (NOT `account_id` alone) to §Authentication & credentials.
  - **F11 (Low)** `connectedBy` UI resolution — §UI integrations card now notes the join-to-users step + deleted-user fallback.
  - **F12 (Low)** `cli.ts ping` — documented in the file tree.
  - **F13 (Low)** `providerMetadata.anonymousParticipantCount` coupling — §`providerMetadata` now explicitly marks the key as Zoom-private and documents the UI's provider-scoped gating.
  - **F14 (Low)** Release notes — covered by parent spec; a one-line addition will be made when the adapter merges (not a spec-level change).
  - **Self-grep sweep** confirmed no stale references to the old table/entity names, the old ACL keys, or the old flat package structure. Status remains **Proposed** (revised once).
- **2026-04-22** — Cross-spec review `ANALYSIS-2026-04-22-transcription-provider-specs.md` findings #2 + #3 applied:
  - **F2 (Critical)** URL-validation "scan and match" flow is not implementable (server can only send one response; no oracle). Redesigned: webhook URL now carries a **signed tenant token** `?t=base64url(tenantId).hex(HMAC-SHA256(tenantId, OM_INTERNAL_WEBHOOK_KEY))`. Handshake and real events both resolve tenant deterministically from the token; no scanning, no caching, no rate-limit gymnastics. The previously-proposed `?t=` shortcut is restored and made mandatory (rather than admin-optional) in the form of a single copy-paste URL.
  - **F3 (High)** `(accountId, tenantId)` uniqueness vs webhook routing — resolved for free by F2's redesign. URL decides the tenant; `payload.account_id` is a consistency check (reject with 409 on mismatch). "Fan-out" language removed throughout.
  - §Webhook security rewritten: §Tenant routing block replaces scan-based flow with signed-token flow; §Ingestion webhook steps rewritten (reads `?t=` first, loads vault, verifies HMAC); §Authentication & credentials mentions token generation during connect; §Risks updated (new entries: `OM_INTERNAL_WEBHOOK_KEY` leak, token replay, account_id mismatch).
  - Tests renumbered. New TC-ZOOM-001..004 cover signed-token validation, deterministic URL-validation, HMAC signature verification, account-id consistency check. Old TC-ZOOM-001b (lazy-scan rate-limit) removed. Total tests 19 (was 18). Phase references updated.
  - Status remains **Proposed** (revised twice).
- **2026-04-22** — Readability cleanup pass (spec-writing skill review, findings M1 + M2):
  - **M1** — TLDR bullet on webhook tenant resolution was stale (said `payload.account_id` → vault lookup) after the F2/F3 redesign moved resolution to the signed tenant token in the URL. Rewrote to cite the signed token as primary; `account_id` as defense-in-depth cross-check.
  - **M2** — removed the `*(Proxy lesson 2026-04-22, "fail loud on detectable hard gates".)*` attribution from the plan-gate TLDR bullet. Kept the principle ("fail loud on detectable hard gates") inline. Future readers arriving from a PR would not know what "proxy lesson" referred to.
- **2026-04-22** — Adopted parent spec's module-boundary redesign (PR #1645 feedback). Concrete changes:
  - Webhook intake retargeted from provider-owned auto-discovered route (`POST /api/webhooks/transcription/zoom`) to the shared `@open-mercato/webhooks` inbound pipeline via a `WebhookEndpointAdapter` implementation registered through `registerWebhookEndpointAdapter`. The URL the admin pastes into Zoom becomes `https://<om-host>/api/webhooks/inbound/zoom?t=<signedTenantToken>`. Signature verification, replay window, URL-validation handshake, and tenant resolution all moved into the adapter's `verifyWebhook` method; downstream processing happens in `processInbound`. Raw-body preservation, rate limiting, and dedup are now inherited from the shared pipeline.
  - Provider registry moved from the retired `callTranscriptProviders` DI multi-provider token to the module-level `registerCallTranscriptProvider` registry (matches the verified `registerGatewayAdapter` / `registerDataSyncAdapter` pattern). Provider contract re-exported from `@open-mercato/shared/modules/call_transcripts/provider`.
  - Event namespace change: all references to `customers.call_transcript.*` events updated to `call_transcripts.transcript.*`. The ingest target command renamed from `customers.call_transcripts.ingest` to `call_transcripts.ingest` (owned by the new transcript module).
  - §Files to create: retired the `api/POST/webhooks/transcription/zoom.ts` route file; added `webhook-adapter.ts` at the module root.
  - §Backward Compatibility, §Integration Test Coverage, §Implementation Phases updated to reflect the new wiring.
  - Status remains **Proposed** (revised).
- **2026-04-22** — Follow-up review `ANALYSIS-2026-04-22-crm-call-transcriptions-review.md` applied (Zoom-relevant finding #4):
  - URL-validation handshake path corrected: the earlier draft claimed `verifyWebhook` could return a "synthetic envelope" and the shared route would pass it through as `{ plainToken, encryptedToken }`. Verified against `packages/webhooks/.../route.ts:54-106` and `.../subscribers/inbound-process.ts`: the shared route persists a receipt, emits `webhooks.inbound.received`, and returns a fixed JSON ack. `processInbound` runs asynchronously in a subscriber — there is no way for a subscriber result to reach the HTTP response body, and Zoom's handshake requires synchronous `{ plainToken, encryptedToken }` within 3 seconds.
  - §Ingestion rewritten to consume a NEW `adapter.handleHandshake(input) → Promise<null | { status, headers?, body }>` hook — an additive extension to `WebhookEndpointAdapter` introduced by the parent spec §Proposed Solution.3. The shared route calls `handleHandshake` BEFORE `verifyWebhook` and, when it returns non-null, bypasses the standard persist/emit/subscriber path and responds with the returned body. Zoom's adapter implements `handleHandshake` to detect `endpoint.url_validation`, compute the encrypted token, and return `{ status: 200, body: { plainToken, encryptedToken } }` synchronously. All other events get `null`, falling through to the standard `verifyWebhook → persist → emit → processInbound` flow. `verifyWebhook` no longer carries URL-validation short-circuit logic.
  - §Implementation Phases Phase 2 gained a **Prerequisite (blocker)** note: the `handleHandshake` hook must land in `packages/webhooks` BEFORE Phase 2 of this sub-spec starts. Includes a shared-route test asserting non-null `handleHandshake` bypasses receipt/emit. Size: ~1 atomic commit in `packages/webhooks`.
  - §API Contracts "Webhook intake" response table clarified: `endpoint.url_validation` response is produced by `handleHandshake` (synchronous short-circuit); real-event response is the shared pipeline's default `{ ok: true }` ack; Phase 2 dependency flagged inline.
  - Status remains **Proposed** (revised).
