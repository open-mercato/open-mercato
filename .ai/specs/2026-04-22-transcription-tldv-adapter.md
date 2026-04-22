# Transcription Provider Adapter — tl;dv

| Field | Value |
|---|---|
| **Date** | 2026-04-22 |
| **Status** | Draft — Proposed |
| **Author** | Maciej Gren (with om-superpowers + Claude) |
| **Scope** | OSS |
| **Module(s)** | new `packages/transcription-tldv` |
| **Parent spec** | `.ai/specs/2026-04-21-crm-call-transcriptions.md` (CRM Call Transcriptions) |
| **Implements** | `CallTranscriptProvider<TldvCredentials>` from `packages/shared/src/modules/customers/transcription.ts` |
| **Depends on** | Parent spec must ship first; this adapter is provider #2 (Zoom is provider #1). |

---

## TLDR

- Implement `CallTranscriptProvider` for tl;dv as a separate npm workspace package `packages/transcription-tldv`.
- Auth: per-user `x-api-key` against `https://pasta.tldv.io/v1alpha1`. Stored in a **provider-owned encrypted table** `transcription_tldv_user_credentials` — SPEC-045's `IntegrationScope` is tenant-scoped only, so per-user secrets cannot live in the shared vault. The shared vault holds only a tenant-level enablement marker (`TldvVaultConfig { enabled: true }`).
- Triggers: (a) `TranscriptReady` webhook (primary) signed via a **shared-secret-in-custom-header** scheme (tl;dv has no native HMAC), (b) scheduled polling against `GET /meetings?since=lastPolledAt` per connected user.
- Two-call ingest: every TranscriptResult requires `GET /meetings/{id}/transcript` AND `GET /meetings/{id}` (segments come from the first endpoint, metadata from the second).
- **Critical limitation, verified live (2026-04-22)**: tl;dv's `invitees[]` is empty on both list and detail endpoints in the current data shape. Email-deterministic matching is reduced to **the organizer only**. Other speakers appear in transcript segments by display name, no email — they are NOT linkable to CRM People in v1. Documented as an explicit constraint with a v2 calendar-enrichment escape hatch.
- Webhook signing is weaker than Zoom's HMAC-SHA256: shared secret in a custom header that the user configures in the tl;dv UI. Acceptable given TLS, documented in security posture.
- Pricing/access caveat: tl;dv help center says "API + webhooks are Business-only" but live testing on a Pro plan returned HTTP 200 on every endpoint we exercise. Adapter ships assuming Pro suffices today; if tl;dv enforces the gate later, error handling already covers 401/403.

---

## Relationship to parent spec

This sub-spec is **purely additive** to the parent. It does NOT change:

- The `CallTranscriptProvider` contract.
- The customers module's ingest API (`POST /api/customers/call-transcripts/ingest`), routing algorithm, junction entity, unmatched-inbox flow, retroactive matching, or any UI surface.
- ACL features, encryption maps, or events declared by the parent.

It does add:

- A new workspace package `packages/transcription-tldv` (npm workspace, OSS).
- Provider-package-local ACL features (`transcription_tldv.view`, `transcription_tldv.configure`) — aligned to the OM provider-package convention (verified against `packages/gateway-stripe/src/modules/gateway_stripe/acl.ts`).
- A provider-package-local webhook intake route at `src/modules/transcription_tldv/api/POST/webhooks/transcription/tldv.ts`, materialized by OM's auto-discovery as `POST /api/webhooks/transcription/tldv`.
- Provider-package-local entry in the integrations marketplace registry (SPEC-045) declaring `hub: 'call_transcripts'` (hub introduced by the parent spec).
- A documented routing limitation flag on TranscriptResults the adapter produces.

If the parent spec is unimplemented when this sub-spec is picked up, this work blocks until the parent's Phase 1 (data model + contract) lands.

---

## Provider profile — what the live API actually returns

Verified by direct curl on 2026-04-22 against `https://pasta.tldv.io/v1alpha1` with a Pro-plan user key.

### Endpoints

| Method | Path | Purpose | Verified shape |
|---|---|---|---|
| GET | `/meetings?page=&pageSize=` | Polling fallback | `{ page, pageSize, pages, total, results: [...] }`. `pageSize=50` on the live response despite request param. Each result: `id`, `name`, `happenedAt` (string in `Tue Apr 21 2026 07:31:21 GMT+0000 (Coordinated Universal Time)` format — **non-ISO**), `duration` (seconds, float), `organizer{name, email}`, `invitees[]` (empty observed), `url`, `extraProperties`. |
| GET | `/meetings/{id}` | Meeting metadata enrichment | Same fields as a list result but `happenedAt` returns ISO-8601 (`2026-04-21T07:31:21.424Z`) — **format differs from the list endpoint**. Includes `template{id,label}`. |
| GET | `/meetings/{id}/transcript` | Transcript segments | `{ id, meetingId, data: [...] }`. Each segment: `startTime` (sec, float), `endTime`, `speaker` (display name string — **no email**), `text`. ~83-min meeting returned 293 segments / ~81 KB. |

### Webhook events

| Event | Trigger | Payload |
|---|---|---|
| `TranscriptReady` | Transcript becomes available after meeting completion | `{ id, event: 'TranscriptReady', data: { id, meetingId, data: [...segments...] }, executedAt }` — segments inline. Does NOT include organizer/title/url; the adapter still needs a metadata-enrich call. |

### Auth

- Header: `x-api-key: <key>`
- Keys obtained per user from `https://tldv.io/app/settings/personal-settings/api-keys`.
- One key = one user. A tenant with N users on tl;dv has N keys.

### Documented vs observed plan gating

| Source | Claim | Observed |
|---|---|---|
| `https://intercom.help/tldv/en/articles/11583137-api-and-webhooks` | "API + webhooks are Business-plan only" | Pro key returned HTTP 200 on `/meetings`, `/meetings/{id}`, `/meetings/{id}/transcript` |

The adapter assumes Pro is sufficient until tl;dv enforces the gate. Adapter logs and surfaces 401/403 with a "plan upgrade required" message in the integrations admin UI when the API rejects the key.

### What's NOT documented or available

- **HMAC webhook signing** — not supported. Workaround in §Webhook security.
- **Rate limits** — not published. Adapter self-throttles.
- **Cursor pagination** — page-based only.
- **OpenAPI spec URL** — referenced but not linked. Adapter is built from the HTML reference at `https://doc.tldv.io/index.html`.
- **Full participant attendee list** — `invitees[]` is empty on the meetings the adapter was tested against. May populate for calendar-linked meetings — confirmed in §Routing limitations below.

---

## Architecture

```
 tl;dv user's account
        │
        │ TranscriptReady webhook
        │ (shared-secret in custom header)
        ▼
 ┌──────────────────────────────────────────────────────────────────────┐
 │ packages/transcription-tldv                                           │
 │                                                                       │
 │  POST /api/webhooks/transcription/tldv                                │
 │    1. Read X-OM-Webhook-Secret header                                 │
 │    2. Look up TldvUserCredentials WHERE                               │
 │         webhook_secret_fingerprint = sha256Hex(header)                │
 │       → resolves (user, tenant, organization) in one indexed row read │
 │    3. findOneWithDecryption → decrypt secret + constant-time compare  │
 │    4. Read inline TranscriptReady payload                             │
 │    5. Call GET /meetings/{id} for organizer/title/url/duration/etc.   │
 │    6. Build normalized TranscriptResult                               │
 │    7. POST to internal customers ingest API                           │
 │                                                                       │
 │  workers/poll-tldv.ts (scheduled)                                     │
 │    For each connected (user, tenant) pair:                            │
 │      - Page through GET /meetings?page=, filter by happenedAt > since │
 │      - For each new meeting: GET /meetings/{id}/transcript            │
 │      - Build TranscriptResult, submit                                 │
 │      - Persist lastPolledAt                                           │
 │                                                                       │
 │  TranscriptionProvider implementation:                                │
 │    fetchTranscript(meetingId, ctx):                                   │
 │      [transcript, meeting] := Promise.all([                           │
 │        GET /meetings/{id}/transcript,                                 │
 │        GET /meetings/{id}                                             │
 │      ])                                                               │
 │      return normalize(transcript, meeting)                            │
 │    listRecentRecordings(ctx, since):                                  │
 │      yield* paginated GET /meetings filtered by happenedAt > since    │
 │                                                                       │
 │  Self-throttling: 1 req/sec per user, exponential backoff on 429/5xx  │
 └──────────────────────────────────────────────────────────────────────┘
        │
        │ POST /api/customers/call-transcripts/ingest (parent spec API)
        ▼
 ┌──────────────────────────────────────────────────────────────────────┐
 │ packages/core/src/modules/customers — INGEST PIPELINE (parent spec)  │
 │  Routing algorithm runs unchanged.                                    │
 │  For tl;dv-sourced TranscriptResults: typically 1 matched participant │
 │  (the organizer); transcript segments preserve speaker display names  │
 │  in storage_metadata.transcription.segments for UI passthrough.       │
 └──────────────────────────────────────────────────────────────────────┘
```

---

## Authentication & credentials

**(Redesigned per ANALYSIS 2026-04-22-transcription-provider-specs.md finding #1: the SPEC-045 integrations vault — verified in `packages/shared/src/modules/integrations/types.ts` and `packages/core/src/modules/integrations/data/entities.ts` — is tenant-scoped only. `IntegrationScope = { organizationId, tenantId }`; the `integration_credentials` table is keyed on `(integration_id, organization_id, tenant_id)` with no `user_id` dimension. tl;dv's per-user credential model cannot use the vault as-is. Extending the integrations module to add a `user_id` scope is upstream work with a large blast radius; this spec instead keeps the vault tenant-scoped — storing only the tenant-level enablement marker — and owns a dedicated per-user credentials table inside the provider package.)**

### Tenant-level vault entry (SPEC-045 integrations module)

One row per tenant, written the first time any user connects tl;dv in that tenant; removed when the last user disconnects.

```ts
// shape stored in IntegrationCredentials.credentials (vault)
// scope: (integrationId='transcription_tldv', organizationId, tenantId)
export type TldvVaultConfig = {
  enabled: true                  // presence = tenant-level enablement
  defaultPollIntervalMinutes?: number
}
```

No sensitive fields live in the vault. Credentials live in the per-user table below.

### Per-user credentials table (provider-owned)

Entity `TldvUserCredentials`, table `transcription_tldv_user_credentials`, plural per the root `AGENTS.md` convention. One row per (tenantId, userId) pair.

```ts
// packages/transcription-tldv/src/modules/transcription_tldv/data/entities.ts
@Entity({ tableName: 'transcription_tldv_user_credentials' })
@Unique({ name: 'tldv_user_credentials_tenant_user_unique', properties: ['tenantId', 'userId'] })
@Unique({ name: 'tldv_user_credentials_secret_fingerprint_unique', properties: ['webhookSecretFingerprint'] })
@Index({ name: 'tldv_user_credentials_org_idx', properties: ['organizationId', 'tenantId'] })
export class TldvUserCredentials {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' }) id!: string
  @Property({ name: 'user_id', type: 'uuid' }) userId!: string
  @Property({ name: 'organization_id', type: 'uuid' }) organizationId!: string
  @Property({ name: 'tenant_id', type: 'uuid' }) tenantId!: string
  @Property({ name: 'api_key', type: 'text' }) apiKey!: string                    // encrypted at rest (see Encryption)
  @Property({ name: 'webhook_secret', type: 'text' }) webhookSecret!: string      // encrypted at rest
  @Property({ name: 'webhook_secret_fingerprint', type: 'text' }) webhookSecretFingerprint!: string  // SHA-256 hex of the webhook secret; globally unique; used for tenant/user resolution on incoming webhooks
  @Property({ name: 'tldv_user_email', type: 'text', nullable: true }) tldvUserEmail?: string | null
  @Property({ name: 'verified_at', type: Date }) verifiedAt!: Date
  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() }) createdAt: Date = new Date()
  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() }) updatedAt: Date = new Date()
}
```

Index rationale (aligned with the webhook-handler lookup shape):
- **`UNIQUE (webhook_secret_fingerprint)`** — the webhook handler has no tenant/org context at receive time; the fingerprint is the *primary* lookup key. A globally-unique SHA-256 of a 256-bit random secret collides with negligible probability; declaring the column UNIQUE both enforces this and gives the planner a single-row index scan.
- **`UNIQUE (tenant_id, user_id)`** — enforces "one tl;dv connection per (tenant, user)" for connect/rotate/disconnect flows and tenant-scoped admin queries ("who has tl;dv connected in this tenant?").
- **Composite index `(organization_id, tenant_id)`** — supports the polling worker's per-tenant iteration.

The plaintext `apiKey` / `webhookSecret` columns store ciphertext (see §Encryption); the fingerprint is plain text (one-way SHA-256 of a high-entropy secret — collision-resistant and gives away nothing about the plaintext).

Credentials schema:

```ts
// packages/transcription-tldv/src/modules/transcription_tldv/credentials.ts
export const tldvUserCredentialsSchema = z.object({
  apiKey: z.string().min(20),
  webhookSecret: z.string().min(32),
  userId: z.string().uuid(),
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
  tldvUserEmail: z.string().email().nullable().optional(),
})
export type TldvUserCredentialsInput = z.infer<typeof tldvUserCredentialsSchema>
```

### Encryption

`packages/transcription-tldv/src/modules/transcription_tldv/encryption.ts` — new file, registers encryption for the credentials table:

```ts
import type { ModuleEncryptionMap } from '@open-mercato/shared/modules/encryption'

export const defaultEncryptionMaps: ModuleEncryptionMap[] = [
  {
    entityId: 'transcription_tldv:tldv_user_credentials',
    fields: [{ field: 'api_key' }, { field: 'webhook_secret' }],
  },
]

export default defaultEncryptionMaps
```

All reads that materialize `apiKey` / `webhookSecret` MUST use `findWithDecryption` / `findOneWithDecryption` from `@open-mercato/shared/lib/encryption/find` per `packages/shared/AGENTS.md`. The `webhookSecretFingerprint` is written alongside during the command that creates/updates the row — SHA-256 of the plaintext, computed BEFORE encryption.

### Connect flow (in the integrations marketplace)

1. User in OM clicks "Connect tl;dv" on the integrations marketplace card at `/backend/integrations` (the card is a single shared surface; since tl;dv is per-user, the card shows the current user's connection status plus a list of other users in the tenant who have already connected — view-only unless the viewer has `transcription_tldv.configure`). There is no separate "personal integrations page" route in v1.
2. OM presents a form with one field: **"tl;dv API key"** + a help link to `https://tldv.io/app/settings/personal-settings/api-keys`.
3. On submit, the connect route:
   - Calls `GET /v1alpha1/meetings?pageSize=1` with the key to validate it.
   - On 200: captures the organizer email of the first meeting (if any) as `tldvUserEmail`; generates a 32-byte cryptographically random `webhookSecret`; computes `webhookSecretFingerprint = sha256Hex(webhookSecret)`.
   - Upserts the vault's `TldvVaultConfig` at `(tenant, organization)` with `enabled: true` (idempotent).
   - Inserts the `TldvUserCredentials` row, UNIQUE on `(tenantId, userId)`. If a row already exists for this (tenant, user), the route rotates the secret and updates the API key.
4. Shows the user the one-time setup page:
   - Webhook URL: `https://<om-host>/api/webhooks/transcription/tldv` (NO `?u=...` — see §Webhook security for the tenant/user resolution flow).
   - Event: `TranscriptReady`.
   - Custom header to add: `X-OM-Webhook-Secret: <generated secret>`.
   - Step-by-step screenshot of tl;dv's webhook configuration UI.
5. Credentials are now active for that user only; they do NOT grant any other user in the tenant access to this person's tl;dv meetings.

### Disconnect flow

`DELETE /api/integrations/transcription-tldv/disconnect` removes the per-user credentials row. If that was the last user in the tenant, the vault's `TldvVaultConfig` row is also removed. Ingested CRM data is preserved.

### Polling-only fallback

If the user is in an environment that can't expose a public webhook endpoint (e.g. self-hosted OM behind a firewall), they skip the webhook step. The per-user polling worker handles ingestion alone with an effective lag of ~1 polling interval (default 15 minutes per tl;dv user — see `pollIntervalMinutes` on the vault config).

---

## Ingestion

### Webhook path (primary)

Route: `POST /api/webhooks/transcription/tldv`, materialized by OM's auto-discovery from the file `packages/transcription-tldv/src/modules/transcription_tldv/api/POST/webhooks/transcription/tldv.ts`. The adapter does NOT use `registerWebhookHandler` from `@open-mercato/shared/modules/payment_gateways/types` — that export is payment-gateway-scoped and takes a `VerifyWebhookInput` shape that doesn't fit the transcription pipeline's signed-body-pull-fetch pattern (per the parent spec's §Proposed Solution.2 webhook registration convention).

Steps:

1. Read `X-OM-Webhook-Secret` header (presence required; absent → 401).
2. Resolve `(tenantId, userId, organizationId)` by looking up `TldvUserCredentials` where `webhookSecretFingerprint = sha256Hex(<received-header-value>)`. The `webhook_secret_fingerprint` column has a **global UNIQUE** constraint (no tenant qualifier) — one indexed row read, zero scans. Missing → 401 (no such credential).
3. Load the matching row via `findOneWithDecryption` scoped to the resolved `(organizationId, tenantId)`; constant-time-compare the decrypted `webhookSecret` against the received header as a defense-in-depth check (the fingerprint match alone is already cryptographically sufficient given a 32-byte high-entropy secret; the re-compare guards against a theoretical SHA-256 collision).
4. Validate request body against tl;dv's webhook payload schema.
5. Build `ProviderCtx<TldvCredentials>` from the resolved (user, tenant, organization) + decrypted `apiKey`.
6. Call `provider.fetchTranscript(payload.data.meetingId, ctx)` — internally:
   - Reuse the inline transcript segments from the webhook payload (skip the `/transcript` API call — saves one round-trip).
   - `GET /meetings/{id}` for metadata enrichment.
   - Compose `TranscriptResult`.
7. Submit `TranscriptResult` to `POST /api/customers/call-transcripts/ingest` (parent spec).
8. Return 200 to tl;dv with `{ status: 'received' }` regardless of downstream ingest success — the parent's ingest is idempotent and we don't want tl;dv retrying on transient OM issues.

Failure handling: any verification failure returns 401 (tl;dv treats this as a webhook configuration error and surfaces it in their UI). Any internal error after verification returns 500 and lets tl;dv retry per their webhook policy.

**Why no `?u=<signedToken>` in the URL**: the webhook secret is high-entropy (32 bytes) and unique per (tenant, user); its fingerprint serves as the tenant/user identifier without a URL query parameter. This keeps the URL uniform across all users and removes the need for the admin (or the user) to construct a user-specific URL. An attacker would need to brute-force a 256-bit secret to forge the fingerprint — practically impossible.

### Polling fallback

Worker: `packages/transcription-tldv/src/workers/poll-tldv.ts`
- Queue: `transcription-poll-tldv`
- Concurrency: 1 per (user, tenant) pair (per OM queue contract).
- Trigger: cron every `pollIntervalMinutes` minutes (default 15, configurable per provider package).
- For each connected user:
  1. Fetch `lastPolledAt` from a small per-user state row (table `transcription_tldv_poll_cursors(user_id, tenant_id, last_polled_at)`).
  2. Page through `GET /meetings?page=N&pageSize=50` until `happenedAt < lastPolledAt`.
  3. For each new meeting:
     - Skip if its `id` is already known to OM (idempotency check via parent's existing `(sourceProvider, sourceRecordingId)` query-index lookup).
     - Call `provider.fetchTranscript(meeting.id, ctx)` — this does both the `/transcript` and `/meetings/{id}` calls.
     - Submit to ingest API.
  4. Update `lastPolledAt` to `now()` only after the page is fully processed.
- Self-throttling: 1 req/sec per user; exponential backoff (250ms → 4s) on 429/5xx, max 5 retries per call.

### Manual reingest

Reuses the parent spec's `POST /api/customers/interactions/:id/reingest-transcript` route. The route resolves `sourceProvider='tldv'` from the interaction's custom fields, then calls our `provider.fetchTranscript` with the existing `sourceRecordingId`.

---

## Webhook security (no HMAC)

tl;dv does not provide HMAC signing on outbound webhooks. Their webhook UI does support **a custom HTTP header** that gets sent verbatim with every POST — this is the carry channel for our shared secret.

### Mitigations applied

1. **Per-user, high-entropy secret** (256 bits, base64-encoded). Stored encrypted at rest in the provider-owned `transcription_tldv_user_credentials` table. Never stored in the shared integrations vault.
2. **Constant-time comparison** of the received header against the decrypted secret (`crypto.timingSafeEqual`).
3. **Fingerprint-indexed lookup** (`webhookSecretFingerprint = sha256Hex(webhookSecret)`, plain-text column, indexed). The webhook handler resolves the (tenant, user) pair by querying this column — one indexed row read, no scan, no URL query parameter, no admin URL construction. The secret's 256-bit entropy makes fingerprint collisions cryptographically negligible.
4. **TLS required** — webhook URL must be HTTPS; HTTP is rejected.
5. **Rotation** — if a leak is suspected, the user regenerates the secret in OM (vault update) and updates the header value in tl;dv. Rotation MUST be exposed as a one-click action in the integrations admin UI.

### Documented residual risk

Lower assurance than Zoom's HMAC-over-body: a passive eavesdropper on a TLS-broken path could replay the header. Acceptable for a meeting-transcript ingest channel with idempotency on `(sourceProvider, sourceRecordingId)` (replays are no-ops). NOT acceptable for any future mutation-capable provider event — but tl;dv's surface doesn't include those.

---

## Routing limitations specific to tl;dv

Confirmed by live API test (2026-04-22) on a Pro-plan account.

### What we get

- **Organizer email** — always present in `meeting.organizer.email`. Always one deterministically-matchable participant.
- **Organizer display name** — always present.
- **Speaker display names from transcript segments** — present, but no email association.

### What we DON'T get

- **Non-organizer participant emails.** `meeting.invitees[]` was empty on every meeting in the live test sample. May populate for calendar-linked meetings (i.e. the meeting was created from a Google Calendar / Outlook event with explicit invitees) — this needs to be confirmed at implementation time on at least one calendar-linked meeting before the adapter ships.

### Adapter behavior

The adapter produces a `TranscriptResult.participants` list with the following composition:

```ts
participants: [
  { email: meeting.organizer.email, displayName: meeting.organizer.name, role: 'host' },
  ...meeting.invitees.map(i => ({ email: i.email, displayName: i.name, role: 'participant' })),
  // Speakers without invitee match are NOT added — they have no email and would
  // violate the parent spec's CHECK constraint (email IS NOT NULL OR phone IS NOT NULL).
]
```

Speaker display names from transcript segments are preserved in `TranscriptResult.segments` for UI display. They are NOT promoted into `participants[]` because:
- We have no email/phone for them, violating the parent's CHECK constraint.
- A display-name-only match against CRM People would be fuzzy, violating Mat's lesson "email is the deterministic participation key" (`apps/mercato/app-spec/proxy-lessons.md`, lesson dated 2026-04-22).

### Practical impact

For a typical sales call recorded via tl;dv with 1 organizer (the salesperson) and 2 external prospects who are NOT in the meeting's invitee list, the adapter creates ONE `CustomerInteractionParticipant` row (the salesperson). The two prospects' words appear in the transcript text by display name only, are visible in the UI's segments view, but do NOT appear on any CRM Person's timeline.

This is a meaningful regression vs Zoom and is documented in:
- The integrations marketplace UI ("This adapter routes by organizer email only — for full attendee matching, use Zoom or wait for the Calendar enrichment v2 adapter.")
- `<CallTranscriptCard>` for tl;dv-sourced calls — a small badge "Organizer-matched only" hovering over the participants strip when `sourceProvider='tldv'`.

### Optional v2 enhancement (separate spec)

A separate "calendar enrichment" adapter could call Google Calendar / Microsoft Graph using `meeting.extraProperties.conferenceId` (which appears to be a Meet code) to look up the original calendar event's attendees and post-enrich the participants junction. Out of scope for this sub-spec.

---

## Data Models (delta from parent)

### Two new provider-owned tables

- `transcription_tldv_user_credentials` — per-user API key + webhook secret (declared in §Authentication & credentials above). The adapter's source of truth for "who has tl;dv connected in this tenant".
- `transcription_tldv_poll_cursors` — per-user polling cursor (below).

Both table names are plural per the root `AGENTS.md` convention.

### Polling cursor table

Entity `TldvPollCursor` → table `transcription_tldv_poll_cursors`.

```ts
// packages/transcription-tldv/src/modules/transcription_tldv/data/entities.ts
@Entity({ tableName: 'transcription_tldv_poll_cursors' })
@Unique({ name: 'tldv_poll_cursor_user_unique', properties: ['userId', 'tenantId'] })
@Index({ name: 'tldv_poll_cursor_org_idx', properties: ['organizationId', 'tenantId'] })
export class TldvPollCursor {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' }) id!: string
  @Property({ name: 'user_id', type: 'uuid' }) userId!: string
  @Property({ name: 'organization_id', type: 'uuid' }) organizationId!: string
  @Property({ name: 'tenant_id', type: 'uuid' }) tenantId!: string
  @Property({ name: 'last_polled_at', type: Date, nullable: true }) lastPolledAt?: Date | null
  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() }) createdAt: Date = new Date()
  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() }) updatedAt: Date = new Date()
}
```

### Date normalization helper

`/meetings` returns a non-ISO string (`Tue Apr 21 2026 07:31:21 GMT+0000 (Coordinated Universal Time)`); `/meetings/{id}` returns ISO-8601 (`2026-04-21T07:31:21.424Z`). Adapter's `normalizeDate(value: string | Date): Date` accepts both; unit-tested against fixtures from the live API.

### No changes to parent's data model

No new entities in the customers module. No changes to `CustomerInteractionParticipant`, `CustomerUnmatchedTranscript`, encryption maps, or the customer_interaction custom fields.

---

## Provider implementation

```ts
// packages/transcription-tldv/src/provider.ts
import type {
  CallTranscriptProvider,
  ProviderCtx,
  TranscriptResult,
  RecordingSummary,
} from '@open-mercato/shared/modules/customers/transcription'
import type { TldvCredentials } from './credentials'

const BASE_URL = 'https://pasta.tldv.io/v1alpha1'

export class TldvCallTranscriptProvider implements CallTranscriptProvider<TldvCredentials> {
  id = 'tldv'
  label = 'tl;dv'
  viewLabel = 'Open in tl;dv'
  pollIntervalMinutes = 15

  async fetchTranscript(meetingId: string, ctx: ProviderCtx<TldvCredentials>): Promise<TranscriptResult> {
    const headers = { 'x-api-key': ctx.credentials.apiKey, 'content-type': 'application/json' }
    const [transcriptRes, meetingRes] = await Promise.all([
      this.request(`/meetings/${meetingId}/transcript`, headers, ctx),
      this.request(`/meetings/${meetingId}`, headers, ctx),
    ])
    return this.normalize(transcriptRes, meetingRes)
  }

  async *listRecentRecordings(ctx: ProviderCtx<TldvCredentials>, since: Date): AsyncIterable<RecordingSummary> {
    const headers = { 'x-api-key': ctx.credentials.apiKey }
    let page = 1
    while (true) {
      const res = await this.request(`/meetings?page=${page}&pageSize=50`, headers, ctx)
      const results = res.results ?? []
      let stop = false
      for (const m of results) {
        const occurredAt = normalizeDate(m.happenedAt)
        if (occurredAt <= since) { stop = true; break }
        yield { externalRecordingId: m.id, occurredAt, title: m.name }
      }
      if (stop || page >= (res.pages ?? 1)) break
      page += 1
    }
  }

  private normalize(transcript: TldvTranscriptResponse, meeting: TldvMeetingResponse): TranscriptResult {
    const segments = (transcript.data ?? []).map((s) => ({
      speaker: s.speaker,
      startSec: s.startTime,
      endSec: s.endTime,
      text: s.text,
    }))
    const participants = [
      meeting.organizer?.email
        ? { email: meeting.organizer.email, displayName: meeting.organizer.name, role: 'host' as const }
        : null,
      ...(meeting.invitees ?? [])
        .filter((i) => !!i.email)
        .map((i) => ({ email: i.email, displayName: i.name, role: 'participant' as const })),
    ].filter(Boolean) as TranscriptResult['participants']

    const text = segments.map((s) => `${s.speaker ?? '—'}: ${s.text}`).join('\n')

    return {
      externalRecordingId: meeting.id,
      sourceMeetingUrl: meeting.url,
      occurredAt: normalizeDate(meeting.happenedAt),
      durationSec: Math.round(meeting.duration ?? 0),
      title: meeting.name,
      text,
      segments,
      participants,
      providerMetadata: {
        templateId: meeting.template?.id ?? null,
        conferenceId: meeting.extraProperties?.conferenceId ?? null,
        organizerOnlyMatched: (meeting.invitees ?? []).length === 0,
      },
    }
  }

  private async request(path: string, headers: Record<string, string>, ctx: ProviderCtx<TldvCredentials>) {
    const res = await throttledFetch(`${BASE_URL}${path}`, { headers })
    if (!res.ok) throw new TldvApiError(res.status, await res.text())
    return res.json()
  }
}
```

The adapter's local `TldvTranscriptResponse` and `TldvMeetingResponse` types are zod-validated at the API boundary so no `unknown` leaks past the provider class.

---

## Files to create

Follows the established provider-package layout (verified against `packages/gateway-stripe` and `packages/sync-akeneo`): a top-level kebab-case package containing a single snake-case module folder at `src/modules/<module_id>/` that OM's auto-discovery scans.

```
packages/transcription-tldv/
├── package.json
├── README.md
├── docs/setup-screenshots/
└── src/
    ├── index.ts                               // re-exports module bootstrap
    └── modules/
        └── transcription_tldv/
            ├── index.ts                       // module metadata
            ├── integration.ts                 // IntegrationDefinition (SPEC-045 marketplace entry; hub: 'call_transcripts')
            ├── provider.ts                    // TldvCallTranscriptProvider
            ├── credentials.ts                 // TldvCredentials + zod schema
            ├── acl.ts                         // transcription_tldv.view, .configure
            ├── setup.ts                       // defaultRoleFeatures, onTenantCreated
            ├── di.ts                          // registers provider on callTranscriptProviders
            ├── api/
            │   ├── schemas.ts                 // zod schemas (tl;dv REST + webhook payloads)
            │   ├── POST/
            │   │   ├── webhooks/
            │   │   │   └── transcription/
            │   │   │       └── tldv.ts        // auto-discovered → POST /api/webhooks/transcription/tldv
            │   │   └── integrations/
            │   │       └── transcription-tldv/
            │   │           ├── connect.ts
            │   │           └── rotate-secret.ts
            │   └── DELETE/
            │       └── integrations/
            │           └── transcription-tldv/
            │               └── disconnect.ts
            ├── encryption.ts                  // ModuleEncryptionMap for TldvUserCredentials.api_key + webhook_secret
            ├── data/
            │   └── entities.ts                // TldvUserCredentials, TldvPollCursor
            ├── workers/
            │   └── poll-tldv.ts
            ├── lib/
            │   ├── fingerprint.ts             // sha256Hex(webhookSecret) helper
            │   ├── normalize-date.ts
            │   └── throttled-fetch.ts
            ├── i18n/
            │   ├── en.json
            │   └── pl.json
            ├── migrations/                    // generated by yarn db:generate
            └── __integration__/
                ├── meta.ts
                └── TC-TLDV-001.spec.ts ... TC-TLDV-018.spec.ts (see Tests)
```

---

## API Contracts (delta from parent)

### Webhook intake (this package)

`POST /api/webhooks/transcription/tldv`
- **Auth**: `X-OM-Webhook-Secret` header. Handler computes `sha256Hex(header)` → looks up the matching `TldvUserCredentials` row by `webhookSecretFingerprint` → decrypts the stored secret → constant-time compares (defense-in-depth). Missing header / no matching fingerprint / compare mismatch → 401.
- **Body schema**: zod-validated against tl;dv's `TranscriptReady` payload. Rejects on schema mismatch with 400.
- **Response**: `200 { status: 'received' }` on accepted; `401` on signature failure; `400` on payload schema failure; `404` on unknown user token; `500` on internal error.
- **Idempotency**: handled downstream by the parent's ingest (idempotent on `(sourceProvider='tldv', sourceRecordingId=meetingId)`).

### Provider connect (this package)

`POST /api/integrations/transcription-tldv/connect`
- **Auth**: `requireAuth`, `requireFeatures: ['transcription_tldv.configure']`.
- **Body**: `{ apiKey: string }`.
- Validates the key by calling `GET /meetings?pageSize=1`; on success, generates `webhookSecret`, computes `webhookSecretFingerprint = sha256Hex(webhookSecret)`, upserts a `TldvUserCredentials` row for `(tenantId, userId)` with both secrets encrypted plus the fingerprint in plaintext, upserts the tenant-level vault config (`TldvVaultConfig { enabled: true }`) if absent, returns `{ webhookUrl, webhookSecret, setupInstructions }`.

`POST /api/integrations/transcription-tldv/rotate-secret`
- **Auth**: `requireAuth`, `requireFeatures: ['transcription_tldv.configure']`.
- Generates a new `webhookSecret`, stores it, returns the new secret + reminder to update tl;dv's webhook config.

`DELETE /api/integrations/transcription-tldv/disconnect`
- **Auth**: same.
- Removes the credential entry; preserves all already-ingested transcripts on the customers side.

All routes export `openApi`.

---

## Commands & Events (delta from parent)

No new events declared in the customers module. The adapter relies on the parent spec's events (`customers.call_transcript.ingested`, `.unmatched`, `.reingested`).

The adapter does NOT declare its own commands — connect/disconnect/rotate are direct API routes, not undoable commands (provider lifecycle, not domain mutations).

---

## UI & UX (delta from parent)

### Integrations marketplace card

A new card in `/backend/integrations` for "tl;dv (transcripts)" with:
- Status (Connected / Not Connected, with the user's `tldvUserEmail` shown when connected).
- "Connect tl;dv" button → opens the connect dialog (one field for API key; on submit, opens the webhook setup screen).
- "Rotate webhook secret" button (gated by `transcription_tldv.configure`).
- "Disconnect" button (gated, with a destructive confirm dialog using `useConfirmDialog()`).
- Status pill: green when last poll/webhook was recent, amber when stale, red on auth failure.

### Provider-specific UI hint on `<CallTranscriptCard>` (parent spec component)

When the parent's `<CallTranscriptCard>` renders an interaction with `sourceProvider='tldv'`, it displays a small inline note above the participants strip:
- *"Routed by organizer email only — tl;dv doesn't expose attendee emails for ad-hoc meetings. To match other participants, add them to CRM manually or use a calendar-linked meeting."* (translatable; key `customers.call_transcripts.tldv.organizer_only_notice`).

### Onboarding screenshots

`packages/transcription-tldv/docs/setup-screenshots/` includes step-by-step screenshots of:
1. Generating an API key in tl;dv settings.
2. Adding the webhook URL with the custom header in tl;dv's webhook config UI.

These render in the connect dialog as a `<CollapsibleSection title="Step-by-step">`.

---

## Internationalization

New i18n keys (in `packages/transcription-tldv/src/i18n/<locale>.json`):

```
transcription_tldv.connect.title
transcription_tldv.connect.api_key_label
transcription_tldv.connect.api_key_help
transcription_tldv.connect.api_key_invalid
transcription_tldv.connect.success
transcription_tldv.webhook.url_label
transcription_tldv.webhook.secret_label
transcription_tldv.webhook.setup_instructions
transcription_tldv.rotate.confirm
transcription_tldv.rotate.success
transcription_tldv.disconnect.confirm
transcription_tldv.disconnect.success
transcription_tldv.status.connected
transcription_tldv.status.disconnected
transcription_tldv.status.auth_failed
transcription_tldv.status.last_polled_at
```

Plus one parent-namespace addition (declared via the customers package, not this package): `customers.call_transcripts.tldv.organizer_only_notice` for the participants-strip hint.

Locales: `en` mandatory; `pl` shipped because the user is Polish-speaking and tl;dv has strong adoption in PL.

---

## Access Control

New ACL features (`packages/transcription-tldv/src/modules/transcription_tldv/acl.ts`), mirroring the established OM provider-package convention (verified against `packages/gateway-stripe/src/modules/gateway_stripe/acl.ts`: `<module>.view` + `<module>.configure`):

```ts
export const features = [
  { id: 'transcription_tldv.view',      title: 'View tl;dv transcription integration',      module: 'transcription_tldv' },
  { id: 'transcription_tldv.configure', title: 'Configure tl;dv transcription integration', module: 'transcription_tldv' },
]

export default features
```

Default role assignments (`setup.ts`, via `defaultRoleFeatures`):

| Feature | superadmin | admin | manager | employee |
|---|:-:|:-:|:-:|:-:|
| `transcription_tldv.view`      | ✓ | ✓ | ✓ | — |
| `transcription_tldv.configure` | ✓ | ✓ | — | — |

- `transcription_tldv.view` gates read-only access to the integrations card (status pill, last-activity metrics).
- `transcription_tldv.configure` gates `/connect`, `/rotate-secret`, `/disconnect`.

The webhook intake route is NOT gated by an ACL feature — it's public by URL and authenticated by the shared-secret header against the per-user credentials row (looked up via the secret fingerprint), per §Webhook security.

The transcript view side is governed by the parent spec's `customers.call_transcripts.view` — unchanged.

---

## Backward Compatibility

Reviewed against the 13 contract surfaces in `BACKWARD_COMPATIBILITY.md`. All changes are **additive**.

| # | Surface | This sub-spec's changes |
|---|---|---|
| 1 | Auto-discovery file conventions | New package follows existing conventions. |
| 2 | Type definitions & interfaces | Implements the parent's `CallTranscriptProvider` — no contract change. New local types are package-internal. |
| 3 | Function signatures | None changed. |
| 4 | Import paths | New: `@open-mercato/transcription-tldv`. Internal package; not consumed elsewhere. |
| 5 | Event IDs | None new. |
| 6 | Widget injection spot IDs | New integration-marketplace card uses an existing spot; no new spot ID. |
| 7 | API route URLs | New: `/api/webhooks/transcription/tldv`, `/api/integrations/transcription-tldv/{connect,rotate-secret,disconnect}`. |
| 8 | Database schema | Two new tables owned by this package: `transcription_tldv_user_credentials` (per-user API key + webhook secret; encrypted at rest via the provider's `ModuleEncryptionMap`) and `transcription_tldv_poll_cursors` (polling cursor). |
| 9 | DI service names | One new multi-provider registration on `callTranscriptProviders`. |
| 10 | ACL feature IDs | 2 new in `transcription_tldv.*`. |
| 11 | Notification type IDs | None new. |
| 12 | CLI commands | None in v1. (Optional follow-up: `yarn mercato transcription-tldv reconnect <userId>`.) |
| 13 | Generated file contracts | None changed. |

---

## Risks & Impact Review

| Risk | Severity | Affected area | Mitigation | Residual |
|---|---|---|---|---|
| tl;dv enforces "Business-only" gate retroactively, breaking Pro-tier ingest | Medium | Reliability | Connect flow validates the key at connect time; polling worker surfaces 401/403 to the integrations admin UI with a "plan upgrade required" message. Tenants see the failure within one polling interval. | Low |
| Weaker webhook signing (no HMAC) leaves a replay window for a TLS MITM | Medium | Security | Per-user 256-bit secret; fingerprint-indexed lookup; constant-time compare; idempotency on downstream ingest makes replay a no-op. | Low (replays are no-ops; no mutation surface) |
| `invitees: []` regression silently misroutes calls (organizer-matched only) | High | Data quality / UX | UI hint on `<CallTranscriptCard>` for tl;dv-sourced calls explicitly tells the user; integrations card mentions the limitation. v2 calendar-enrichment is the long-term fix. | Medium — users on tl;dv get partial matching by design. |
| Inconsistent date format between `/meetings` and `/meetings/{id}` | Low | Reliability | `normalizeDate` helper covers both formats; unit tests cover both fixtures. | Low |
| API key leaked through logs or chat | Medium | Security | `apiKey` encrypted at rest in `transcription_tldv_user_credentials.api_key` via the provider's `ModuleEncryptionMap`; reads only through `findOneWithDecryption`; logs redact via the standard OM redaction filter; rotate workflow exposed as one-click action. | Low if rotation discipline holds. |
| Polling worker overruns (one user with thousands of meetings on first connect) | Low | Performance | Pagination caps at 50/page; worker yields between requests (1 req/sec); `lastPolledAt` advances only after a page is fully processed so retries are safe. Initial backfill is bounded by the user's `lastPolledAt` default = `now() - 30 days`. | Low |
| Speaker display names colliding across participants (same name twice) | Low | Data quality | Speakers are display-only metadata in segments; not promoted to junction rows; collisions don't matter for routing. | Low |
| tl;dv unilaterally changes their webhook payload shape | Medium | Reliability | Webhook handler zod-validates and rejects on shape mismatch with structured logging; integrations card surfaces a "webhook decoded failed: schema mismatch" status; manual reingest is a fallback. | Low |

---

## Integration Test Coverage

All tests self-contained per `.ai/qa/AGENTS.md`. Mocks tl;dv API at the HTTP layer (using msw or similar); no calls to the real tl;dv service in CI.

| ID | Covers |
|---|---|
| TC-TLDV-001 | `provider.fetchTranscript`: Promise.all both endpoints; normalize succeeds; date normalization handles ISO + non-ISO. |
| TC-TLDV-002 | `provider.fetchTranscript`: organizer-only matching when `invitees: []`; participants array contains exactly one entry; `providerMetadata.organizerOnlyMatched=true`. |
| TC-TLDV-003 | `provider.fetchTranscript`: invitees populated; participants array contains organizer + invitees; `providerMetadata.organizerOnlyMatched=false`. |
| TC-TLDV-004 | `provider.listRecentRecordings`: pagination across multiple pages; stops when `happenedAt <= since`. |
| TC-TLDV-005 | Webhook handler: valid `X-OM-Webhook-Secret` → fingerprint lookup finds the row → decrypted compare passes → 200 + ingest call. |
| TC-TLDV-006 | Webhook handler: missing header → 401; header whose `sha256` doesn't match any row → 401; header whose fingerprint matches but whose decrypted value differs (forced via a manual DB tamper) → 401. |
| TC-TLDV-007 | Webhook handler: two users in one tenant each have their own row; a webhook with user A's secret dispatches to user A's ingest context, not user B's. |
| TC-TLDV-008 | Webhook handler: schema mismatch → 400 with structured error. |
| TC-TLDV-009 | Connect flow: invalid API key → 400; valid key → 200 + secret returned + `TldvUserCredentials` row persisted with encrypted fields + `verifiedAt` set + tenant-level `TldvVaultConfig` upserted with `enabled: true`. |
| TC-TLDV-010 | Polling worker: iterates `TldvUserCredentials` rows per tenant; respects `lastPolledAt` per user via `TldvPollCursor`; updates state only on full-page success; 1 req/sec throttling per user. |
| TC-TLDV-011 | Polling worker: skips meetings already ingested (idempotency check via parent's query index). |
| TC-TLDV-012 | Date normalizer: covers list-format and detail-format strings; round-trips Date → string → Date. |
| TC-TLDV-013 | End-to-end (mocked tl;dv API + real customers ingest API + real DB): webhook arrives → ingest API called → CustomerInteraction + Attachment + 1 participant created on the test tenant. |
| TC-TLDV-014 | End-to-end: organizer email matches an existing CRM Person → primary entity_id set correctly; participant junction populated with `matched_via='primary_email'`. |
| TC-TLDV-015 | End-to-end: organizer email matches no CRM Person → unmatched-transcript staging row created (parent's flow). |
| TC-TLDV-016 | Rotate-secret API: row's `webhookSecretFingerprint` updates atomically; the old secret stops working on next webhook within 1 second (fingerprint lookup misses). |
| TC-TLDV-017 | Disconnect API: `TldvUserCredentials` row deleted (or soft-deleted); subsequent webhook with old secret → 401 (fingerprint lookup misses). If the deleted row was the last one in the tenant, `TldvVaultConfig` is also removed. |
| TC-TLDV-018 | Encryption round-trip: write → read via `findOneWithDecryption` returns the original plaintext; direct `em.find` returns ciphertext (confirms at-rest protection). |

UI tests are inherited from the parent spec's `<CallTranscriptCard>` flows; the only adapter-specific UI test is:

| TC-TLDV-UI-001 | Integrations marketplace card: connect → setup screen renders with webhook URL + secret + step-by-step screenshots; status pill goes green after first successful webhook delivery. |
| TC-TLDV-UI-002 | `<CallTranscriptCard>` for tl;dv-sourced call: organizer-only-notice copy renders when `sourceProvider='tldv'` and `providerMetadata.organizerOnlyMatched=true`. |

---

## Implementation Phases

Each phase = a working app increment.

### Phase 1 — Provider scaffolding + credential model + connect + manual ingest

1. Scaffold `packages/transcription-tldv/` (package.json, tsconfig, OM module conventions under `src/modules/transcription_tldv/`).
2. Declare entities: `TldvUserCredentials` (with `webhookSecretFingerprint` index) and `TldvPollCursor`; `encryption.ts` map for `api_key` + `webhook_secret`; run `yarn db:generate` and commit the migration.
3. `lib/fingerprint.ts` — `sha256Hex` helper.
4. Implement `TldvCallTranscriptProvider` (provider.ts, credentials.ts, api/schemas.ts, lib/normalize-date.ts, lib/throttled-fetch.ts).
5. DI registration on `callTranscriptProviders` (di.ts).
6. ACL features + setup defaults + `integration.ts` (`hub: 'call_transcripts'`).
7. Connect / rotate-secret / disconnect API routes (upsert the per-user row + vault-level `TldvVaultConfig`).
8. Integrations marketplace card UI.
9. Tests TC-TLDV-001..004, 009, 012, 016, 017.
10. Manual ingest exercised via the parent's existing `POST /api/customers/interactions/:id/reingest-transcript` route after a `TranscriptResult` is hand-submitted.

**Result**: a user in a tenant connects tl;dv; the credentials row is stored encrypted with a fingerprinted secret; a manual reingest surfaces a transcript on the matched person's timeline.

### Phase 2 — Webhook intake

1. Webhook handler at `api/POST/webhooks/transcription/tldv.ts`: fingerprint-indexed lookup, decryption-aware load via `findOneWithDecryption`, constant-time compare on the decrypted secret.
2. Tests TC-TLDV-005..008, 013..015.

**Result**: real tl;dv `TranscriptReady` webhooks land transcripts automatically end-to-end.

### Phase 3 — Polling fallback

1. `workers/poll-tldv.ts` cron worker: iterates `TldvUserCredentials` rows per tenant, loads `TldvPollCursor` per user, calls provider, upserts the cursor.
2. Tests TC-TLDV-010, 011.

**Result**: tenants behind firewalls (no inbound webhooks) get the same automatic ingest with a polling lag.

### Phase 4 — UI hardening + i18n + docs

1. Provider-specific notice on `<CallTranscriptCard>` for tl;dv-sourced calls (key `customers.call_transcripts.tldv.organizer_only_notice` added to the customers i18n bundle).
2. Onboarding screenshots in `packages/transcription-tldv/docs/setup-screenshots/`.
3. Polish translation pass.
4. README in the package root with the limitations section copy.
5. Test TC-TLDV-UI-001, TC-TLDV-UI-002.
6. Code-review gate (`om-code-review`).
7. Move spec to `.ai/specs/implemented/` after deploy.

**Result**: production-ready, with documented limitations and a degraded-but-honest UX for tl;dv-sourced calls.

---

## Assumptions

1. **Pro plan suffices for API + webhooks today.** Live test on 2026-04-22 with a Pro key returned 200 on all required endpoints. Adapter handles 401/403 gracefully if tl;dv enforces the gate later.
2. **`invitees: []` is the common case** for ad-hoc meetings; calendar-linked meetings may populate it. To be confirmed at implementation time on at least one calendar-linked meeting before shipping.
3. **Webhook custom-header signing is acceptable** as a security trade-off given idempotency on the receive side and TLS in transit.
4. **Per-user credential scope** matches tl;dv's per-user API-key model. Each user in a tenant connects their own tl;dv account separately.
5. **Polling default 15 minutes** per user is acceptable lag for transcript availability; tenants who want faster get the webhook path.
6. **tl;dv API stability**: the v1alpha1 prefix flags this as alpha; we accept the risk that tl;dv may breaking-change the API and we'd ship a follow-up patch when they do. Schema validation at the boundary contains the blast radius.
7. **No CTI in scope.** This adapter only handles meeting transcripts. Phone-call ingestion remains the v2 CTI track from the parent spec.
8. **No mutation operations.** Adapter is read-only against tl;dv (fetch transcripts + meetings + list). No create/update/delete calls.

---

## Changelog

- **2026-04-22** — Initial draft. Sub-spec for `packages/transcription-tldv` adapter against the CRM Call Transcriptions parent spec. Provider profile verified live against `https://pasta.tldv.io/v1alpha1` with a Pro-plan API key. Critical finding: `invitees: []` on every tested meeting → organizer-only deterministic matching. Documented limitations, mitigations, and v2 calendar-enrichment escape hatch.
- **2026-04-22** — Mirror-fixes from the Zoom sub-spec architectural review (F1, F2, F3, F5 applied):
  - **F1** Package structure rewritten under `packages/transcription-tldv/src/modules/transcription_tldv/` per verified OM provider-package convention (`packages/gateway-stripe`, `packages/sync-akeneo`).
  - **F2** Webhook route now specified as auto-discovered `api/POST/webhooks/transcription/tldv.ts`; explicit note that `registerWebhookHandler` (payment-gateway-only) is NOT used.
  - **F3** Table renamed `transcription_tldv_poll_state` → `transcription_tldv_poll_cursors` (plural). Entity renamed `TldvPollState` → `TldvPollCursor`. Swept all references.
  - **F5** ACL features renamed `transcription_tldv.{manage, webhook.receive}` → `transcription_tldv.{view, configure}` to match the `<module>.view` + `<module>.configure` convention. `webhook.receive` removed entirely (no analogue in existing OM provider packages; webhooks are signature-authenticated, not role-gated).
  - Status remains **Draft — Proposed** (revised once).
- **2026-04-22** — Cross-spec review `ANALYSIS-2026-04-22-transcription-provider-specs.md` finding #1 (Critical) applied:
  - The SPEC-045 integrations vault is tenant-scoped only (verified: `IntegrationScope = { organizationId, tenantId }`; `integration_credentials` table has no `user_id` column). tl;dv's per-user credential model cannot live in the shared vault without an upstream schema change.
  - Redesigned credential storage: the vault now holds only a tenant-level `TldvVaultConfig { enabled: true }` marker; per-user credentials live in a new provider-owned table `transcription_tldv_user_credentials(id, user_id, tenant_id, organization_id, api_key, webhook_secret, webhook_secret_fingerprint, tldv_user_email, verified_at, created_at, updated_at)` with UNIQUE `(tenant_id, user_id)`. `api_key` and `webhook_secret` encrypted at rest via a new provider-owned `ModuleEncryptionMap` (`encryption.ts`).
  - Webhook tenant/user resolution switched from the previously-proposed `?u=<signedToken>` URL parameter to **fingerprint-indexed lookup**: the handler computes `sha256Hex(X-OM-Webhook-Secret)` and queries `transcription_tldv_user_credentials.webhook_secret_fingerprint` (indexed plaintext column, one-way hash of a 256-bit secret). `?u=` removed everywhere.
  - Connect / rotate-secret / disconnect flows rewritten to upsert the per-user row + tenant-level vault config; disconnect garbage-collects the vault config when the last user leaves.
  - §Data Models (delta) now declares two tables; §Webhook security mitigations list rewritten; §Risks mitigations updated; §Implementation Phases Phase 1 adds the new entity + encryption map + fingerprint helper; tests TC-TLDV-005..009, 016, 017 rewritten for the new lookup flow and TC-TLDV-018 added for at-rest encryption round-trip. Total tests 18 (was 17).
  - Status remains **Draft — Proposed** (revised twice).
- **2026-04-22** — Re-review pass findings #3 and #4 applied:
  - **R3** Stale pre-redesign wording removed: TLDR credential-storage line now correctly cites `transcription_tldv_user_credentials` + the tenant-level enablement marker; architecture diagram webhook-steps block rewritten to match the fingerprint-indexed lookup; connect flow's "personal integrations page" copy replaced with the shared `/backend/integrations` card description.
  - **R4** Index shape aligned with the lookup description: `TldvUserCredentials` now declares `UNIQUE (webhook_secret_fingerprint)` globally (replacing the prior `(organizationId, tenantId, webhookSecretFingerprint)` composite), matching the webhook handler's no-tenant-context lookup. Added an index-rationale block explaining why the three indexes exist (fingerprint uniqueness for webhook lookup, tenant+user uniqueness for connect flow, tenant-scoped composite for polling iteration). §Ingestion lookup description updated to cite "global UNIQUE" rather than the tenant-qualified composite.
  - Status remains **Draft — Proposed** (revised three times).
