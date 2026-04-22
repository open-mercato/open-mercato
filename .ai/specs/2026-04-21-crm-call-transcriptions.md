# CRM Call Transcriptions

| Field | Value |
|---|---|
| **Date** | 2026-04-21 |
| **Status** | Proposed (revised 2026-04-22: dedicated module split) |
| **Author** | Maciej Gren (with om-superpowers + Claude) |
| **Scope** | OSS |
| **Module(s)** | new `call_transcripts` (core module), `customers` (CRM projection only), `webhooks` (inbound adapter), `integrations` (marketplace hub); new `packages/transcription-zoom` and `packages/transcription-tldv` provider packages |
| **Related specs** | `.ai/specs/implemented/SPEC-046b-2026-02-27-customers-interactions-unification.md`, `.ai/specs/implemented/SPEC-045-2026-02-24-integration-marketplace.md`, `.ai/specs/2026-04-11-unified-ai-tooling-and-subagents.md` |
| **Architectural reviews** | `.ai/specs/analysis/ANALYSIS-2026-04-21-crm-call-transcriptions.md`, `.ai/specs/analysis/ANALYSIS-2026-04-22-transcription-provider-specs.md`, PR #1645 feedback from @dominikpalatynski (2026-04-22: module-boundary split), `.ai/specs/analysis/ANALYSIS-2026-04-22-crm-call-transcriptions-review.md` (2026-04-22: post-redesign review — 5 findings applied) — resolutions recorded in §Changelog |

## TLDR

- Automatic ingestion of call transcripts from external meeting tools (Zoom + tl;dv in v1; Meet / Fireflies / Loom / Otter / Gong / Meetily as follow-up packages) into the OM CRM. **OM never transcribes anything.** Audio/video stays on the source tool; OM stores only the transcript text, metadata, and a deep-link back.
- **Dedicated core module `call_transcripts`** owns the transcript aggregate (text, segments, language, provider metadata, deep-link URL), provider registry, ingest pipeline, unmatched staging, and the unmatched inbox UI — mirroring the `payment_gateways` / `data_sync` hub pattern. The customers module is the **CRM projection consumer**: it still owns `CustomerInteraction` (source-of-truth per SPEC-046b) and the new `CustomerInteractionParticipant` junction, and exposes a projection command that `call_transcripts` invokes.
- **Inbound webhooks use the existing `@open-mercato/webhooks` `WebhookEndpointAdapter` contract.** Provider packages register an adapter via `registerWebhookEndpointAdapter`; the shared `/api/webhooks/inbound/[endpointId]` route dispatches verified events to `adapter.processInbound`, which calls the provider's `fetchTranscript` and submits to the transcript-module ingest command. No new per-provider webhook routes.
- Routing is email-deterministic and many-to-many. For each participant email in a transcript, match to `CustomerPerson.primary_email` (and secondary-email CE when declared). One transcript yields ONE `CustomerInteraction` (`interactionType='call'`) + N `CustomerInteractionParticipant` rows in the customers module, all linked to the `CallTranscript` aggregate in `call_transcripts` via the new `sourceCallTranscriptId` custom field.
- Retroactive matching runs on both sides: `call_transcripts` re-checks unmatched staging when a `customers.person.created|updated` event matches an existing transcript; `customers` updates participant rows whose `customer_entity_id` was null when the transcript was originally projected.
- **Unmatched Transcripts inbox lives in the transcript module** at `/backend/call-transcripts/unmatched`. A user claims a transcript by picking a target Person (required) + optional Company + optional Deal; the resolve command projects the transcript into CRM via the customers command bus.
- Transcript text lives in a **first-class `CallTranscript` aggregate**, encrypted at rest. No attachments module involvement for transcripts — the earlier plan to store transcript text in `Attachment.content` is replaced. Removes the library-route leak concern entirely.
- Provider contract: `CallTranscriptProvider<TCredentials>.fetchTranscript(externalRecordingId, ctx) → TranscriptResult`. No STT method. Each provider ships as a separate npm workspace package (`packages/transcription-<vendor>`) implementing both `CallTranscriptProvider` (domain) and `WebhookEndpointAdapter` (intake).
- Provider packages register into a new `call_transcripts` marketplace hub (SPEC-045 `IntegrationHubId`) and expose their `fetchTranscript` implementations via `registerCallTranscriptProvider(adapter)` — a module-level registry matching the `registerGatewayAdapter` / `registerDataSyncAdapter` pattern.
- Out of scope for v1: STT of raw audio; audio/video file storage; CTI / PBX / phone-call events; voicemail; SMS voice; LLM summaries / action-item extraction / sentiment; retention worker; manual upload / paste-a-link.

---

## Problem Statement

Calls with prospects, leads, and customers contain the highest-signal insights a sales team generates — objections, competitor mentions, pricing reactions, next-step commitments. Today these insights live in the meeting tool (Zoom transcripts, tldv notes, Fireflies highlights). They are not visible alongside the CRM records they are about, they are not searchable from the CRM, and they are not surfaced on the timelines of the Person / Company / Deal the call belongs to.

Without an ingestion layer, a sales team either: (a) copy-pastes transcripts into notes (high friction, almost never happens), (b) asks the meeting tool to "sync to CRM" via a brittle Zapier flow that only covers one provider, or (c) loses the insight entirely.

---

## Overview

This spec introduces a dedicated core module **`call_transcripts`** at `packages/core/src/modules/call_transcripts`. The module owns the transcript-specific data aggregate, the provider registry, the ingest pipeline, the unmatched staging + inbox UI, the inbound-webhook adapter wiring, and a new `call_transcripts` marketplace hub. Provider packages (`packages/transcription-zoom`, `packages/transcription-tldv`, …) ship as separate workspace packages that implement two contracts defined in this module: `CallTranscriptProvider<TCredentials>` (fetch + list) and `@open-mercato/webhooks`'s `WebhookEndpointAdapter` (signed-payload intake).

The customers module is downstream of the transcript pipeline. It retains ownership of `CustomerInteraction` (source-of-truth for CRM activity per SPEC-046b) and introduces `CustomerInteractionParticipant` as the participant junction linking interactions to CRM people/entities. It exposes a projection command `customers.interactions.create_from_transcript` that `call_transcripts.ingest` invokes synchronously on match. Customers never sees provider-specific payloads, webhook routes, or provider credentials.

The ingest flow: a verified webhook event hits `/api/webhooks/inbound/[endpointId]` (the shared route owned by `@open-mercato/webhooks`); the dispatcher looks up the registered adapter by `providerKey`; the adapter's `processInbound` handler resolves credentials, calls its own `CallTranscriptProvider.fetchTranscript`, and submits the normalized `TranscriptResult` to the `call_transcripts.ingest` command. The command stores the `CallTranscript` aggregate + raw `CallTranscriptParticipant` rows, runs the routing algorithm (matching emails/phones against customers via a read-only matching service), and either (a) invokes the customers projection command to create `CustomerInteraction` + `CustomerInteractionParticipant` rows — all inside a single atomic flush — or (b) writes to `call_transcript_unmatched` staging when no participant matches. A scheduled polling worker, shipped by each provider package, provides a fallback for tenants behind firewalls.

Transcript content lives in the new `call_transcripts.text` column (encrypted at rest via `call_transcripts/encryption.ts`). The customers module stores **no** transcript body — `CustomerInteraction.body` stays null for calls; the `<CallTranscriptCard>` widget (owned by `call_transcripts` and injected into the customers timeline spot) fetches the transcript by id from the ACL-gated `GET /api/call-transcripts/:id` route. Transcript body is not present in the search index in v1 (only `title` + `source` indexed for call interactions — see §Search configuration for why and for the follow-up track that adds user-feature-aware full-text search once `packages/search` supports it).

---

## Research — Market Leaders

| Product | Approach | Relevant signal |
|---|---|---|
| HubSpot Sales Hub + Meeting Insights | Auto-associates a meeting with contacts / companies / deals based on **attendee emails**. One meeting activity links to multiple records. Unresolved meetings land in a "Review" queue. Deep-links back to source recording. | Validates **email-deterministic, many-to-many** routing + unmatched inbox. |
| Pipedrive + Gong / Chorus | Call activity logged against a Deal (primary) with linked Contacts as participants. Transcript attached as a file. | Validates **single activity + participant junction** (their "attendees" array). |
| Salesforce Einstein Activity Capture | Emails + meetings auto-related to records via email matching; multi-record association. Einstein Conversation Insights layers transcript analysis on top. | Validates the split we're making: **ingest now, AI layer later**. |
| Gong / Chorus native | Native recording + transcription + analytics. Pushes activity records into the CRM via integration. | Shows the full stack but we explicitly do NOT build the recorder/transcriber — we consume finished transcripts. |
| Zammad Generic CTI | Phone-number-matched caller log via PBX webhooks. No transcripts. | Reference for the **v2 CTI track** — drives the polymorphic identity choice. |
| Meetily | On-device meeting assistant with local transcription + summary. Exports via API. | Follow-up provider (`packages/transcription-meetily`) — no v1 impact. |

Convergent patterns across all leaders: email-based matching, many-to-many linkage, unmatched fallback queue, deep-link back to source, transcript surfaced on the timeline and retrievable by the CRM record. Our design reflects all five. Full-text transcript search is a v2 track — v1 indexes only call `title` + `source` pending a user-feature-aware extension of `packages/search` (§Search configuration).

---

## Proposed Solution

### 1. Provider contract

File: `packages/core/src/modules/call_transcripts/lib/provider-contract.ts` (new). Re-exported from `@open-mercato/shared/modules/call_transcripts/provider` for third-party provider packages. Moved out of `customers` — this is cross-cutting transcript-infrastructure, not a CRM concern.

```ts
// Typed JSON value — exported from @open-mercato/shared/modules/call_transcripts/provider
// for any provider that needs to round-trip arbitrary serializable metadata without
// resorting to `unknown`.
export type JsonValue =
  | string | number | boolean | null
  | JsonValue[]
  | { [key: string]: JsonValue }

// Generic over each provider's credential shape. Concrete providers narrow it.
//   class ZoomProvider implements CallTranscriptProvider<ZoomCredentials> { ... }
export interface CallTranscriptProvider<TCredentials = Record<string, never>> {
  id: string                             // 'zoom' | 'tldv' | 'meet' | 'fireflies' | ...
  label: string                          // 'Zoom', 'tldv', 'Google Meet', ...
  viewLabel: string                      // 'Open in Zoom' — used on deep-link buttons
  pollIntervalMinutes?: number           // default 15; 0 disables polling
  fetchTranscript(
    externalRecordingId: string,
    ctx: ProviderCtx<TCredentials>,
  ): Promise<TranscriptResult>
  listRecentRecordings?(
    ctx: ProviderCtx<TCredentials>,
    since: Date,
  ): AsyncIterable<RecordingSummary>     // used by polling fallback
}

export type ProviderCtx<TCredentials> = {
  tenantId: string
  organizationId: string
  credentials: TCredentials              // typed per provider; resolved from integrations vault (SPEC-045)
  logger: Logger
}

export type TranscriptResult = {
  externalRecordingId: string
  sourceMeetingUrl: string               // deep-link back to the source tool
  occurredAt: Date
  durationSec?: number
  language?: string
  title?: string
  text: string                           // full transcript, plain text
  segments?: Array<{
    speaker?: string
    startSec: number
    endSec: number
    text: string
  }>
  participants: Array<{
    email?: string
    phone?: string                       // E.164 — reserved for v2 CTI providers
    displayName?: string
    role?: 'host' | 'participant'
  }>
  providerMetadata?: Record<string, JsonValue>
}

export type RecordingSummary = {
  externalRecordingId: string
  occurredAt: Date
  title?: string
}
```

Zod refinement on `participants[]`: **at least one of `email` or `phone` MUST be present**. Applied via `data/validators.ts` on the ingest route.

**Matching runtime validator for `JsonValue`.** The shared module also exports a recursive zod schema so routes can validate `providerMetadata` as `Record<string, JsonValue>` without falling back to `z.unknown()`:

```ts
// packages/core/src/modules/call_transcripts/lib/provider-contract.ts
// (also re-exported from @open-mercato/shared/modules/call_transcripts/provider)
export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(jsonValueSchema),
  ]),
)

export const providerMetadataSchema = z.record(jsonValueSchema)
```

The ingest route's `callTranscriptIngestSchema` (§API Contracts) uses `providerMetadataSchema`, not `z.record(z.unknown())`. This keeps the runtime contract aligned with the TypeScript type.

Each provider package declares its `TCredentials` shape and a matching zod schema. Where credentials fit the SPEC-045 `IntegrationScope` (tenant-scoped), they are stored in the shared integrations vault (pattern used by Zoom). Where a provider's authentication model is per-user (e.g. tl;dv, where each OM user connects their own tl;dv account with a personal API key), per-user credentials live in a provider-owned encrypted table inside the provider package; only a tenant-level enablement marker lands in the shared vault. The adapter's `ProviderCtx<TCredentials>` is populated at request time from whichever source the provider owns. No `unknown` leaks at any boundary.

### 2. Provider registry + marketplace hub

**Registry**. Each provider package registers its `CallTranscriptProvider` implementation via a module-level function `registerCallTranscriptProvider(adapter)` exposed by `call_transcripts/lib/adapter-registry.ts`. This mirrors the verified OM pattern for `registerGatewayAdapter` (`packages/core/src/modules/payment_gateways`) and `registerDataSyncAdapter` (`packages/core/src/modules/data_sync/lib/adapter-registry.ts`): a provider-keyed Map, populated at module boot time from the provider package's `di.ts`. No DI multi-provider token is used — the previous spec draft's `callTranscriptProviders` DI token has been retired because it doesn't match any existing OM provider-hub pattern.

```ts
// packages/core/src/modules/call_transcripts/lib/adapter-registry.ts
const registry = new Map<string, CallTranscriptProvider<unknown>>()
export function registerCallTranscriptProvider<T>(adapter: CallTranscriptProvider<T>): void { registry.set(adapter.id, adapter as CallTranscriptProvider<unknown>) }
export function getCallTranscriptProvider(providerKey: string): CallTranscriptProvider<unknown> | null { return registry.get(providerKey) ?? null }
export function listCallTranscriptProviders(): ReadonlyArray<CallTranscriptProvider<unknown>> { return Array.from(registry.values()) }
```

**Marketplace hub**. SPEC-045's `IntegrationHubId` (`packages/shared/src/modules/integrations/types.ts`) enumerates existing hubs: `payment_gateways`, `shipping_carriers`, `data_sync`, `webhook_endpoints`, `communication_channels`, `storage_hubs`. This spec adds `call_transcripts` to the union type + registers the hub descriptor in `call_transcripts/lib/hubs.ts` (mirrors `data_sync`'s hub descriptor). Every `packages/transcription-<vendor>` package's `integration.ts` declares:

```ts
export const integration: IntegrationDefinition = {
  id: 'transcription_<vendor>',
  category: 'call_transcripts',
  hub: 'call_transcripts',
  providerKey: '<vendor>',
  // ...
}
```

Integrations-module wiring (all additive):
- Extend `INTEGRATION_MARKETPLACE_CATEGORIES` in `packages/core/src/modules/integrations/backend/integrations/filters.ts` with `'call_transcripts'`.
- Add `integrations.marketplace.categories.call_transcripts` i18n entry for every locale the project ships.
- Add the hub descriptor + icon mapping in the same module (icon fallback: lucide `phone`).
- Extend `IntegrationHubId` in `packages/shared/src/modules/integrations/types.ts` (union add — additive BC).

### 3. Ingest triggers (inbound via `@open-mercato/webhooks`)

**Webhook intake uses the shared `WebhookEndpointAdapter` contract** (`packages/webhooks/src/modules/webhooks/lib/adapter-registry.ts`). The previous draft's per-provider route pattern (`POST /api/webhooks/transcription/<vendor>`) is retired — it bypassed the platform's existing inbound pipeline, duplicated rate-limiting / deduplication / raw-body handling, and locked a new public route convention into contract surface. The shared pipeline already provides:

- One shared route at `POST /api/webhooks/inbound/[endpointId]` (`endpointId = providerKey`).
- Provider-owned signature verification inside `adapter.verifyWebhook({ headers, body, method })`.
- Raw-body preservation before JSON parsing (required for HMAC validation).
- Message-id based deduplication via `WebhookInboundReceiptEntity`.
- Rate limiting (60 points / 60 sec per endpoint).
- Verified event published on `webhooks.inbound.received` (persistent queue); subscriber dispatches to `adapter.processInbound({ eventType, payload, tenantId, organizationId, providerKey })`.

**Provider package responsibilities** (one `WebhookEndpointAdapter` per provider):

```ts
// packages/transcription-<vendor>/src/modules/transcription_<vendor>/webhook-adapter.ts
export const webhookAdapter: WebhookEndpointAdapter = {
  providerKey: '<vendor>',
  subscribedEvents: ['<vendor>.transcript_ready'],
  async verifyWebhook({ headers, body, method }) {
    // Provider-owned signature verification (HMAC for Zoom, secret-header for tl;dv, etc.).
    // Resolves tenantId + organizationId from payload / URL / fingerprint.
    // Returns the verified envelope { eventType, payload, tenantId, organizationId }.
  },
  async processInbound({ eventType, payload, tenantId, organizationId }) {
    // 1. Resolve credentials from the integrations vault (tenant-scoped) or
    //    provider-owned per-user table (e.g. tl;dv).
    // 2. Call the provider's CallTranscriptProvider.fetchTranscript(externalRecordingId, ctx).
    // 3. Submit the normalized TranscriptResult to the call_transcripts ingest command.
    const provider = getCallTranscriptProvider(webhookAdapter.providerKey)!
    const transcript = await provider.fetchTranscript(payload.externalRecordingId, ctx)
    await commandBus.execute('call_transcripts.ingest', { tenantId, organizationId, providerKey: webhookAdapter.providerKey, transcript })
  },
}

// packages/transcription-<vendor>/src/modules/transcription_<vendor>/di.ts
registerWebhookEndpointAdapter(webhookAdapter)
registerCallTranscriptProvider(new VendorCallTranscriptProvider())
```

**URL-validation handshakes — required additive extension to `@open-mercato/webhooks`.** Some providers (Zoom's `endpoint.url_validation`) require a **synchronous** cryptographic reply from the intake URL: compute `encryptedToken = HMAC-SHA256(plainToken, secretToken)` and return it in the HTTP response body within ~3 seconds. The current shared inbound route (verified at `packages/webhooks/src/modules/webhooks/api/inbound/[endpointId]/route.ts:54-106`) persists a receipt, emits `webhooks.inbound.received`, and returns a fixed JSON ack — `processInbound` runs asynchronously in a subscriber (`packages/webhooks/src/modules/webhooks/subscribers/inbound-process.ts`). That flow cannot carry a provider-specific response body back to the caller.

To unblock Zoom, this spec **requires an additive extension** to `@open-mercato/webhooks` before Phase 4 (Zoom adapter) lands. Proposed extension (additive to the `WebhookEndpointAdapter` contract):

```ts
interface WebhookEndpointAdapter {
  // existing fields unchanged …

  // NEW optional hook — called synchronously from the inbound route BEFORE
  // the standard persist → emit → subscriber pipeline, and ONLY if it returns a value.
  // When present and returning a non-null value, the route bypasses receipt/event
  // and responds with the returned `{ status, headers?, body }` directly.
  handleHandshake?(input: {
    headers: Record<string, string>
    body: string
    method: string
  }): Promise<null | { status: number; headers?: Record<string, string>; body: unknown }>
}
```

Zoom's adapter implements `handleHandshake` to recognize `event === 'endpoint.url_validation'` payloads, compute the encrypted token, and return `{ status: 200, body: { plainToken, encryptedToken } }`. All other events return `null`, which falls through to the standard asynchronous flow. tl;dv does not implement `handleHandshake` (no synchronous handshake required).

This extension is a **blocker for Phase 4** and is called out explicitly in the Zoom sub-spec. If the extension is not landed, Zoom's URL-validation step in the admin's webhook-setup UI will fail and the integration will not register. Tracked as a prerequisite platform task; size-estimate ~1 atomic commit in `packages/webhooks`.

**Tenant resolution** is provider-owned inside `verifyWebhook`:
- Zoom: a signed tenant token in the webhook URL query param (`?t=…`) keyed on `OM_INTERNAL_WEBHOOK_KEY`, cross-checked with `payload.account_id`. Full details in the Zoom sub-spec.
- tl;dv: SHA-256 fingerprint of the `X-OM-Webhook-Secret` header against a provider-owned per-user credentials row. Full details in the tl;dv sub-spec.

The shared webhook pipeline passes raw `headers` + `body` to `verifyWebhook`, so either mechanism slots in cleanly.

**Polling fallback** (secondary). Each provider package ships its own scheduled worker (`workers/poll-<vendor>.ts`) with concurrency 1 per connected scope. The worker iterates `provider.listRecentRecordings(ctx, since=lastPolledAt)` for each connected scope and submits new recordings through the same `call_transcripts.ingest` command. Polling cursor tables are provider-package-local (`transcription_zoom_poll_cursors`, `transcription_tldv_poll_cursors`).

**Manual reingest**. `POST /api/call-transcripts/:id/reingest` (owner: `call_transcripts` module) refetches the transcript via the provider, overwrites the `CallTranscript` aggregate row, and, if projected, updates the `CustomerInteraction` custom fields via the customers projection command.

### 4. Ingest flow (two-module orchestration)

Executed as the `call_transcripts.ingest` command. Cross-module coordination is explicit: the transcript module calls the customers module via the command bus, never by direct ORM access.

**Transaction model (not cross-module atomic — two committed phases with a defined recovery path).** The current customers command implementation (verified at `packages/core/src/modules/customers/commands/interactions.ts:259`) forks its own `EntityManager` and opens its own `runInTransaction`. That means a nested `customers.interactions.create_from_transcript` cannot be joined into an outer `withAtomicFlush` opened by `call_transcripts.ingest` — each command commits in its own transaction. The spec therefore does NOT promise a single cross-module atomic write. Instead:

- **Phase A (transcript aggregate)** runs inside its own `withAtomicFlush` with `transaction: true` — the `CallTranscript` row, all `CallTranscriptParticipant` rows, and (if no match) the `CallTranscriptUnmatched` row are committed as one atomic unit owned by the `call_transcripts` module. On idempotency conflict the command short-circuits with `{ status: 'duplicate' }` and never reaches Phase B/C.
- **Phase C (customers projection)** runs as a separate command invocation (`customers.interactions.create_from_transcript`) and commits in its own transaction. On success, `call_transcripts.ingest` makes a final `projection_status = 'projected'` + `interaction_id = <id>` write in a short follow-up transaction owned by `call_transcripts`.
- **Failure between Phase A and Phase C** leaves the transcript row at `projection_status = 'pending'` with `interaction_id = null`. A durable recovery subscriber (below) retries Phase C; the transcript is never orphaned without a recovery path.
- **Failure of Phase C itself** (customers command throws) sets `projection_status = 'projection_failed'` with a `last_error` column and emits `call_transcripts.transcript.projection_failed { transcriptId, errorCode }`. The same recovery subscriber retries with exponential backoff. After N retries the transcript falls back to `projection_status = 'unmatched'` and shows up in the inbox for manual resolution — reusing the Phase-B-no-match surface.

**Undo semantics.** Because the two phases commit separately, undo is per-phase, not a single chained undo:

- Undoing `call_transcripts.ingest` **before** Phase C completes deletes only the transcript-module rows (what that command wrote). No CRM interaction exists to undo.
- Undoing `call_transcripts.ingest` **after** Phase C has completed invokes `customers.interactions.delete_from_transcript` (a dedicated inverse command — not a generic undo-chain on `customers.interactions.create_from_transcript`), then deletes the transcript-module rows. The inverse command is idempotent: a missing interaction is treated as "already undone," not as an error.
- If the customers inverse command fails (interaction hard-deleted by an admin, for instance), the transcript-module rows still delete and an `call_transcripts.transcript.undo_partial` event records the orphan. Operators reconcile via `POST /api/call-transcripts/:id/reingest` rather than blocking the undo.

This is a deliberate step back from the earlier "single `withAtomicFlush` + chain-undo" phrasing: it matches the shipped command pattern without pretending the system provides cross-command atomicity it does not. A future shared-transaction primitive (a `commandBus.runInShared(em, async bus => { … })` signature that passes an outer EM into nested command handlers) would let us restore the single-tx guarantee; that primitive is out of scope here and tracked as a separate platform concern.

```
INPUT: TranscriptResult r, providerKey, tenantId, organizationId

// Phase A — store the transcript aggregate (always runs, even on zero match).
//          This is the transcript-module source-of-truth write.
transcript := create CallTranscript(
  provider_key         = providerKey,
  external_recording_id = r.externalRecordingId,
  source_meeting_url   = r.sourceMeetingUrl,
  occurred_at          = r.occurredAt,
  duration_sec         = r.durationSec,
  language             = r.language,
  title                = r.title,
  text                 = r.text,                   // encrypted at rest via call_transcripts/encryption.ts
  segments             = r.segments,               // jsonb
  provider_metadata    = r.providerMetadata,       // jsonb
  projection_status    = 'pending',                // 'pending' | 'projected' | 'unmatched' | 'dismissed'
  organization_id, tenant_id,
)

for each p in r.participants:
  create CallTranscriptParticipant(
    call_transcript_id = transcript.id,
    email              = p.email,                  // encrypted + email_hash
    phone              = p.phone,                  // encrypted + phone_hash
    display_name       = p.displayName,
    role               = p.role ?? 'participant',
    organization_id, tenant_id,
  )

// Idempotency: UNIQUE (tenant_id, provider_key, external_recording_id). On conflict,
// the command detects an existing transcript id and returns { status: 'duplicate' }.

// Phase B — match against CRM, via customers' read-only matching service.
matches := customerMatchingService.matchParticipants(tenantId, organizationId, r.participants)
  // Returns { participant → { customerEntityId | null, matchedVia }, ... }

if every match.customerEntityId is null:
  update transcript.projection_status = 'unmatched'
  create CallTranscriptUnmatched(
    call_transcript_id = transcript.id,
    participants_summary = r.participants.map(asSummary),
    status = 'pending',
    organization_id, tenant_id,
  )
  emit call_transcripts.transcript.ingested { transcriptId, projectionStatus: 'unmatched' }
  emit call_transcripts.transcript.unmatched { transcriptId, participantCount }
  STOP

// Phase C — CRM projection via the customers command bus.
primary := pick from matches[where customerEntityId != null] in this precedence:
     a. the Person linked to exactly ONE active Deal (if unambiguous)
     b. the Person linked to the most-recently-active Deal
     c. the first matched Person (by r.participants index)

projection := commandBus.execute('customers.interactions.create_from_transcript', {
  tenantId, organizationId,
  transcriptId:              transcript.id,
  primaryCustomerEntityId:   primary.customer_entity_id,
  occurredAt:                r.occurredAt,
  title:                     r.title ?? `${provider.label} call`,
  source:                    providerKey,
  participants:              matches,      // includes unmatched rows with customerEntityId=null
})
// projection = { interactionId, participantIds[] }

update transcript.projection_status = 'projected'
update transcript.interaction_id    = projection.interactionId   // cross-module FK id (not ORM relationship)

emit call_transcripts.transcript.ingested {
  transcriptId: transcript.id,
  projectionStatus: 'projected',
  interactionId: projection.interactionId,
  primaryCustomerEntityId: primary.customer_entity_id,
  participantCount: matches.length,
}
emit call_transcripts.transcript.projected { transcriptId, interactionId }
```

**What customers owns** in this flow:
- `CustomerMatchingService.matchParticipants` — read-only service resolved from the DI container, scoped to `(tenantId, organizationId)`. Uses the encryption layer's deterministic hash columns (`primary_email_hash`, `secondary_email_hash CE`, `primary_phone_hash`, `secondary_phone_hash CE`) — never decrypts plaintext for matching.
- `customers.interactions.create_from_transcript` command — creates `CustomerInteraction` (with `sourceCallTranscriptId` custom field = `transcriptId`) and N `CustomerInteractionParticipant` rows. Emits `customers.interaction.created` per SPEC-046b.

**What call_transcripts owns**:
- `CallTranscript` + `CallTranscriptParticipant` + `CallTranscriptUnmatched` tables.
- The orchestration command, the matching-service call, the projection-command invocation, the `projection_status` lifecycle, and all transcript events.

**Undo semantics**: per-phase, per the transaction model above. Undo invokes `customers.interactions.delete_from_transcript` as an explicit inverse command if Phase C committed, then deletes the transcript-module rows in their own transaction. A missing interaction is treated as "already undone" by the inverse command. If the inverse command fails, the transcript-module rows still delete and a `call_transcripts.transcript.undo_partial` event is emitted for operator reconciliation. The earlier "single chain-undo through `withAtomicFlush`" contract has been retired — see §4 "Transaction model" for rationale.

### 5. Retroactive matching (two subscribers, each owned by the right module)

Retroactive matching has two distinct concerns, owned by different modules:

**(a) Customers-owned: backfill `customer_interaction_participants`.**

Persistent subscriber `packages/core/src/modules/customers/subscribers/backfill-interaction-participant.ts` reacts to `customers.person.created` / `customers.person.updated` (verified against `packages/core/src/modules/customers/events.ts:10-12`). It inspects `primary_email` / `primary_phone` (+ secondary-email/phone CE if present) and, for each non-empty identifier, runs:

```sql
UPDATE customer_interaction_participants
SET customer_entity_id = <new person's customer_entity_id>,
    matched_via        = 'primary_email' | 'primary_phone' | 'secondary_email' | 'secondary_phone'
WHERE customer_entity_id IS NULL
  AND tenant_id        = <new person's tenant>
  AND organization_id  = <new person's org>
  AND (email_hash      = encryption.hash(<new email>)
       OR phone_hash   = encryption.hash(<new phone>))
```

(Lookup uses the deterministic `email_hash` / `phone_hash` columns since the plaintext columns store ciphertext at rest — see §Encryption.) Emits `customers.interaction_participant.matched { interactionId, participantId, customerEntityId }` per affected row. Batched 200 rows per emission.

**(b) Transcript-owned: re-check `call_transcript_unmatched` staging.**

Persistent subscriber `packages/core/src/modules/call_transcripts/subscribers/backfill-unmatched.ts` reacts to the same two customers events. For each matching identifier, it scans `call_transcript_unmatched` rows whose `participants_summary[].email_hash` or `.phone_hash` matches the new Person. On match, the subscriber:
1. Invokes `call_transcripts.resolve_unmatched` command with `primaryPersonId = <new person>` (chosen as the primary because they're the one whose addition triggered the match).
2. The resolve command runs the Phase C projection from §4 and deletes the unmatched staging row.

Both subscribers are independent: a newly-created Person may trigger both (if they match an existing unmatched transcript AND historical participant rows). Neither subscriber needs a batch-size cap on the inner query because the projection is idempotent (the ingest command's UNIQUE key prevents double projection).

The `customers.person.updated` payload contract MUST include the previous `primary_email`/`primary_phone` snapshot so both subscribers can detect identifier changes; if not already in the payload, this spec adds that field via the existing customers update command and validators (additive, BC-safe).

### 6. Unmatched Transcripts inbox (call_transcripts module)

New backend page `/backend/call-transcripts/unmatched` under the `call_transcripts` module (see §UI & UX). User claims a row via a dialog → picks Person (required) + optional Company + optional Deal → invokes `call_transcripts.resolve_unmatched` command → runs Phase C projection with user-picked primary → deletes the staging row.

The inbox is NOT under `/backend/customers/*` as the earlier draft proposed — per @dominikpalatynski's PR #1645 feedback, routing the inbox through customers reinforces the wrong ownership and makes later extraction user-visible. Widget injection into customers is still provided: the inbox's pending-count badge is injected into the customers sidebar as a supplementary navigation hint, while the canonical page lives under `/backend/call-transcripts/`.

### 7. Timeline union on Person / Company / Deal pages

**(Corrected per ANALYSIS finding #3 — response enrichers are additive-only and cannot rewrite queries.)**

This concern is 100% CRM-side: the timeline widget queries `CustomerInteraction` + `CustomerInteractionParticipant`, both customers-owned. The new route stays in customers; call_transcripts contributes the expanded `<CallTranscriptCard>` via widget injection per §UI & UX.

**(a) Dedicated timeline route (preferred) — customers module.**

`GET /api/customers/interactions/timeline?subjectKind=person|company|deal&subjectId=<uuid>&page=&pageSize=&sortDir=`

- Server-side union: interactions where `entity_id = subjectId` ∪ interactions whose `id` appears in `customer_interaction_participants` for `subjectId` (joining through Person → Company and Person → Deal for the company/deal subjectKinds).
- Returns the same shape as `GET /api/customers/interactions` so the widget swaps endpoints transparently.
- ACL: route guard requires `customers.interactions.view`; the handler additionally requires the per-`subjectKind` view feature (`customers.people.view` for `subjectKind=person`, `customers.companies.view` for `company`, `customers.deals.view` for `deal`). There is no umbrella `customers.view` feature — see §API Contracts and `packages/core/src/modules/customers/acl.ts`.

**(b) Backwards-compatible widening on the existing list route.**

For consumers that keep using `GET /api/customers/interactions`, an API interceptor at `customers/api/interceptors.ts` accepts an optional `participantOf=<uuid>` query param. When present, it pre-resolves the union of matching interaction IDs from the participants junction (and Person→Company/Deal joins) and injects them via `query.ids` (comma-separated UUIDs) per the OM interceptor contract. This is an **additive** query-shape change — old calls without `participantOf` keep their current behavior.

Query cost: one indexed lookup on `customer_interaction_participants(organization_id, tenant_id, customer_entity_id)` plus a (bounded) join on `customer_people` / `customer_companies` / `customer_deals` for the company/deal subject kinds.

The Person / Company / Deal timeline widgets are updated to call (a) or (b); the choice is per widget but (a) is preferred for new code. The per-row `<CallTranscriptCard>` rendering comes from a transcript-module widget injected into the `customers:timeline:interaction` spot (see §UI & UX).

---

## User Stories / Use Cases

- **Sales rep** wants **every call to land automatically on the right Person / Company / Deal timelines** so that **follow-up context is never lost to copy-paste friction**.
- **Sales manager** wants **a call attended by three CRM contacts to appear on all three timelines without duplicating records** so that **the full history of every contact is preserved without data sprawl**.
- **Sales rep (reviewer)** wants **zero-match transcripts to queue in an inbox and be claimable manually** so that **no call silently disappears when a participant is missing from CRM**.
- **Ops / BD lead** wants **a new contact added to CRM to retroactively surface their past calls** so that **historical context arrives as soon as the relationship is formalized**.
- **Platform integrator** wants **to ship a new transcription provider as its own npm package without forking core** so that **tldv, Meet, Fireflies, Loom, Otter, Gong, Meetily can be added by the community**.
- **Ops admin** wants **OM to never run speech-to-text** so that **the platform has no audio storage cost, no transcription billing, and no STT-quality debt**.
- **Security / compliance officer** wants **transcript content encrypted at rest and readable only by users with `call_transcripts.view`** so that **regulated PII in call bodies never leaks via the attachments library or the search index**.

These stories map directly to sections below:
- "automatic ingestion" → §Proposed Solution.3 (shared `WebhookEndpointAdapter` pipeline + polling) + §API Contracts (`POST /api/call-transcripts/ingest`).
- "three timelines without duplication" → `CustomerInteractionParticipant` junction (customers) + §API Contracts (`GET /api/customers/interactions/timeline`).
- "zero-match inbox" → `CallTranscriptUnmatched` staging (call_transcripts) + §UI & UX (`/backend/call-transcripts/unmatched`) + the notify-unmatched subscriber.
- "retroactive matching" → two subscribers: `call_transcripts/subscribers/backfill-unmatched.ts` (rechecks staging) + `customers/subscribers/backfill-interaction-participant.ts` (updates junction rows).
- "provider-agnostic" → shared `CallTranscriptProvider<TCredentials>` contract + `WebhookEndpointAdapter` adapter pattern + sub-specs for Zoom + tl;dv.
- "never STT" → contract has `fetchTranscript` only; no `transcribe(audio)` method.
- "ACL-gated transcript read" → dedicated `GET /api/call-transcripts/:id` route + encryption map on `call_transcripts:call_transcript.text`.

---

## Architecture

```
 External meeting tools (each ships as a separate workspace package)
 ┌──────────────┬──────────────┬──────────────┬──────────────┬────────────┐
 │ Zoom         │ tl;dv        │ Google Meet  │ Fireflies    │ Loom/Otter │
 │ (v1)         │ (v1)         │ (follow-up)  │ (follow-up)  │ (follow-up)│
 └──────┬───────┴──────┬───────┴──────┬───────┴──────┬───────┴─────┬──────┘
        │ Webhook (primary)                                        │ Poll
        ▼                                                          ▼ (fallback)
 ┌──────────────────────────────────────────────────────────────────────┐
 │ packages/webhooks — INBOUND PIPELINE (shared, existing)              │
 │                                                                       │
 │  POST /api/webhooks/inbound/[endpointId]   (single shared route)     │
 │  → registry lookup by providerKey                                     │
 │  → adapter.verifyWebhook({ headers, body, method })                  │
 │  → dedup via WebhookInboundReceiptEntity                              │
 │  → rate-limit (60/60s)                                                │
 │  → emit webhooks.inbound.received                                     │
 │                                                                       │
 │  subscriber: webhooks-inbound-process                                 │
 │  → adapter.processInbound({ eventType, payload, tenantId, orgId })    │
 └────────────────────────────────┬─────────────────────────────────────┘
                                  │
 ┌────────────────────────────────┼─────────────────────────────────────┐
 │ packages/transcription-<vendor>│ (one per provider, workspace pkg)   │
 │                                │                                      │
 │  WebhookEndpointAdapter        │  CallTranscriptProvider              │
 │  (registered via                │  (registered via                    │
 │   registerWebhookEndpointAdapter) │ registerCallTranscriptProvider)  │
 │                                                                       │
 │  verifyWebhook() — HMAC/secret, tenant resolution (per provider)      │
 │  processInbound() — resolves credentials, calls own                   │
 │      fetchTranscript(), submits to call_transcripts.ingest            │
 │                                                                       │
 │  Polling worker (per tenant/user)                                     │
 │  → provider.listRecentRecordings(ctx, since)                          │
 │  → call_transcripts.ingest per new recording                          │
 └────────────────────────────────┬─────────────────────────────────────┘
                                  │ call_transcripts.ingest
                                  ▼
 ┌──────────────────────────────────────────────────────────────────────┐
 │ packages/core/src/modules/call_transcripts — DEDICATED HUB           │
 │                                                                       │
 │  • CallTranscriptProvider<T> contract (provider-contract.ts)         │
 │  • registerCallTranscriptProvider(adapter) — module-level registry   │
 │  • Integration hub descriptor — IntegrationHubId = 'call_transcripts' │
 │                                                                       │
 │  Commands:                                                            │
 │   call_transcripts.ingest              (store + match + project)     │
 │   call_transcripts.resolve_unmatched   (user claim from inbox)       │
 │   call_transcripts.reingest            (refetch + overwrite)         │
 │                                                                       │
 │  Events:                                                              │
 │   call_transcripts.transcript.ingested    (persistent, clientBroadcast)│
 │   call_transcripts.transcript.unmatched   (persistent)                │
 │   call_transcripts.transcript.projected   (persistent)                │
 │   call_transcripts.transcript.reingested  (persistent)                │
 │                                                                       │
 │  Subscribers:                                                         │
 │   backfill-unmatched (persistent)                                     │
 │     on customers.person.created / .updated → recheck staging          │
 │       → call_transcripts.resolve_unmatched if match found             │
 │   notify-unmatched (persistent)                                       │
 │     on call_transcripts.transcript.unmatched                          │
 │       → in-app notification to users with                             │
 │         call_transcripts.unmatched.resolve                            │
 │                                                                       │
 │  ACL: call_transcripts.view, .manage, .unmatched.resolve              │
 │  UI:  /backend/call-transcripts/unmatched (inbox)                     │
 │        <CallTranscriptCard> widget → injected into customers timeline │
 │  API: GET  /api/call-transcripts/:id      (ACL-gated transcript read) │
 │       POST /api/call-transcripts/ingest    (service-to-service)       │
 │       POST /api/call-transcripts/unmatched/:id/resolve                │
 │       POST /api/call-transcripts/:id/reingest                         │
 └────────────────────────────────┬─────────────────────────────────────┘
                                  │
                                  │ customers.interactions.create_from_transcript
                                  │ (command bus, within same transaction)
                                  ▼
 ┌──────────────────────────────────────────────────────────────────────┐
 │ packages/core/src/modules/customers — CRM PROJECTION                 │
 │                                                                       │
 │  CustomerInteraction (source-of-truth per SPEC-046b, schema UNCHANGED)│
 │    cf: sourceCallTranscriptId, durationSec, direction, sourceProvider │
 │        (body stays null for calls — transcript text lives in         │
 │         call_transcripts.text)                                        │
 │                                                                       │
 │  CustomerInteractionParticipant (NEW — CRM participant junction)      │
 │    id, interaction_id, customer_entity_id (nullable),                 │
 │    email (encrypted), email_hash, phone (encrypted), phone_hash,      │
 │    display_name (encrypted), role, matched_via,                       │
 │    organization_id, tenant_id, created_at                             │
 │    CHECK (email IS NOT NULL OR phone IS NOT NULL)                     │
 │                                                                       │
 │  Command: customers.interactions.create_from_transcript               │
 │    Creates CustomerInteraction + N CustomerInteractionParticipant.    │
 │    Called by call_transcripts.ingest.                                 │
 │                                                                       │
 │  Service: CustomerMatchingService.matchParticipants (read-only)       │
 │    Invoked from call_transcripts during ingest's Phase B.             │
 │                                                                       │
 │  Subscriber: backfill-interaction-participant (persistent)            │
 │    on customers.person.created / .updated → UPDATE participants       │
 │      where customer_entity_id IS NULL                                 │
 │      AND (email_hash=? OR phone_hash=?)                               │
 │    Emits customers.interaction_participant.matched.                   │
 └──────────────────────────────────────────────────────────────────────┘

                                  │
                                  ▼
 ┌──────────────────────────────────────────────────────────────────────┐
 │ DATA MODEL (call_transcripts module)                                  │
 │                                                                       │
 │ call_transcripts (NEW aggregate, transcript-module owned)             │
 │   id, provider_key, external_recording_id, source_meeting_url,       │
 │   occurred_at, duration_sec, language, title,                        │
 │   text (encrypted at rest),                                          │
 │   segments (jsonb), provider_metadata (jsonb),                       │
 │   projection_status ('pending'|'projected'|'unmatched'|'dismissed'), │
 │   interaction_id (FK id; null until projected; cross-module by id),  │
 │   organization_id, tenant_id, created_at, updated_at, deleted_at     │
 │   UNIQUE (tenant_id, provider_key, external_recording_id)            │
 │                                                                       │
 │ call_transcript_participants (NEW — raw provider-reported)            │
 │   id, call_transcript_id (FK), email (encrypted), email_hash,        │
 │   phone (encrypted), phone_hash, display_name (encrypted), role,     │
 │   organization_id, tenant_id, created_at                             │
 │                                                                       │
 │ call_transcript_unmatched (NEW — staging for inbox)                   │
 │   id, call_transcript_id (FK),                                       │
 │   participants_summary (jsonb), status ('pending'|'resolved'|'dismissed'),│
 │   organization_id, tenant_id, created_at,                            │
 │   resolved_at, resolved_by, resolved_to_interaction_id                │
 └──────────────────────────────────────────────────────────────────────┘

                                  │
                                  ▼
 ┌──────────────────────────────────────────────────────────────────────┐
 │ CRM UI — automatic surface, no manual upload                          │
 │                                                                       │
 │ NO interaction detail page. Transcripts surface INLINE on the         │
 │ existing Person / Company / Deal detail pages via the timeline widget.│
 │                                                                       │
 │ Timeline expansion for interaction_type='call' → <CallTranscriptCard>:│
 │   OWNED BY: call_transcripts module (registered as a widget at the   │
 │             customers:timeline:interaction injection spot)            │
 │   FETCHES : GET /api/call-transcripts/:id via                         │
 │             CustomerInteraction.customValues.sourceCallTranscriptId  │
 │   RENDERS : provider icon + occurredAt + duration,                    │
 │             "Open in <provider>" deep-link,                           │
 │             participants pills, transcript body (collapsible)         │
 │   GATED   : call_transcripts.view                                     │
 │                                                                       │
 │ Unmatched inbox page: /backend/call-transcripts/unmatched             │
 │   DataTable of staged rows; row action "Claim" → dialog with Person   │
 │   (required) + optional Company + optional Deal; runs                 │
 │   call_transcripts.resolve_unmatched.                                 │
 │                                                                       │
 │ Customers sidebar injection: count badge for pending unmatched.       │
 └──────────────────────────────────────────────────────────────────────┘

 Credentials flow: provider package → integrations module credential vault
   (SPEC-045, tenant-scoped) OR provider-owned per-user table (e.g. tl;dv).
   User connects providers from the "Call transcript providers" hub page
   under the new call_transcripts marketplace category.
```

---

## Data Models

Entities split by module. All cross-module references are FK *ids only* (no MikroORM relationships) per root AGENTS.md.

### New entities — `call_transcripts` module

**`CallTranscript`** — first-class transcript aggregate. Source-of-truth for transcript text, segments, provider metadata, and deep-link URL. Owned exclusively by the transcript module.

```ts
// packages/core/src/modules/call_transcripts/data/entities.ts
@Entity({ tableName: 'call_transcripts' })
@Unique({ name: 'call_transcripts_provider_recording_unique',
         properties: ['tenantId', 'providerKey', 'externalRecordingId'] })
@Index({ name: 'call_transcripts_projection_status_idx', properties: ['organizationId', 'tenantId', 'projectionStatus'] })
@Index({ name: 'call_transcripts_interaction_idx',       properties: ['organizationId', 'tenantId', 'interactionId'] })
@Index({ name: 'call_transcripts_occurred_idx',          properties: ['organizationId', 'tenantId', 'occurredAt'] })
export class CallTranscript {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' }) id!: string
  @Property({ name: 'provider_key',          type: 'text' }) providerKey!: string
  @Property({ name: 'external_recording_id', type: 'text' }) externalRecordingId!: string
  @Property({ name: 'source_meeting_url',    type: 'text' }) sourceMeetingUrl!: string
  @Property({ name: 'occurred_at',           type: Date }) occurredAt!: Date
  @Property({ name: 'duration_sec',          type: 'int', nullable: true }) durationSec?: number | null
  @Property({ type: 'text', nullable: true }) language?: string | null
  @Property({ type: 'text', nullable: true }) title?: string | null
  @Property({ type: 'text' }) text!: string                                // encrypted at rest; see §Encryption
  @Property({ type: 'jsonb', nullable: true }) segments?: Array<{
    speaker?: string; startSec: number; endSec: number; text: string
  }> | null
  @Property({ name: 'provider_metadata', type: 'jsonb', nullable: true }) providerMetadata?: Record<string, unknown> | null
  @Property({ name: 'projection_status', type: 'text', default: 'pending' }) projectionStatus: 'pending' | 'projected' | 'unmatched' | 'projection_failed' | 'dismissed' = 'pending'
  @Property({ name: 'interaction_id',   type: 'uuid', nullable: true }) interactionId?: string | null   // FK id (NOT an ORM relationship)
  @Property({ name: 'last_error', type: 'text', nullable: true }) lastError?: string | null           // populated on projection_status='projection_failed'; cleared on recovery
  @Property({ name: 'organization_id', type: 'uuid' }) organizationId!: string
  @Property({ name: 'tenant_id',        type: 'uuid' }) tenantId!: string
  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() }) createdAt: Date = new Date()
  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() }) updatedAt: Date = new Date()
  @Property({ name: 'deleted_at', type: Date, nullable: true }) deletedAt?: Date | null
}
```

**`CallTranscriptParticipant`** — raw provider-reported participants, exactly as the provider's webhook / API returned them. This is the transcript-side source-of-truth; the CRM-side `CustomerInteractionParticipant` is derived from these rows during projection.

**Constraint shape (anonymous-speaker-safe).** The CHECK requires at least one of `{ email, phone, display_name }` — NOT `email OR phone` alone. Zoom and tl;dv both produce transcripts where some speakers carry only a display name (Zoom "Guest 2", tl;dv segments whose `speaker` is a plain string with no email — verified against the tl;dv sub-spec §50-60). Forcing email-or-phone would require either (a) silently dropping those speakers or (b) synthesising fake identifiers, both of which mutate provider data in ways that break downstream retroactive matching and audit fidelity. The looser CHECK keeps the raw row lossless; the matchable-identity subset is derived at query time from the non-null `emailHash` / `phoneHash` columns (which are populated only when `email` / `phone` are present).

`matchable` (boolean, computed on insert) marks whether the row has enough to attempt CRM matching. `displayName`-only rows are stored with `matchable = false` and deliberately skipped by `CustomerMatchingService.matchParticipants` — they still appear in the unmatched-inbox participants summary and in the transcript timeline so operators can see who spoke.

```ts
@Entity({ tableName: 'call_transcript_participants' })
@Check({
  name: 'call_transcript_participants_identity_chk',
  expression: '(email IS NOT NULL OR phone IS NOT NULL OR display_name IS NOT NULL)'
})
@Index({ name: 'ctp_transcript_idx',  properties: ['callTranscriptId'] })
@Index({ name: 'ctp_email_hash_idx',  properties: ['organizationId', 'tenantId', 'emailHash'] })
@Index({ name: 'ctp_phone_hash_idx',  properties: ['organizationId', 'tenantId', 'phoneHash'] })
@Index({ name: 'ctp_matchable_idx',   properties: ['organizationId', 'tenantId', 'matchable'] })
export class CallTranscriptParticipant {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' }) id!: string
  @Property({ name: 'call_transcript_id', type: 'uuid' }) callTranscriptId!: string
  @Property({ type: 'text', nullable: true }) email?: string | null
  @Property({ name: 'email_hash', type: 'text', nullable: true }) emailHash?: string | null
  @Property({ type: 'text', nullable: true }) phone?: string | null
  @Property({ name: 'phone_hash', type: 'text', nullable: true }) phoneHash?: string | null
  @Property({ name: 'display_name', type: 'text', nullable: true }) displayName?: string | null
  @Property({ type: 'text', nullable: true }) role?: string | null
  @Property({ type: 'boolean', default: false }) matchable: boolean = false  // true iff email IS NOT NULL OR phone IS NOT NULL (set by ingest command)
  @Property({ name: 'organization_id', type: 'uuid' }) organizationId!: string
  @Property({ name: 'tenant_id',        type: 'uuid' }) tenantId!: string
  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() }) createdAt: Date = new Date()
}
```

**`CallTranscriptUnmatched`** — staging for transcripts pending manual claim from the inbox.

```ts
@Entity({ tableName: 'call_transcript_unmatched' })
@Index({ name: 'ctu_status_idx', properties: ['organizationId', 'tenantId', 'status'] })
@Index({ name: 'ctu_transcript_idx', properties: ['callTranscriptId'] })
export class CallTranscriptUnmatched {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' }) id!: string
  @Property({ name: 'call_transcript_id', type: 'uuid' }) callTranscriptId!: string
  @Property({ name: 'participants_summary', type: 'jsonb' }) participantsSummary!: Array<{
    email?: string; phone?: string; displayName?: string; role?: string; emailHash?: string; phoneHash?: string
  }>
  @Property({ type: 'text', default: 'pending' }) status: 'pending' | 'resolved' | 'dismissed' = 'pending'
  @Property({ name: 'organization_id', type: 'uuid' }) organizationId!: string
  @Property({ name: 'tenant_id',        type: 'uuid' }) tenantId!: string
  @Property({ name: 'created_at',  type: Date, onCreate: () => new Date() }) createdAt: Date = new Date()
  @Property({ name: 'resolved_at', type: Date, nullable: true }) resolvedAt?: Date | null
  @Property({ name: 'resolved_by', type: 'uuid', nullable: true }) resolvedBy?: string | null
  @Property({ name: 'resolved_to_interaction_id', type: 'uuid', nullable: true }) resolvedToInteractionId?: string | null
}
```

### New entities — `customers` module

**`CustomerInteractionParticipant`** — junction linking an interaction to N participants (matched CRM people or unmatched raw emails/phones).

```ts
@Entity({ tableName: 'customer_interaction_participants' })
@Check({ name: 'customer_interaction_participants_identity_chk',
         expression: '(email IS NOT NULL OR phone IS NOT NULL)' })
@Index({ name: 'cip_interaction_idx',     properties: ['interactionId'] })
@Index({ name: 'cip_entity_idx',          properties: ['organizationId', 'tenantId', 'customerEntityId'] })
@Index({ name: 'cip_email_hash_idx',      properties: ['organizationId', 'tenantId', 'emailHash'] })
@Index({ name: 'cip_phone_hash_idx',      properties: ['organizationId', 'tenantId', 'phoneHash'] })
export class CustomerInteractionParticipant {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' }) id!: string
  @Property({ name: 'interaction_id',     type: 'uuid' }) interactionId!: string
  @Property({ name: 'customer_entity_id', type: 'uuid', nullable: true }) customerEntityId?: string | null
  @Property({ type: 'text', nullable: true }) email?: string | null      // encrypted at rest (see Encryption)
  @Property({ name: 'email_hash', type: 'text', nullable: true }) emailHash?: string | null  // deterministic hash for lookup
  @Property({ type: 'text', nullable: true }) phone?: string | null      // encrypted at rest
  @Property({ name: 'phone_hash', type: 'text', nullable: true }) phoneHash?: string | null  // deterministic hash for lookup
  @Property({ name: 'display_name', type: 'text', nullable: true }) displayName?: string | null  // encrypted at rest
  @Property({ type: 'text', nullable: true }) role?: string | null       // 'host' | 'participant'
  @Property({ name: 'matched_via',     type: 'text', nullable: true }) matchedVia?: string | null
  @Property({ name: 'organization_id', type: 'uuid' }) organizationId!: string
  @Property({ name: 'tenant_id',        type: 'uuid' }) tenantId!: string
  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() }) createdAt: Date = new Date()
}
```

> Note: indexes use `emailHash` / `phoneHash` (populated by the encryption layer's hash function) so we can run deterministic equality lookups (`WHERE email_hash = $1`) without decrypting; matching the standard OM pattern from `ModuleEncryptionFieldRule.hashField`. The plaintext `email` / `phone` columns store ciphertext at rest and are never used in `WHERE` clauses.

### Custom fields on `CustomerInteraction` (customers module)

Declared in `packages/core/src/modules/customers/ce.ts` under the `customers:customer_interaction` entity:

| Key | Type | Required | Notes |
|---|---|---|---|
| `sourceCallTranscriptId` | uuid | yes (when `interaction_type='call'` and interaction was created from a transcript) | FK id into `call_transcripts` (not an ORM relationship). Populated by `customers.interactions.create_from_transcript`. Enables `<CallTranscriptCard>` to fetch transcript content. |
| `durationSec` | integer | no | Seconds. Denormalized from `CallTranscript.duration_sec` for listing/sorting without a cross-module read. |
| `direction` | enum('inbound','outbound','n_a') | no | Defaults `n_a` for meeting-SaaS; CTI providers set it in v2. |
| `sourceProvider` | text | yes (when `interaction_type='call'` and transcript-backed) | Matches `CallTranscriptProvider.id`. |

Idempotency: `call_transcripts.ingest` is idempotent via its own `UNIQUE (tenantId, providerKey, externalRecordingId)` — by the time the customers projection runs, duplicates have already been filtered out. The customers projection command does NOT own an independent idempotency key; it trusts the caller.

### No attachment-module coupling

The previous draft stored transcript text in `Attachment.content` under a `customer-call-recordings` partition, with `attachments/encryption.ts` added to encrypt the content column. That design is retired per @dominikpalatynski's PR #1645 feedback: coupling transcript lifecycle to CRM-interaction attachment storage blocks future non-CRM reuse (e.g. lead-intake transcripts, portal-supplied transcripts) and required a platform-wide encryption rule on `attachments:attachment.content` with global blast radius. The first-class `CallTranscript.text` column is encrypted per the `call_transcripts` module's own `encryption.ts`, with zero cross-module side effects. No attachments-module changes are made by this spec — the partition seed, the `confidentialContent: boolean` partition flag, and the library-route hardening are all removed from scope.

### Encryption maps

**`packages/core/src/modules/call_transcripts/encryption.ts`** — NEW.

```ts
import type { ModuleEncryptionMap } from '@open-mercato/shared/modules/encryption'

export const defaultEncryptionMaps: ModuleEncryptionMap[] = [
  {
    entityId: 'call_transcripts:call_transcript',
    fields: [{ field: 'text' }],
  },
  {
    entityId: 'call_transcripts:call_transcript_participant',
    fields: [
      { field: 'email',        hashField: 'email_hash' },
      { field: 'phone',        hashField: 'phone_hash' },
      { field: 'display_name' },
    ],
  },
]

export default defaultEncryptionMaps
```

**EXTEND** `packages/core/src/modules/customers/encryption.ts` (file exists today) with one new entry for the CRM participants junction. Email gets a `hashField` so matching/lookups work without decryption (uses the existing OM encryption pattern).

```ts
{
  entityId: 'customers:customer_interaction_participant',
  fields: [
    { field: 'email',        hashField: 'email_hash' },
    { field: 'phone',        hashField: 'phone_hash' },
    { field: 'display_name' },
  ],
},
```

This requires adding `email_hash` and `phone_hash` columns to `CustomerInteractionParticipant` (TEXT, indexed). The retroactive-match subscriber and matching service look up by `email_hash` / `phone_hash`, never by plaintext.

**Custom fields on `CustomerInteraction`:** `sourceCallTranscriptId` is a uuid (no PII), `durationSec` / `direction` / `sourceProvider` are opaque tokens, none require encryption.

**Read-path discipline.** All reads in `call_transcripts` that touch `text`, `email`, `phone`, or `display_name` MUST use `findWithDecryption` / `findOneWithDecryption` per `packages/shared/AGENTS.md`. Same rule applies to `customer_interaction_participants.email` / `.phone` / `.display_name`. Plain `em.find` is forbidden on these tables.

### Migration

Auto-generated via `yarn db:generate` after declaring the entities. Expected output: one new migration under `packages/core/src/modules/call_transcripts/migrations/` (three tables: `call_transcripts`, `call_transcript_participants`, `call_transcript_unmatched`), and a second migration under `packages/core/src/modules/customers/migrations/` (`customer_interaction_participants` + `customer_interaction.sourceCallTranscriptId` CF link).

### Search configuration

**(Scope-reduced per ANALYSIS 2026-04-22-transcription-provider-specs.md finding #4: the current search stack — verified in `packages/search/src/service.ts` and `packages/shared/src/modules/search.ts` — has no mechanism to filter results by the querying user's ACL features. `SearchOptions` receives only `tenantId`/`organizationId`/`entityTypes`/`strategies`; no user-features context reaches result merging, and `fieldPolicy.excluded` is a static index-time rule, not a runtime ACL filter. Indexing transcript text therefore cannot be gated by `call_transcripts.view` without extending the search service — out of scope for v1.)**

Today, `packages/core/src/modules/customers/search.ts` indexes person/company profiles, comments, deals, the deprecated `customer_activity` alias, and the todo link — but NOT `customers:customer_interaction`. This spec EXTENDS that file with an entry covering only the interaction record's **title and source** — **not** transcript body:

```ts
{
  entityId: 'customers:customer_interaction',
  enabled: true,
  priority: 7,

  buildSource: async (ctx) => {
    assertTenantContext(ctx)
    const r = ctx.record
    const lines: string[] = []
    appendLine(lines, 'Type', r.interaction_type)
    appendLine(lines, 'Title', r.title)
    appendLine(lines, 'Source provider', r.source)

    if (!lines.length) return null
    return {
      text: lines,
      presenter: {
        title: pickString(r.title) ?? `Call · ${r.source ?? 'meeting'}`,
        subtitle: snippet(r.title, 80),
        icon: 'phone',
        badge: 'Call',
      },
      checksumSource: { id: r.id, updatedAt: r.updated_at, source: r.source },
    }
  },

  formatResult: async (ctx) => ({
    title: pickString(ctx.record.title) ?? 'Call',
    subtitle: snippet(ctx.record.title, 80),
    icon: 'phone',
    badge: 'Call',
  }),

  resolveUrl: async (ctx) => {
    const entityId = ctx.record.entity_id
    return entityId
      ? `/backend/customers/people/${encodeURIComponent(String(entityId))}#interaction-${ctx.record.id}`
      : null
  },

  fieldPolicy: {
    searchable: ['title', 'source'],
    hashOnly: [],
    excluded: ['body'],   // body is unused for calls; transcript text is NOT in the index
  },
},
```

Notes:
- Transcript text lives only in `call_transcripts.text` (encrypted at rest) and is served exclusively through the ACL-gated `GET /api/call-transcripts/:id` route (owned by the transcript module).
- Users find calls by **title** and **provider** via search ("Zoom call with Acme"); they cannot search for a phrase that appears inside the transcript body. Accepted trade-off for v1 per proxy lesson #2 ("ship simple — don't build guardrails without evidence they're needed"). A follow-up spec will introduce a user-features-aware search filter on `packages/search` and, once that lands, transcript text can be added to the index without risking cross-ACL leaks.
- Vector embeddings over the full transcript are explicitly out of scope.
- No `loadCallTranscriptText` helper is introduced — the previous draft's helper relied on the absent runtime ACL filter.

---

## API Contracts

All routes export an `openApi` spec per OM rules. Routes split by owning module: `/api/call-transcripts/*` → `call_transcripts`; `/api/customers/interactions/*` stays in `customers`. There is one shared webhook route under `/api/webhooks/inbound/[endpointId]` owned by `@open-mercato/webhooks`.

### Internal: ingest a transcript (call_transcripts module)

`POST /api/call-transcripts/ingest`
- **Auth**: service-to-service only. Called from each provider's `WebhookEndpointAdapter.processInbound` and from provider polling workers after they verify the source. Exposed via an `api_key`-gated route guard with the `call_transcripts.manage` feature; in practice most callers resolve the command directly from the container inside `processInbound`, so this HTTP route exists for cross-process callers only (CLI tools, future sidecar workers).
- **Request** (zod, `packages/core/src/modules/call_transcripts/data/validators.ts`):

```ts
export const callTranscriptIngestSchema = z.object({
  providerKey: z.string().min(1),        // 'zoom' | 'tldv' | ...
  transcript: z.object({
    externalRecordingId: z.string().min(1),
    sourceMeetingUrl: z.string().url(),
    occurredAt: z.string().datetime(),
    durationSec: z.number().int().nonnegative().optional(),
    language: z.string().optional(),
    title: z.string().optional(),
    text: z.string().min(1),
    segments: z.array(z.object({
      speaker: z.string().optional(),
      startSec: z.number(),
      endSec: z.number(),
      text: z.string(),
    })).optional(),
    participants: z.array(z.object({
      email: z.string().email().optional(),
      phone: z.string().optional(),
      displayName: z.string().optional(),
      role: z.enum(['host', 'participant']).optional(),
    })).min(1).refine(
      (list) => list.every((p) => p.email || p.phone),
      'Each participant must have email or phone',
    ),
    providerMetadata: providerMetadataSchema.optional(),
  }),
})
export type CallTranscriptIngestInput = z.infer<typeof callTranscriptIngestSchema>
```

- **Response** (200):
```ts
{ status: 'projected',   transcriptId: string, interactionId: string, primaryCustomerEntityId: string, participantCount: number }
| { status: 'unmatched', transcriptId: string, unmatchedId: string }
| { status: 'duplicate', transcriptId: string, interactionId: string | null }   // idempotency on (tenantId, providerKey, externalRecordingId)
```

### Read transcript (call_transcripts module, first-class aggregate)

`GET /api/call-transcripts/:id`
- **Auth**: `requireAuth`, `requireFeatures: ['call_transcripts.view']`.
- Resolves the `CallTranscript` row by id, decrypts `text` via `findOneWithDecryption`, joins `call_transcript_participants`, and optionally joins the CRM projection snapshot (from `customer_interaction_participants` when `interactionId` is set) so the UI can render matched/unmatched pills without a second request.
- **Response**:
```ts
{
  id: string,
  providerKey: string,
  sourceMeetingUrl: string,
  occurredAt: string,
  durationSec: number | null,
  language: string | null,
  title: string | null,
  text: string,
  segments: Array<{ speaker?: string, startSec: number, endSec: number, text: string }> | null,
  providerMetadata: Record<string, unknown> | null,
  projectionStatus: 'pending' | 'projected' | 'unmatched' | 'dismissed',
  interactionId: string | null,
  participants: Array<{
    email: string | null,
    phone: string | null,
    displayName: string | null,
    role: 'host' | 'participant' | null,
    // CRM projection snapshot (only when projectionStatus === 'projected'):
    customerEntityId: string | null,
    matchedVia: string | null,
  }>,
}
```
- The CRM `<CallTranscriptCard>` widget fetches this route using the interaction's `sourceCallTranscriptId` custom-field value. No attachments-library involvement.

### Unmatched inbox (call_transcripts module)

`GET /api/call-transcripts/unmatched`
- **Auth**: `requireFeatures: ['call_transcripts.unmatched.resolve']`.
- **Query**: `page`, `pageSize` (≤100), `providerKey?`, `status?`, standard CRUD filters.
- **Response**: paged list with `transcriptId`, `providerKey`, `title`, `occurredAt`, `sourceMeetingUrl`, `participantsSummary`, `status`, per-row "can resolve" flag.

`POST /api/call-transcripts/unmatched/:id/resolve`
- **Auth** (route-level guard + handler-level subject check — mirrors the `GET /api/customers/interactions/timeline` pattern further down this section, because this endpoint writes a `CustomerInteraction` linked to customer subject records):
  - Route-level `requireFeatures: ['call_transcripts.unmatched.resolve', 'customers.interactions.create']` — both must hold. The transcript-inbox feature alone is NOT sufficient because the resolve action projects onto CRM records.
  - Handler-level per-subject check, verified against `packages/core/src/modules/customers/acl.ts`:
    - `personId` (always required) → `customers.people.view`
    - `companyId` (optional) → `customers.companies.view`
    - `dealId` (optional) → `customers.deals.view`
    - If any provided subject fails the subject-specific feature check → 403 with a localizable error code (`forbidden_subject_access`). The handler must perform all subject-existence reads under the current session's ACL — do NOT bypass ACL to "look up then project," because that leaks existence of records the caller cannot see.
  - Rationale: without the customer-domain check, a user holding only `call_transcripts.unmatched.resolve` could write interactions onto customer records they cannot otherwise read or mutate. The transcript-inbox feature governs the inbox surface; customer-domain features govern what the caller is allowed to reach FROM the inbox.
- **Request**: `{ personId: uuid, companyId?: uuid, dealId?: uuid }`.
- Invokes `call_transcripts.resolve_unmatched` command → runs Phase C projection (from §4) with the user-picked primary. On success, sets staging `status='resolved'`, `resolvedBy`, `resolvedAt`, `resolvedToInteractionId`; returns the created `interactionId`.
- On failure (Person deleted between list and resolve), returns 409 with an error code consumers can localize. On subject-ACL denial at handler level, returns 403 `forbidden_subject_access`.

`DELETE /api/call-transcripts/unmatched/:id`
- **Auth**: `requireFeatures: ['call_transcripts.unmatched.resolve']`. Dismiss does not write to CRM records; the transcript-inbox feature alone is sufficient.
- Soft-dismisses the row (`status='dismissed'`). Transcript aggregate is retained; only the inbox entry is hidden.

### Manual reingest (call_transcripts module)

`POST /api/call-transcripts/:id/reingest`
- **Auth**: `requireAuth`, `requireFeatures: ['call_transcripts.manage']`.
- Resolves `(providerKey, externalRecordingId)` from the `CallTranscript` row, looks up the provider via `getCallTranscriptProvider`, calls `provider.fetchTranscript`, overwrites `call_transcripts.text` + `segments` + `providerMetadata`, emits `call_transcripts.transcript.reingested`. If the transcript was projected, also fires `customers.interactions.update_from_transcript` to keep interaction custom fields (`durationSec`, `direction`) and participants aligned.

### Subject timeline (Person / Company / Deal) — customers module

**(Added per ANALYSIS finding #3 — replaces the response-enricher plan with a real query-rewriting mechanism. Owned by customers because it queries CRM tables.)**

`GET /api/customers/interactions/timeline`
- **Auth**: `requireAuth` plus a per-`subjectKind` feature check applied inside the handler (the route-level guard requires `customers.interactions.view`; the handler additionally requires the subject-kind feature). Verified against `packages/core/src/modules/customers/acl.ts`:
  - `subjectKind=person`  → `customers.interactions.view` + `customers.people.view`
  - `subjectKind=company` → `customers.interactions.view` + `customers.companies.view`
  - `subjectKind=deal`    → `customers.interactions.view` + `customers.deals.view`

  There is no umbrella `customers.view` feature in the customers module — the ACL is granular by entity type. The earlier draft's `customers.view` reference was wrong and is corrected here.
- **Query**: `subjectKind` (`person` | `company` | `deal`), `subjectId` (uuid), `page`, `pageSize` (≤100), `sortDir`, optional standard filters.
- **Response shape**: identical to `GET /api/customers/interactions` so widget consumers swap endpoints transparently.
- **Behavior**: server-side union of (interactions where `entity_id = subjectId`) ∪ (interactions whose `id` is in `customer_interaction_participants` for `subjectId`, joining through Person → Company / Person → Deal for the company/deal subjectKinds). Results are deduplicated by interaction id.

Alternatively, consumers may pass `participantOf=<uuid>` to the existing `GET /api/customers/interactions` route; an interceptor at `customers/api/interceptors.ts` resolves the union into `query.ids` per the OM interceptor contract. Both paths produce the same result; the dedicated route is preferred for new code.

### Customers projection API (internal, command-bus-only)

`customers.interactions.create_from_transcript` — NEW command, NOT an HTTP route. Invoked from `call_transcripts.ingest` via the command bus. Input:

```ts
{
  tenantId: string
  organizationId: string
  transcriptId: string                        // FK id into call_transcripts
  primaryCustomerEntityId: string
  occurredAt: string                          // ISO-8601
  title: string
  source: string                              // providerKey
  durationSec?: number
  language?: string
  sourceMeetingUrl: string
  participants: Array<{
    email: string | null
    emailHash: string | null
    phone: string | null
    phoneHash: string | null
    displayName: string | null
    role: 'host' | 'participant' | null
    customerEntityId: string | null           // null = unmatched participant; still gets a junction row
    matchedVia: 'primary_email' | 'secondary_email' | 'primary_phone' | 'secondary_phone' | null
  }>
}
```

Returns `{ interactionId, participantIds }`. Undoable (delete on undo).

`customers.interactions.update_from_transcript` — updates interaction custom fields + participant rows when a transcript is reingested. Called by `call_transcripts.reingest`.

### Webhook intake (shared route, owned by @open-mercato/webhooks)

Every transcription provider package registers a `WebhookEndpointAdapter` via `registerWebhookEndpointAdapter`. Inbound delivery uses the existing shared route at `POST /api/webhooks/inbound/[endpointId]` where `endpointId = providerKey` (`/api/webhooks/inbound/zoom`, `/api/webhooks/inbound/tldv`, …). The route already handles:
- Raw body preservation (required for HMAC).
- Provider-owned signature verification (`adapter.verifyWebhook`).
- Tenant/org resolution returned from `verifyWebhook`.
- Dedup via `WebhookInboundReceiptEntity` (messageId hash).
- Rate limit (60 points / 60 sec per endpoint).
- Emit `webhooks.inbound.received` → subscriber dispatches to `adapter.processInbound`.

Provider-specific details (event names, signature algorithms, payload shapes, URL-validation handshakes, replay windows, etc.) live in each provider's sub-spec. Examples:
- Zoom: `.ai/specs/2026-04-22-transcription-zoom-adapter.md` §Webhook security.
- tl;dv: `.ai/specs/2026-04-22-transcription-tldv-adapter.md` §Webhook security (no HMAC).

### OpenAPI helpers

`packages/core/src/modules/call_transcripts/api/openapi.ts` (NEW) gains a `buildCallTranscriptsOpenApi` factory for `/api/call-transcripts/*`. The customers-module `interactions/timeline` route uses the existing `buildCustomersCrudOpenApi` with a new branch.

---

## Commands & Events

Split by owning module. Cross-module orchestration is explicit: `call_transcripts` invokes `customers.interactions.*` commands via the command bus; `customers` never invokes `call_transcripts` commands directly.

### Commands — `call_transcripts` module (file: `call_transcripts/commands/*`)

| Command ID | Input | Result | Undo behavior |
|---|---|---|---|
| `call_transcripts.ingest` | `CallTranscriptIngestInput` | `{ transcriptId, projectionStatus, interactionId?: string, primaryCustomerEntityId?: string, participantCount?: number }` | Per-phase undo (see §4 Transaction model): if Phase C committed, invoke the inverse command `customers.interactions.delete_from_transcript` (idempotent — missing interaction = "already undone"), then delete transcript + raw participants + unmatched staging row in their own transaction. Emits `call_transcripts.transcript.ingest_reverted` on success, `call_transcripts.transcript.undo_partial` if the inverse command fails. Not a single chained undo — each side commits independently. |
| `call_transcripts.resolve_unmatched` | `{ unmatchedId, primaryPersonId, companyId?, dealId? }` | `{ transcriptId, interactionId, participantIds[] }` | Per-phase undo: invoke `customers.interactions.delete_from_transcript` against the created interaction, then re-create the staging row from snapshot (`status='pending'`, clears `resolvedBy` / `resolvedAt` / `resolvedToInteractionId`). Same partial-failure contract as `call_transcripts.ingest`. |
| `call_transcripts.reingest` | `{ transcriptId }` | `{ transcriptId, overwrittenAt }` | Undo: restore previous `text` + `segments` + `providerMetadata` snapshot; chain `customers.interactions.update_from_transcript` undo when projected. |
| `call_transcripts.dismiss_unmatched` | `{ unmatchedId, reason? }` | `{ unmatchedId }` | Undo: reset `status='pending'`. |

### Commands — `customers` module (NEW in `customers/commands/interactions-from-transcript.ts`)

| Command ID | Input | Result | Undo behavior |
|---|---|---|---|
| `customers.interactions.create_from_transcript` | See §API Contracts | `{ interactionId, participantIds[] }` | Delete interaction + participants junction rows. |
| `customers.interactions.update_from_transcript` | `{ interactionId, patch: { durationSec?, participants? }}` | `{ interactionId, participantIds[] }` | Restore snapshot. |
| `customers.interactions.delete_from_transcript` | `{ interactionId }` | `{ interactionId }` | Re-create from snapshot. |
| `customers.interaction_participants.manually_link` | `{ participantId, customerEntityId }` | `{ participantId }` | Reset `customerEntityId=null`, `matchedVia=null`. |

All state-changing commands invoke `emitCrudSideEffects` (query-index refresh + cache tag invalidation) and `emitCrudUndoSideEffects` symmetrically. Transcript commands target `entityType: 'call_transcripts:call_transcript'`; customers commands target `entityType: 'customers:customer_interaction'`.

### Events — `call_transcripts` module (declared in `call_transcripts/events.ts`)

```ts
{ id: 'call_transcripts.transcript.ingested',
  label: 'Call transcript ingested',
  category: 'custom',
  entity: 'call_transcript',
  clientBroadcast: true,
  persistent: true }
{ id: 'call_transcripts.transcript.unmatched',
  label: 'Call transcript could not be matched',
  category: 'custom',
  persistent: true }
{ id: 'call_transcripts.transcript.projected',
  label: 'Call transcript projected to CRM',
  category: 'custom',
  persistent: true }
{ id: 'call_transcripts.transcript.reingested',
  label: 'Call transcript reingested',
  category: 'custom',
  persistent: true }
{ id: 'call_transcripts.transcript.ingest_reverted',
  label: 'Call transcript ingest reverted (undo)',
  category: 'system',
  persistent: false,
  excludeFromTriggers: true }
{ id: 'call_transcripts.unmatched.resolved',
  label: 'Unmatched transcript resolved',
  category: 'custom',
  persistent: true }
{ id: 'call_transcripts.unmatched.dismissed',
  label: 'Unmatched transcript dismissed',
  category: 'custom',
  persistent: true }
```

### Events — `customers` module (additions to `customers/events.ts`)

```ts
{ id: 'customers.interaction_participant.matched',
  label: 'Interaction participant matched',
  category: 'custom',
  persistent: true }
```

No `customers.call_transcript.*` events are added — the transcript lifecycle belongs to the call_transcripts module. Customers' existing `customers.interaction.created` event (per SPEC-046b) still fires from `create_from_transcript`.

### Subscribers — `call_transcripts` module

`call_transcripts/subscribers/backfill-unmatched.ts`
- Events: `customers.person.created`, `customers.person.updated`.
- `persistent: true`, `id: 'backfill-unmatched-transcripts'`.
- Scans `call_transcript_unmatched` for rows whose `participants_summary[].email_hash` or `.phone_hash` matches the new Person. On match, invokes `call_transcripts.resolve_unmatched`. Idempotent (resolve is UNIQUE on staging id + status).

`call_transcripts/subscribers/notify-unmatched-transcript.ts`
- Event: `call_transcripts.transcript.unmatched`.
- `persistent: true`.
- Emits an in-app notification of type `call_transcripts.unmatched_transcript` (declared in `call_transcripts/notifications.ts`) to all users with the `call_transcripts.unmatched.resolve` feature.

`call_transcripts/subscribers/reindex-transcript.ts` (optional, deferred to v2)
- Events: `call_transcripts.transcript.ingested`, `call_transcripts.transcript.reingested`.
- v1 is a no-op placeholder — transcript body is not indexed until `packages/search` gains user-feature-aware filtering.

### Subscribers — `customers` module

`customers/subscribers/backfill-interaction-participant.ts`
- Events: `customers.person.created`, `customers.person.updated` (verified against `packages/core/src/modules/customers/events.ts:10-12`).
- `persistent: true`, `id: 'backfill-interaction-participant-match'`.
- Idempotent: updates `customer_interaction_participants` rows `WHERE customer_entity_id IS NULL` by `email_hash` / `phone_hash`. Batched to 200 rows per emission to avoid subscriber storms on bulk imports.

---

## UI & UX

All UI uses `@open-mercato/ui` components and the semantic color tokens. No arbitrary Tailwind sizes. `Cmd/Ctrl+Enter` to submit dialogs, `Escape` to cancel.

### Inline transcript rendering on Person / Company / Deal pages

**(Corrected per ANALYSIS finding #7 — there is no interaction detail page in `customers/backend/`. Verified: only `people/[id]`, `companies/[id]`, `deals/[id]` and their `-v2` variants exist.)**

There is no dedicated interaction detail page in v1. Transcripts surface inline on the existing **Person / Company / Deal detail pages** via the timeline widget. Each timeline row whose `interactionType='call'` becomes expandable with the transcript content, participants, and provider deep-link. This matches how interactions are surfaced today (per SPEC-046b's interactions unification).

**Component ownership and injection**: `<CallTranscriptCard>` lives in the **call_transcripts** module (`packages/core/src/modules/call_transcripts/components/CallTranscriptCard.tsx`) and is injected into the customers timeline via the `customers:timeline:interaction` widget spot (new spot declared by the customers module when SPEC-046b's timeline is implemented, OR by this spec if that spot doesn't already exist). The widget registration lives in `call_transcripts/widgets/injection/timeline-call-card.tsx`. This keeps provider-specific transcript rendering out of the customers module — customers' timeline renders the generic interaction row and delegates call-specific rendering to the injected widget.

The widget reads `interaction.customValues.sourceCallTranscriptId` and fetches `GET /api/call-transcripts/:id` directly (NOT through any customers-owned route). If the CF is absent (non-transcript-backed calls), the widget renders a fallback "no transcript available" state.

Layout of the expanded card:

1. **Header row**:
   - Provider icon + label ("Zoom call", "tl;dv call", …).
   - `occurredAt` as a human-readable timestamp (`useT` + `Intl.DateTimeFormat`).
   - `durationSec` formatted `HH:MM:SS` when present.
   - Primary action: **"Open in Zoom"** / **"Open in tl;dv"** / … as a `<Button asChild>` wrapping `<Link>` to the source meeting URL. Uses provider's `viewLabel`.
   - Secondary action: **"Reingest transcript"** (gated by `call_transcripts.manage`), uses `useGuardedMutation`.

2. **Participants strip**:
   - One pill per participant row from the `/api/call-transcripts/:id` response, rendered with `<StatusBadge>` and a `<Link>` when `customerEntityId` is set.
   - Matched: clickable → Person detail.
   - Unmatched: non-clickable pill + "Invite to CRM" affordance that opens the existing Person create dialog prefilled with `email`, `phone`, `displayName`. After create, both backfill subscribers match automatically; a toast confirms the participant is now linked.
   - Host participants show with a small `crown` icon (lucide).

3. **Transcript area**:
   - Full text rendered with preserved line breaks; collapsed to ~12 lines by default with a "Show full transcript" expand affordance.
   - Language chip in the top-right when `language` is set.
   - When `segments` present: a toggle switches to a segmented view (speaker, timestamp, text per row) using `<CollapsibleSection>`.
   - States: `<LoadingMessage>` when fetching, `<ErrorMessage>` on failure, `<EmptyState>` when no transcript (e.g. provider returned empty `text`).

4. **No `<AttachmentLibrary>` mount.** The earlier draft mounted `<AttachmentLibrary partition="customer-call-recordings" readOnly>` — removed because the transcript is no longer stored in the attachments module at all. Transcript rendering goes exclusively through the call_transcripts route above.

The "deep-link to a specific call" pattern (`/backend/customers/people/<id>#interaction-<callId>`) is handled by the customers timeline widget: it scrolls the matching row into view and triggers expand; the expanded row's injected `<CallTranscriptCard>` fetches on demand.

### Unmatched Transcripts inbox — `/backend/call-transcripts/unmatched` (call_transcripts module)

`packages/core/src/modules/call_transcripts/backend/call-transcripts/unmatched/page.tsx`:

- Header: `<PageHeader title={t('call_transcripts.unmatched.title')} />` with a count badge.
- `<DataTable>`:
  - Columns: Provider, Occurred At, Title, Participants (comma-joined first 3 emails/phones + "…N more"), Created At, row actions.
  - Row action: **Claim** — opens the Claim dialog.
  - Bulk action: **Dismiss** — soft-dismisses rows (sets `status='dismissed'`), feature-gated by `call_transcripts.unmatched.resolve`.
  - Default `pageSize: 25`, max 100 per OM rules.
  - `emptyState`: `<EmptyState title={t('call_transcripts.unmatched.empty.title')} description={t('call_transcripts.unmatched.empty.description')} />`.
  - Filters: provider dropdown, status dropdown.

Claim dialog:
- `<FormField label={t('call_transcripts.unmatched.claim.person_label')} required>` — Person async-search picker. Queries the customers module's existing person-search API.
- `<FormField label={t('call_transcripts.unmatched.claim.company_label')}>` — Company async-search picker, optional.
- `<FormField label={t('call_transcripts.unmatched.claim.deal_label')}>` — Deal async-search picker scoped to the selected Person/Company, optional.
- Submit runs `POST /api/call-transcripts/unmatched/:id/resolve`.
- On success: close dialog, flash success, row disappears from the table (live event `call_transcripts.transcript.ingested` with `projectionStatus: 'projected'`).
- On error: inline `<Alert variant="destructive">` inside the dialog.

Notification: the `notify-unmatched-transcript` subscriber's in-app notification links directly to this page when clicked.

### Person / Company / Deal timeline widget updates (customers module)

The existing timeline widgets switch their data source to `GET /api/customers/interactions/timeline?subjectKind=&subjectId=` (the dedicated route from §API Contracts). This is server-side query rewriting via a real route, NOT a response enricher (response enrichers are additive-only and cannot widen result sets — see Architectural Review Response, finding #3).

Each timeline row whose `interactionType='call'` hosts the injected `<CallTranscriptCard>` (owned by call_transcripts — see above). Call rows display with a `phone` icon and provider tag in the collapsed state; expanding mounts the widget which fetches transcript content on demand.

Performance: one indexed lookup on `customer_interaction_participants(organization_id, tenant_id, customer_entity_id)` plus a bounded join through `customer_people` / `customer_companies` / `customer_deals` for company/deal subjects.

### Sidebar menu item

Add `unmatched_transcripts` menu item into the main sidebar via widget injection from `call_transcripts/widgets/injection/menu-item.tsx` (spot `menu:sidebar:settings`):
- Icon: `inbox` (lucide).
- Link: `/backend/call-transcripts/unmatched`.
- Badge: live count of `status='pending'` rows per tenant; `useAppEvent('call_transcripts.transcript.unmatched')` + `useAppEvent('call_transcripts.unmatched.resolved')` to auto-refresh.

---

## Internationalization

Keys split by owning module. Transcript-module UI keys live under `call_transcripts.*` (file: `packages/core/src/modules/call_transcripts/i18n/<locale>.json`). Customers-module keys stay under `customers.*`. Provider-package keys live under `transcription_<vendor>.*` per each sub-spec.

### `call_transcripts` module keys

```
call_transcripts.title
call_transcripts.open_in_provider          // "Open in {{provider}}"
call_transcripts.reingest                  // "Reingest transcript"
call_transcripts.reingest_confirm          // confirm dialog
call_transcripts.transcript_tab            // "Transcript"
call_transcripts.segments_tab              // "Segments"
call_transcripts.language_chip             // "{{language}}"
call_transcripts.empty.title
call_transcripts.empty.description

call_transcripts.participants.title        // "Participants"
call_transcripts.participants.matched      // a11y label on matched pill
call_transcripts.participants.unmatched    // a11y label on unmatched pill
call_transcripts.participants.host_badge
call_transcripts.participants.invite_to_crm
call_transcripts.participants.manually_link

call_transcripts.unmatched.title
call_transcripts.unmatched.description
call_transcripts.unmatched.empty.title
call_transcripts.unmatched.empty.description
call_transcripts.unmatched.claim                     // row action label
call_transcripts.unmatched.claim_dialog.title
call_transcripts.unmatched.claim.person_label
call_transcripts.unmatched.claim.person_required
call_transcripts.unmatched.claim.company_label
call_transcripts.unmatched.claim.deal_label
call_transcripts.unmatched.claim.submit
call_transcripts.unmatched.claim.error.person_not_found
call_transcripts.unmatched.dismiss
call_transcripts.unmatched.notifications.new

call_transcripts.audit.ingest                        // audit log
call_transcripts.audit.reingest
call_transcripts.audit.resolve_unmatched
customers.audit.interaction_participants.manually_link
```

Translatable fields: **CREATE** both `packages/core/src/modules/customers/translations.ts` (verified absent today per ANALYSIS finding #7) and `packages/core/src/modules/call_transcripts/translations.ts`.

```ts
// packages/core/src/modules/customers/translations.ts
export const translatableFields: Record<string, string[]> = {
  'customers:customer_interaction': ['title'],
}

// packages/core/src/modules/call_transcripts/translations.ts
export const translatableFields: Record<string, string[]> = {
  'call_transcripts:call_transcript': ['title'],
}
```

Run `yarn generate` after creation. Participant rows are machine-generated and not user-translatable.

---

## Access Control

Features split by owning module.

### `call_transcripts` module (`packages/core/src/modules/call_transcripts/acl.ts`)

```
call_transcripts.view               // read transcripts + unmatched inbox entries
call_transcripts.manage             // reingest, resolve, dismiss
call_transcripts.unmatched.resolve  // claim unmatched transcripts
```

Default role assignments (seeded in `call_transcripts/setup.ts` `defaultRoleFeatures`):

| Feature | superadmin | admin | manager | employee |
|---|:-:|:-:|:-:|:-:|
| `call_transcripts.view` | ✓ | ✓ | ✓ | ✓ |
| `call_transcripts.manage` | ✓ | ✓ | ✓ | — |
| `call_transcripts.unmatched.resolve` | ✓ | ✓ | ✓ | — |

### `customers` module (no new features for transcript handling)

No new feature IDs in customers. The existing `customers.interactions.view` / `customers.people.view` / `customers.companies.view` / `customers.deals.view` continue to gate the timeline union. `customers.interactions.manage` gates the new `customers.interactions.create_from_transcript` / `update_from_transcript` / `delete_from_transcript` commands.

### Provider packages

Each transcription-provider package declares its own ACL features aligned to the OM provider-package convention (`<module>.view` + `<module>.configure`), verified against `packages/gateway-stripe/src/modules/gateway_stripe/acl.ts`. Convention:

```
transcription_<vendor>.view        // read-only access to the provider's integrations card
transcription_<vendor>.configure   // install / reconfigure / rotate / disconnect the provider
```

Webhook intake routes are NOT gated by ACL features — they're signature-authenticated against the tenant's vaulted secret via `WebhookEndpointAdapter.verifyWebhook`. This applies to every `packages/transcription-<vendor>` sub-spec.

Default role seeding per provider: `admin` + `superadmin` get `.configure`; plus `manager` for `.view`. Individual sub-specs MAY tighten (never loosen) these defaults.

Specifics per provider:
- Zoom: see `.ai/specs/2026-04-22-transcription-zoom-adapter.md` §Access Control.
- tl;dv: see `.ai/specs/2026-04-22-transcription-tldv-adapter.md` §Access Control.

Routes and pages use **declarative guards** (`requireAuth`, `requireFeatures`) from page metadata — never `requireRoles` per the OM security rule.

---

## Backward Compatibility

Reviewed against the 13 contract surfaces in `BACKWARD_COMPATIBILITY.md`. All changes are **additive**. No deprecations, no bridges needed.

| # | Surface | Classification | This spec's changes |
|---|---|---|---|
| 1 | Auto-discovery file conventions | FROZEN | No changes — new files follow existing conventions. New `call_transcripts` module is added via the standard module scaffold. |
| 2 | Type definitions & interfaces | STABLE | Additive only: `CallTranscriptProvider<T>`, `TranscriptResult`, `ProviderCtx<T>`, `RecordingSummary` — exported from `@open-mercato/shared/modules/call_transcripts/provider`. |
| 3 | Function signatures | STABLE | No changes to existing signatures. New: `registerCallTranscriptProvider(adapter)` — additive registry function. |
| 4 | Import paths | STABLE | New: `@open-mercato/shared/modules/call_transcripts/provider` (re-export of the new module's provider-contract.ts). Not moved from an older path — never existed before. |
| 5 | Event IDs | FROZEN | Additive only: 7 new event IDs in `call_transcripts.*` namespace + 1 in `customers.*` (`customers.interaction_participant.matched`). None reused. |
| 6 | Widget injection spot IDs | FROZEN | New spot `customers:timeline:interaction` (owned by customers) consumed by call_transcripts. `menu:sidebar:settings` existing spot reused for the inbox link. |
| 7 | API route URLs | STABLE | Additive only: 5 new routes under `/api/call-transcripts/*`, 1 new under `/api/customers/interactions/timeline`. Shared webhook route `/api/webhooks/inbound/[endpointId]` is existing. No per-provider webhook routes introduced (retired from the earlier draft). |
| 8 | Database schema | ADDITIVE-ONLY | 3 new tables in `call_transcripts` (aggregate + participants + unmatched), 1 new junction in `customers` (`customer_interaction_participants`), 4 new `customer_interaction` custom fields. No renames, no drops. |
| 9 | DI service names | STABLE | New: `customerMatchingService` (customers, resolved by call_transcripts), `callTranscriptIngestService` (call_transcripts), `callTranscriptProjectionService` (call_transcripts). No DI multi-provider token — the earlier `callTranscriptProviders` token is retired in favor of the module-level registry function. |
| 10 | ACL feature IDs | FROZEN | 3 new feature IDs in `call_transcripts.*` + 2 per provider package (`transcription_<vendor>.*`). No new IDs in customers. |
| 11 | Notification type IDs | FROZEN | 1 new type `call_transcripts.unmatched_transcript` (moved from the retired `customers.unmatched_transcript` draft id). |
| 12 | CLI commands | STABLE | No new CLI in v1 (future optional: `yarn mercato call-transcripts reingest <id>`). |
| 13 | Generated file contracts | STABLE | No changes to generator output shapes. New module participates in standard `yarn generate`. |
| — | `IntegrationHubId` union | STABLE | Additive: new value `'call_transcripts'` in `packages/shared/src/modules/integrations/types.ts`. Extending a union type is additive per BC rules. |

Release notes entry:
> **CRM Call Transcriptions (OSS).** Added automatic ingestion of call transcripts from external meeting tools. New dedicated core module `call_transcripts` (transcript aggregate, provider registry, ingest pipeline, unmatched inbox); new provider packages `@open-mercato/transcription-zoom` + `@open-mercato/transcription-tldv` registered via `registerCallTranscriptProvider` + `registerWebhookEndpointAdapter`. CRM projection via `customers.interactions.create_from_transcript`. New tables: `call_transcripts`, `call_transcript_participants`, `call_transcript_unmatched`, `customer_interaction_participants`. New events: `call_transcripts.transcript.*`, `customers.interaction_participant.matched`. All changes additive.

---

## Risks & Impact Review

| Risk | Severity | Affected area | Mitigation | Residual |
|---|---|---|---|---|
| Provider webhook spoofing | High | Security | Provider packages' `WebhookEndpointAdapter.verifyWebhook` MUST verify signatures; the shared inbound route rejects on mismatch with 401. The shared pipeline also applies rate limiting + dedup. | Low |
| PII leakage via transcripts (health, religion, etc. in call content) | High | Privacy / GDPR | `CallTranscript.text` encrypted at rest via `call_transcripts/encryption.ts`; participants email/phone encrypted via `call_transcripts/encryption.ts` and (on the CRM side) `customers/encryption.ts` with hash columns; ACL-gated read route `GET /api/call-transcripts/:id` requires `call_transcripts.view`; source-tool consent prompt is the capture point. | Medium — OM cannot enforce consent the tool didn't capture. |
| **Cross-module ACL leak via customers read paths** | High | Security | The customers module NEVER stores or returns transcript text — it stores only `sourceCallTranscriptId` (a uuid). The `<CallTranscriptCard>` widget fetches the transcript from `/api/call-transcripts/:id` which is independently ACL-gated. A user with `customers.interactions.view` but without `call_transcripts.view` sees the call row in the timeline but gets 403 when trying to expand the transcript — matches the intended least-privilege split. | Low |
| Email matching false positive (shared inbox alias like `sales@acmeco.com` matched to a dummy Person) | Medium | Data quality | Exact match only — no fuzzy, no domain-based fallback. `CustomerMatchingService.matchParticipants` requires exact `primary_email_hash` match. Warn in admin UI when a matched email is flagged as role-account in the dictionaries. | Low |
| Queue saturation on bulk backfill (tenant imports 10k People, both subscribers fire 10k matching passes each) | Medium | Performance | Customers-side subscriber batches 200 rows per emission; call_transcripts-side subscriber batches its staging queries; both workers concurrency-capped per-tenant; events are `persistent: true` so queue retries absorb spikes. | Low |
| Idempotency breakage on provider replay (Zoom replays `recording.transcript_completed` webhook) | Medium | Data quality | `call_transcripts.ingest` keys on UNIQUE `(tenantId, providerKey, externalRecordingId)`; duplicate submissions return `{status: 'duplicate'}`. Shared webhook pipeline also dedups on messageId. | Low |
| Stale provider credentials mid-polling | Low | Reliability | Polling worker catches auth errors, marks the integration as `needs_reconnect` in the integrations vault, notifies admins. | Low |
| Retroactive match latency for bulk imports | Low | UX | Both backfill subscribers are persistent + batched; UX accepts that a bulk-imported 10k contact set may take minutes before historical calls surface. | Low |
| GDPR right-to-forget on a Person with historical transcripts | Medium | Privacy | Deleting a Person: `customer_interaction_participants` rows cascade (FK ON DELETE CASCADE). Interactions where the deleted person was primary: `customers` runs its existing interaction-orphan policy per SPEC-046b. Transcript aggregate (`call_transcripts.text`) retained per tenant retention policy; revert to `projection_status='unmatched'` with operator review. | Medium — requires documented operator flow. |
| Transcript indexing cost (1-hour Zoom call ≈ 30k chars) | Low | Performance | Transcript body NOT indexed in v1 (scope-reduced per §Search). Vector embeddings explicitly out of scope. | Low |
| Webhook handler downtime loses transcripts | Medium | Reliability | Polling fallback catches up within the polling interval. Provider packages SHOULD surface a missed-ingestion indicator in the admin UI. Shared webhook pipeline's queue retries also buffer transient outages. | Low |
| Cross-module projection failure (customers projection fails after transcript aggregate committed) | Medium | Data consistency | Two-phase commit with a durable recovery path (see §4 "Transaction model"). Phase A commits the transcript aggregate atomically; Phase C commits the customers projection in its own transaction. On Phase C failure the transcript row sits at `projection_status='projection_failed'` with `last_error`; a persistent recovery subscriber retries with exponential backoff; after N retries the transcript falls back to `projection_status='unmatched'` and surfaces in the inbox. No silently orphaned transcripts. A future `commandBus.runInShared(em, …)` primitive would let Phase A+C commit as one transaction — tracked as a separate platform concern. | Low to Medium — visible failure mode documented; operator has a clear recovery path. |
| Projection retries storm during a sustained customers outage | Low | Reliability | Recovery subscriber uses exponential backoff (1m → 30m capped). `call_transcripts.transcript.projection_failed` events surface to operators via the standard notification pipeline. | Low |

---

## Integration Test Coverage

Tests live in `packages/core/src/modules/customers/__integration__/` and `packages/transcription-zoom/src/__integration__/`, per `.ai/qa/AGENTS.md`. Each test is self-contained: fixtures created via API in setup, cleaned up in teardown, no reliance on seed data.

### API / pipeline tests (`customers` module)

| ID | Path | Covers |
|---|---|---|
Tests split by owning module: `call_transcripts/__integration__/` for the transcript pipeline and inbox; `customers/__integration__/` for the projection command + timeline; each provider package owns its own tests.

### API / pipeline tests (`call_transcripts` module)

| ID | Path | Covers |
|---|---|---|
| TC-CT-001 | `call_transcripts.ingest` command, happy path (all match) | `CallTranscript` + raw participants created; `customers.interactions.create_from_transcript` invoked; `customers.interaction_participant.matched` rows written; events `call_transcripts.transcript.ingested` (projected) + `call_transcripts.transcript.projected` fired. |
| TC-CT-002 | Ingest with zero matches | `CallTranscript.projection_status='unmatched'`, `call_transcript_unmatched` row written; `call_transcripts.transcript.unmatched` fired; no customers write. |
| TC-CT-003 | Ingest with partial matches | Matched + unmatched CRM participants coexist; primary chosen by precedence. |
| TC-CT-004 | Primary selection precedence | Deterministic tie-breakers (single active deal → most-recent deal → first matched). |
| TC-CT-005 | Idempotent replay | Same `(tenantId, providerKey, externalRecordingId)` ingested twice → second returns `{status:'duplicate'}`; no new CRM rows. |
| TC-CT-006 | Reingest overwrite | `call_transcripts.reingest` refetches via provider, overwrites `text` + `segments`, invokes `customers.interactions.update_from_transcript`; old snapshot recoverable via undo. |
| TC-CT-007 | Unmatched list + resolve | List → claim with person → `customers.interactions.create_from_transcript` invoked; `call_transcript_unmatched.status='resolved'`, `resolvedToInteractionId` set. |
| TC-CT-008 | Unmatched resolve with deleted person (409) | Person deleted between list and resolve → 409 + localized error code. |
| TC-CT-009 | Retroactive match on Person create (transcript side) | Unmatched transcript row with participant email X → create Person with `primary_email=X` → `backfill-unmatched` subscriber triggers `resolve_unmatched`; projection runs. |
| TC-CT-010 | Retroactive match on email update (transcript side) | Existing Person's email updated to match → `backfill-unmatched` still triggers. |
| TC-CT-011 | ACL gating (transcript read) | User without `call_transcripts.view` gets 403 on `GET /api/call-transcripts/:id`. |
| TC-CT-012 | ACL gating (unmatched) | User without `call_transcripts.unmatched.resolve` cannot list/claim. |
| TC-CT-013 | Undo `call_transcripts.ingest` | Chain-undo deletes customers projection AND call_transcripts rows. |
| TC-CT-014 | Undo `resolve_unmatched` | Recreates staging row from snapshot; un-projects from customers. |
| TC-CT-015 | Encrypted fields round-trip | `CallTranscript.text`, `CallTranscriptParticipant.email`/`.phone`/`.display_name` encrypted on write, decrypted on authorized read. |
| TC-CT-016 | Transaction atomicity | Forced customers-projection failure → outer transaction rolls back → no orphan `CallTranscript` row; caller receives 500. |
| TC-CT-017 | Unmatched inbox notification | `call_transcripts.transcript.unmatched` → notification of type `call_transcripts.unmatched_transcript` created for eligible users. |
| TC-CT-018 | Dismiss unmatched | `DELETE /api/call-transcripts/unmatched/:id` sets `status='dismissed'`; transcript aggregate retained. |

### API / pipeline tests (`customers` module)

| ID | Path | Covers |
|---|---|---|
| TC-CRM-CT-001 | `customers.interactions.create_from_transcript` command happy path | `CustomerInteraction` + N `CustomerInteractionParticipant` rows created with hash columns + `sourceCallTranscriptId` CF; `customers.interaction.created` fired. |
| TC-CRM-CT-002 | Participant CHECK constraint | Insert with both `email=null` and `phone=null` → DB rejects. |
| TC-CRM-CT-003 | Encrypted fields round-trip | Participant `email` / `phone` / `display_name` encrypted on write, decrypted on authorized read. |
| TC-CRM-CT-004 | Timeline union on Person page | Person is in participants junction but not primary → appears on timeline. |
| TC-CRM-CT-005 | Timeline union on Deal page | Deal linked via a participant's Person → appears on deal timeline. |
| TC-CRM-CT-006 | Retroactive match on Person create (CRM side) | Participant row with email X, `customer_entity_id=NULL` → create Person with `primary_email=X` → `backfill-interaction-participant` subscriber updates the row; `customers.interaction_participant.matched` fired. |
| TC-CRM-CT-007 | Retroactive match on email update (CRM side) | Existing Person's email updated to match → backfill still triggers. |
| TC-CRM-CT-008 | Global search hit | Searching by interaction title ("Zoom call with Acme") and by provider source → search API returns the matching interaction. Searching by a phrase that appears ONLY inside the transcript body returns no hit (transcript body is not indexed in v1 — see §Search configuration). |
| TC-CRM-CT-009 | Timeline ACL gating | User with `customers.interactions.view` but without `customers.people.view` gets 403 on `GET /api/customers/interactions/timeline?subjectKind=person&subjectId=…`. |

### UI tests (Playwright)

UI tests span both modules because the user-visible flow crosses them. File placement follows ownership: tests that exercise `<CallTranscriptCard>` live in `call_transcripts/__integration__/ui/`; tests that exercise the timeline query live in `customers/__integration__/ui/`.

| ID | Module | Flow |
|---|---|---|
| TC-CT-UI-001 | call_transcripts | **Person timeline expansion**: expanding a `call` row mounts the injected `<CallTranscriptCard>`; transcript text + language chip render after fetch from `GET /api/call-transcripts/:id`. |
| TC-CT-UI-002 | call_transcripts | **`<CallTranscriptCard>` deep-link**: "Open in Zoom" button targets the `sourceMeetingUrl` returned by the transcript API. |
| TC-CT-UI-003 | call_transcripts | **Invite-to-CRM affordance**: unmatched participant pill → "Invite to CRM" creates Person draft, both backfill subscribers match on save, pill turns into a clickable Person link via SSE refresh. |
| TC-CT-UI-004 | call_transcripts | **Unmatched inbox**: DataTable renders pending rows; `Claim` dialog opens; Cmd+Enter submits; row disappears via live event. |
| TC-CT-UI-005 | call_transcripts | Unmatched inbox empty state renders per DS rules. |
| TC-CT-UI-006 | call_transcripts | Sidebar badge updates live on new unmatched arrival (SSE). |
| TC-CT-UI-007 | call_transcripts | Escape cancels Claim dialog; focus returns to the triggering row action. |
| TC-CT-UI-008 | call_transcripts | Reingest button on `<CallTranscriptCard>` is hidden for users lacking `call_transcripts.manage`. |
| TC-CT-UI-009 | call_transcripts | **ACL on transcript route**: a user without `call_transcripts.view` gets 403 on `GET /api/call-transcripts/:id`; the card shows `<ErrorMessage>` accordingly. |
| TC-CRM-CT-UI-001 | customers | **Timeline union**: a call where the subject is in the participants junction (not the primary entity) appears in the timeline by virtue of `GET /api/customers/interactions/timeline`. |
| TC-CRM-CT-UI-002 | customers | **Deep-link**: navigating to `/backend/customers/people/<id>#interaction-<callId>` scrolls the matching row into view and auto-expands its injected `<CallTranscriptCard>`. |
| TC-CRM-CT-UI-003 | customers | **Timeline ACL gating**: a user with `customers.interactions.view` but without `customers.people.view` gets 403 on `GET /api/customers/interactions/timeline?subjectKind=person&subjectId=…`. |

### Provider package tests

Each `packages/transcription-<vendor>` adapter owns its own test matrix. Test IDs are namespaced per provider (`TC-ZOOM-*`, `TC-TLDV-*`, …) and are defined in the respective sub-spec:

- Zoom: `.ai/specs/2026-04-22-transcription-zoom-adapter.md` §Integration Test Coverage (TC-ZOOM-001..019 + UI-001..004).
- tl;dv: `.ai/specs/2026-04-22-transcription-tldv-adapter.md` §Integration Test Coverage (TC-TLDV-001..018 + UI-001..002).

The parent spec's test matrix (above) covers only the customers-module pipeline and the module-agnostic contract; provider-specific signature verification, VTT parsing, URL-validation handshakes, plan-gate checks, etc. live in the sub-specs. An implementer of a new transcription provider does not need a parent-spec test entry — they define their adapter's tests in their own sub-spec.

---

## Implementation Phases

Each phase produces a running, testable app increment. A phase is only "done" when all tests in its scope pass and the code-review gate succeeds. Phases ordered to establish module boundaries first, then layer UX and providers on top.

### Phase 1 — `call_transcripts` module scaffold + contract + hub

1. Scaffold `packages/core/src/modules/call_transcripts/` per `om-module-scaffold` conventions. Register it in `apps/mercato/src/modules.ts`.
2. Declare entities in `call_transcripts/data/entities.ts`: `CallTranscript`, `CallTranscriptParticipant`, `CallTranscriptUnmatched` (all three with `email_hash`/`phone_hash` columns + CHECK constraint on participants).
3. **CREATE** `call_transcripts/encryption.ts` with the `text` + participant-email/phone/display_name maps.
4. Register ACL features in `call_transcripts/acl.ts` + defaults in `call_transcripts/setup.ts`.
5. Declare events in `call_transcripts/events.ts` (7 new IDs per §Commands & Events).
6. **CREATE** `call_transcripts/translations.ts` with `call_transcripts:call_transcript.title`.
7. Create `call_transcripts/lib/provider-contract.ts` (`CallTranscriptProvider<TCredentials>` + `TranscriptResult` + `RecordingSummary` + `JsonValue` + zod schemas). Re-export from `packages/shared/src/modules/call_transcripts/provider.ts` for third-party packages.
8. Create `call_transcripts/lib/adapter-registry.ts` with `registerCallTranscriptProvider` / `getCallTranscriptProvider` / `listCallTranscriptProviders`.
9. **Register the `call_transcripts` marketplace hub**:
    - Extend `IntegrationHubId` union in `packages/shared/src/modules/integrations/types.ts` with `'call_transcripts'`.
    - Extend `INTEGRATION_MARKETPLACE_CATEGORIES` in `packages/core/src/modules/integrations/backend/integrations/filters.ts`.
    - Add `integrations.marketplace.categories.call_transcripts` copy for every locale shipped today.
    - Add a `call_transcripts` icon mapping (lucide `phone` fallback).
    - Seed the hub descriptor in `packages/core/src/modules/integrations/lib/hubs.ts`.
10. Integration tests TC-CT-002 (unmatched), TC-CT-005 (idempotent), TC-CT-011 (ACL), TC-CT-015 (encryption), TC-CT-016 (transaction atomicity) — exercised via a stub provider (`call_transcripts/lib/__tests__/stub-provider.ts`) registered in tests only.
11. Run `yarn generate` + `yarn db:generate` + commit the generated migration. Run `yarn mercato configs cache structural --all-tenants`.

**Result**: `call_transcripts` module is a running, stubbable core module with its data model, encryption, ACL, events, and provider registry. Empty of real providers and UI. Other teams can now ship provider packages against a stable contract.

### Phase 2 — `customers` module projection surface

1. Declare entity `CustomerInteractionParticipant` with `email_hash` / `phone_hash` columns + CHECK constraint in `customers/data/entities.ts`.
2. Declare custom field `sourceCallTranscriptId` (uuid) + `durationSec` + `direction` + `sourceProvider` on `customer_interaction` in `customers/ce.ts`.
3. **EXTEND** `customers/encryption.ts` with the participants entry.
4. Declare event `customers.interaction_participant.matched` in `customers/events.ts`.
5. Create commands in `customers/commands/interactions-from-transcript.ts`: `customers.interactions.create_from_transcript`, `.update_from_transcript`, `.delete_from_transcript` (all undoable).
6. Create service `CustomerMatchingService` in `customers/lib/matching-service.ts` (read-only, registered in DI as `customerMatchingService`). Exposes `matchParticipants(tenantId, organizationId, participants[])`.
7. Create command `customers.interaction_participants.manually_link`.
8. Create route `GET /api/customers/interactions/timeline?subjectKind=&subjectId=` in `customers/api/GET/interactions/timeline.ts`.
9. Create interceptor `customers/api/interceptors.ts` handling `participantOf=<uuid>` query param → resolves union into `query.ids`.
10. Create subscriber `customers/subscribers/backfill-interaction-participant.ts`.
11. Integration tests TC-CRM-CT-001..007, 009 + TC-CRM-CT-UI-001 (timeline union).
12. Run `yarn generate` + `yarn db:generate`.

**Result**: customers module exposes the projection command API and matching service. The `call_transcripts.ingest` command now has a real target; the timeline union route is ready for downstream widgets.

### Phase 3 — `call_transcripts.ingest` command + routes + inbox

1. Create command `call_transcripts.ingest` in `call_transcripts/commands/ingest.ts` (Phase A + B + C from §4 above, with `withAtomicFlush` and the customers-projection command bus invocation).
2. Create commands `call_transcripts.resolve_unmatched`, `call_transcripts.reingest`, `call_transcripts.dismiss_unmatched`.
3. Create routes:
   - `POST /api/call-transcripts/ingest` (service-to-service, api-key + `call_transcripts.manage`).
   - `GET /api/call-transcripts/:id` (ACL: `call_transcripts.view`).
   - `POST /api/call-transcripts/:id/reingest` (ACL: `call_transcripts.manage`).
   - `GET /api/call-transcripts/unmatched` + `POST /api/call-transcripts/unmatched/:id/resolve` + `DELETE /api/call-transcripts/unmatched/:id` (all ACL: `call_transcripts.unmatched.resolve`).
4. Create backend page `/backend/call-transcripts/unmatched` with DataTable, Claim dialog, Dismiss bulk action.
5. Create subscribers `call_transcripts/subscribers/backfill-unmatched.ts` and `.../notify-unmatched-transcript.ts`. Declare notification type `call_transcripts.unmatched_transcript` in `call_transcripts/notifications.ts`.
6. Create `<CallTranscriptCard>` component in `call_transcripts/components/CallTranscriptCard.tsx` + widget injection at `customers:timeline:interaction` spot via `call_transcripts/widgets/injection/timeline-call-card.tsx`.
7. Create sidebar menu item widget injection for the inbox badge.
8. Integration tests TC-CT-001, 003, 004, 006, 007, 008, 009, 010, 012, 013, 014, 017, 018 + TC-CT-UI-001..009.

**Result**: end-to-end ingest pipeline working against the stub provider. Inbox UI, `<CallTranscriptCard>`, and sidebar badge live. No real provider yet.

### Phase 4 — Zoom provider package

Phase 4 is specified in detail in the dedicated Zoom sub-spec `.ai/specs/2026-04-22-transcription-zoom-adapter.md`. Summary:

1. `packages/transcription-zoom/` scaffolded per OM provider-package convention.
2. `provider.ts` implements `CallTranscriptProvider.fetchTranscript` + `.listRecentRecordings` (VTT parse, plan gate).
3. `webhook-adapter.ts` implements `WebhookEndpointAdapter` (HMAC-SHA256 verification, URL-validation handshake, signed-tenant-token URL).
4. `di.ts` registers both via `registerCallTranscriptProvider` + `registerWebhookEndpointAdapter`.
5. `workers/poll-zoom.ts` — scheduled worker.
6. `integration.ts` — SPEC-045 marketplace entry under `hub: 'call_transcripts'`.
7. `acl.ts` — `transcription_zoom.view`, `transcription_zoom.configure`.
8. i18n for provider copy.
9. Integration tests TC-ZOOM-001..018 (mocked Zoom API).
10. `.env.example` documents `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET`, `ZOOM_WEBHOOK_SECRET_TOKEN`.

**Result**: a tenant connects Zoom in Integrations Marketplace; real Zoom meetings ingest automatically end-to-end via the shared webhook pipeline → `call_transcripts.ingest` → customers projection.

### Phase 5 — tl;dv provider package

Phase 5 is specified in detail in the dedicated tl;dv sub-spec `.ai/specs/2026-04-22-transcription-tldv-adapter.md`. Same structure as Zoom but per-user credentials in a provider-owned table and shared-secret-header webhook verification. All integration points go through the same `WebhookEndpointAdapter` contract — no parent-spec changes required.

### Phase 6 — Polish + search + hardening

1. i18n pass for `pl` locale (user is Polish-speaking) — both `call_transcripts` and `customers` namespaces.
2. Extend `customers/search.ts` with the `customers:customer_interaction` entry from §Search config (indexes `title` + `source` only). Reindex existing call interactions via `yarn mercato search reindex --entity customers:customer_interaction`.
3. Full `__integration__` test sweep across both modules + both provider packages; address flakes.
4. Code-review gate (`om-code-review`) on all four packages (`call_transcripts`, `customers`, `transcription-zoom`, `transcription-tldv`).
5. Release notes entry.
6. Spec changelog updated; move spec + sub-specs to `.ai/specs/implemented/` after deploy.

**Result**: feature-complete, release-ready.

---

## Assumptions

1. **Ingest is fully automatic** — provider webhook (primary) + polling fallback. No manual upload.
2. **Provider scope v1**: Zoom + tl;dv ship together as reference adapters; all others are community-driven follow-ups.
3. **OM does not transcribe.** The interface has `fetchTranscript` only; no `transcribe(audio)`.
4. **Retention**: OM keeps transcripts forever by default. Audio/video lives on the source tool.
5. **Consent**: captured by the source tool; OM only stores what's provided.
6. **Diarization**: transcript as single blob; segments passed through when supplied.
7. **Routing**: email + phone deterministic, many-to-many via junction. Polymorphic from day one to unblock v2 CTI.
8. **Retroactive matching**: two persistent subscribers (one per module) on Person create/update.
9. **Unmatched inbox**: human-claim required when zero matches.
10. **ACL**: new features `call_transcripts.view|manage|unmatched.resolve` in the transcript module; provider packages add their own `transcription_<vendor>.*` pair.
11. **Credentials**: tenant-scoped credentials live in the SPEC-045 integrations vault. Provider packages whose authentication model is per-user (e.g. tl;dv) own their own encrypted credentials table inside the provider package and store only a tenant-level enablement marker in the vault — the shared vault's `IntegrationScope` is tenant-scoped only.
12. **GDPR**: transcript content + participant email/phone encrypted at rest in BOTH the transcript aggregate AND the CRM projection.
13. **Real-time UX**: clientBroadcast on `call_transcripts.transcript.ingested` drives live refresh; no top-bar progress pill needed.
14. **Scope (v1)**: meeting-SaaS only. CTI / PBX, voicemail, SMS voice, LLM summaries, action items = out of scope.
15. **Module ownership**: `call_transcripts` owns transcript infrastructure; `customers` owns CRM interactions. Cross-module wiring is command-bus + read-only service — never direct ORM.

---

## Follow-up Tracks

Not in this spec; each gets its own.

- **CTI / PBX ingest (v2)** — Zammad-style Generic CTI via `packages/webhooks`. Adds a second provider interface `CallEventProvider` (start/answer/hangup events, caller-ID popup). Phone-number matching path already supported by v1's polymorphic participant identity. First adapter candidates: Twilio, Asterisk Generic CTI. Estimated +4–6 atomic commits per adapter.
- **Meetily adapter** — `packages/transcription-meetily`. On-device desktop app. Auth = per-user API key, not tenant OAuth. Implements `CallTranscriptProvider.fetchTranscript`; no webhook (desktop pushes to OM). ~2–3 atomic commits.
- **tl;dv adapter** — see dedicated sub-spec `.ai/specs/2026-04-22-transcription-tldv-adapter.md`. Live-API-verified provider profile (per-user `x-api-key`, `TranscriptReady` webhook, polling fallback). **Critical limitation captured**: tl;dv's `invitees[]` is empty for ad-hoc meetings → organizer-only deterministic matching by default; non-organizer speakers preserved as display-only segment metadata. v2 calendar-enrichment (Google Calendar / Outlook attendees lookup via `extraProperties.conferenceId`) is the long-term fix and gets its own spec.
- **Other meeting-SaaS providers** — `packages/transcription-meet`, `…-fireflies`, `…-otter`, `…-loom`, `…-gong`, `…-grain`. Each is one follow-up spec targeting the same `CallTranscriptProvider` contract.
- **AI-driven downstream features** — summaries, action-item extraction, sentiment, next-step suggestions, "what did we commit to?" digests. All layer on top via the unified AI tooling stack (`.ai/specs/2026-04-11-unified-ai-tooling-and-subagents.md`) reading `call_transcripts:call_transcript.text` via a new minimal tool pack. No data model changes needed.
- **Retention worker** — OM-side transcript pruning (e.g. delete transcripts older than N months). Separate spec.
- **Vector embeddings over transcripts** — semantic search. Uses existing `search` module vector strategy. Separate spec once AI tooling lands.
- **Transcript export** — per-user or per-deal "give me all transcripts as a zip." Low priority.
- **Provider-side mutations** — e.g. "delete transcript in Zoom when deleted in OM." Deferred until demand is concrete; introduces mutation-capable provider interface.

---

## Downstream alignment — Unified AI Tooling (PR #1478 / 2026-04-11 spec)

Verified. No architectural conflict.

- Transcripts live in the new `call_transcripts.text` column (encrypted at rest). The unified AI spec's focused-agent stack can fetch transcripts via a new minimal tool pack keyed on `call_transcripts:call_transcript` — simpler than the original "read Attachment.content" path, because the AI agent can identify transcript records directly by entityId.
- Future focused agents (`customers.sales-intel`, `customers.call-summarizer`, …) can read transcripts via the planned baseline tool pack. No additional AI tools required by this spec.
- AI-driven mutations are deferred in the unified AI spec; our manual Reingest is a regular user action, not an agent action.

This spec ships independently; the AI stack layers on top when its own implementation lands.

---

## Final Compliance Report — 2026-04-22 (revised after PR #1645 module-split)

### AGENTS.md Files Reviewed

- `AGENTS.md` (root)
- `packages/core/AGENTS.md`
- `packages/shared/AGENTS.md`
- `packages/core/src/modules/customers/AGENTS.md`
- `packages/core/src/modules/integrations/AGENTS.md`
- `packages/core/src/modules/payment_gateways/AGENTS.md` (pattern reference)
- `packages/core/src/modules/data_sync/AGENTS.md` (pattern reference)
- `packages/search/AGENTS.md`
- `packages/webhooks/AGENTS.md`
- `packages/events/AGENTS.md`
- `packages/cache/AGENTS.md`
- `packages/queue/AGENTS.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|---|---|---|---|
| root AGENTS.md | Entities singular, tables plural snake_case | Compliant | `CallTranscript` → `call_transcripts`; `CallTranscriptParticipant` → `call_transcript_participants`; `CallTranscriptUnmatched` → `call_transcript_unmatched`; `CustomerInteractionParticipant` → `customer_interaction_participants`. |
| root AGENTS.md | No direct ORM relationships between modules | Compliant | `CallTranscript.interactionId` and `CustomerInteraction.sourceCallTranscriptId` are FK IDs (not ORM relationships). Cross-module calls go via DI services + command bus. |
| root AGENTS.md | Filter by `organization_id` on every tenant-scoped query | Compliant | Every new entity carries `organization_id` + `tenant_id`; all routes and subscribers scope explicitly. |
| root AGENTS.md | DI (Awilix) — no direct `new` | Compliant | Providers registered via module-level `registerCallTranscriptProvider` (matching `registerGatewayAdapter` / `registerDataSyncAdapter` pattern — verified in codebase); services (`customerMatchingService`, ingest/projection services) resolved from the container. |
| root AGENTS.md | Event IDs `module.entity.action`, singular entity, past tense | Compliant | `call_transcripts.transcript.ingested`, `.unmatched`, `.projected`, `.reingested`, `customers.interaction_participant.matched`. |
| root AGENTS.md | `requireFeatures` (declarative), never `requireRoles` | Compliant | All new routes and pages use `requireFeatures`. |
| root AGENTS.md | No hardcoded user-facing strings (i18n only) | Compliant | Transcript module owns `call_transcripts.*` keys in `call_transcripts/i18n/`; provider packages own `transcription_<vendor>.*`. |
| root AGENTS.md | Cmd/Ctrl+Enter + Escape on every dialog | Compliant | Claim dialog and provider connect dialogs honor both shortcuts. |
| root AGENTS.md | DS rules — semantic tokens only, no arbitrary text sizes | Compliant | `<StatusBadge>`, `<Alert>`, `<EmptyState>`, `<LoadingMessage>` from `@open-mercato/ui`. |
| root AGENTS.md | Integration tests live alongside the feature, self-contained | Compliant | `packages/core/src/modules/call_transcripts/__integration__/` + `packages/core/src/modules/customers/__integration__/` + each provider's `__integration__/`. |
| root AGENTS.md | Generated files committed after `yarn generate` + `yarn db:generate` | Verify at PR time | Runtime gate — spec declares the files and commands to run. |
| root AGENTS.md | Integration providers own env-backed preconfiguration inside the provider package | Compliant | Zoom + tl;dv sub-specs continue to own their own `setup.ts` presets. |
| packages/core/AGENTS.md | Auto-discovered routes at `api/<method>/<path>.ts` | Compliant | New module follows convention; webhook intake uses the shared `@open-mercato/webhooks` route, NOT per-provider auto-discovered routes (retired). |
| packages/core/AGENTS.md | API routes MUST export `openApi` | Compliant | Every new route listed in §API Contracts with `openApi` asserted. |
| packages/core/AGENTS.md | CRUD write operations via Command pattern with undo | Compliant | 4 transcript commands + 4 customers commands declared with undo behavior documented. |
| packages/core/AGENTS.md | `withAtomicFlush` for multi-phase mutations | Compliant (single-module) | Phase A of `call_transcripts.ingest` wraps the `CallTranscript` + `CallTranscriptParticipant` + (optionally) `CallTranscriptUnmatched` writes inside one `withAtomicFlush` with `transaction: true` per SPEC-018. The cross-module Phase C (`customers.interactions.create_from_transcript`) commits in its own transaction — this is a deliberate limitation of the shipped command pattern, documented in §4 "Transaction model," not a violation. A future shared-transaction primitive would let the two phases join; tracked separately. |
| packages/core/AGENTS.md | ACL features in `acl.ts` + defaults in `setup.ts` | Compliant | 3 features in `call_transcripts.acl.ts`; defaults seeded in `call_transcripts/setup.ts`. |
| packages/core/AGENTS.md | Encryption maps updated when storing regulated fields | Compliant | New `call_transcripts/encryption.ts` + extended `customers/encryption.ts` for the CRM participant junction. |
| packages/core/AGENTS.md | `findWithDecryption` / `findOneWithDecryption` for encrypted rows | Compliant | Read-path discipline documented in §Encryption; search helper not needed in v1 (transcript body not indexed). |
| packages/core/AGENTS.md | Custom fields declared in `ce.ts` | Compliant | 4 new CFs on `customer_interaction` declared in §Data Models (`sourceCallTranscriptId`, `durationSec`, `direction`, `sourceProvider`). |
| packages/core/AGENTS.md | Events via `createModuleEvents` with `as const` | Compliant | 7 new events in `call_transcripts/events.ts`, 1 new event in `customers/events.ts`. |
| packages/shared/AGENTS.md | No `any` / `unknown` in shared types | Compliant | `CallTranscriptProvider<TCredentials>` is generic; `providerMetadata: Record<string, JsonValue>` with recursive `JsonValue` + `jsonValueSchema` / `providerMetadataSchema` zod exports re-exported from `@open-mercato/shared/modules/call_transcripts/provider`. |
| packages/shared/AGENTS.md | Narrow, typed interfaces | Compliant | Shared contract exports only the provider interface + result/summary/ctx types. |
| packages/search/AGENTS.md | Sensitive fields in `fieldPolicy.excluded` or `hashOnly` | Compliant | Transcript body NOT indexed (v1 scope). `customers:customer_interaction` config indexes only `title` + `source`. |
| packages/search/AGENTS.md | `checksumSource` in every `buildSource` return | Compliant | Declared in §Search configuration. |
| packages/search/AGENTS.md | `formatResult` for token strategy | Compliant | Declared in §Search configuration. |
| packages/core/src/modules/integrations/AGENTS.md | Provider packages remain provider-owned | Compliant | Provider infrastructure (registry, unmatched inbox, webhook adapter wiring) now lives in `call_transcripts`, not in `customers`. Providers themselves remain in `packages/transcription-<vendor>`. |
| packages/core/src/modules/integrations/AGENTS.md | `integration.ts` per provider with `hub` value | Compliant | New `call_transcripts` hub added to `IntegrationHubId`; each provider package declares `hub: 'call_transcripts'`. |
| packages/core/src/modules/integrations/AGENTS.md | Tenant-scoped credential vault | Compliant | Zoom stores tenant-scoped credentials in the vault. tl;dv (per-user) owns its own encrypted credentials table and stores only a tenant enablement marker in the vault. |
| packages/webhooks/AGENTS.md | Inbound webhooks use `WebhookEndpointAdapter` + shared route + rate-limit + dedup | **Compliant (revised)** | Previous draft violated this by introducing per-provider auto-discovered `/api/webhooks/transcription/<vendor>` routes. Revised design registers each provider's `WebhookEndpointAdapter` via `registerWebhookEndpointAdapter`; the shared `/api/webhooks/inbound/[endpointId]` route owns raw-body preservation, signature-verification delegation, dedup, and rate limiting. |
| packages/events/AGENTS.md | `clientBroadcast: true` only on UI-affecting events | Compliant | `call_transcripts.transcript.ingested` is broadcast; others are persistent-only. |
| packages/cache/AGENTS.md | Tag-based invalidation on writes | Compliant | CRUD side effects on `call_transcripts:call_transcript` and `customers:customer_interaction` fire cache aliases via `emitCrudSideEffects`. |
| packages/queue/AGENTS.md | Idempotent workers, concurrency declared | Compliant | Polling workers per sub-spec declare concurrency-1 per scope, idempotency via `call_transcripts` UNIQUE key. |
| SPEC-046b (interaction unification) | `CustomerInteraction` is CRM source-of-truth | Compliant | Spec preserves this: transcripts project INTO `CustomerInteraction` via a customers-owned command; CustomerInteraction is never downgraded to a "cache" of the transcript. |
| BACKWARD_COMPATIBILITY.md | All 13 contract surfaces — additive-only | Compliant | Full matrix in §Backward Compatibility. No renames, no drops, no breaking changes. The `IntegrationHubId` union gains `'call_transcripts'` — additive to an open union. |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Data models match API contracts | Pass | Ingest schema's `participants[]` matches junction CHECK constraint; timeline route returns the same shape as the list route. |
| API contracts match UI/UX section | Pass | `<CallTranscriptCard>` fetches `/api/customers/interactions/:id/transcript`; timeline widget calls `/api/customers/interactions/timeline`; Unmatched inbox calls resolve route. |
| Risks cover all write operations | Pass | Risks table covers ingest (replay idempotency), unmatched resolve, reingest, retroactive backfill, GDPR delete. |
| Commands defined for all mutations | Pass | 4 commands (`ingest`, `resolve_unmatched`, `reingest`, `manually_link`); undo contracts documented for each. |
| Cache strategy covers all read APIs | Pass | `emitCrudSideEffects` + `emitCrudUndoSideEffects` declared on every command. |
| User stories map to API / data / UI sections | Pass | Explicit mapping in §User Stories / Use Cases. |
| Specs internally consistent (parent ↔ sub-specs) | Pass | Cross-spec review 2026-04-22 closed all 6 findings; resolution tables in both `ANALYSIS-*.md`. |

### Non-Compliant Items

None at spec time.

### Verdict

**Fully compliant** — pre-implementation review passed. Runtime rows (generated files committed, migrations applied, integration tests green) are verified at implementation PR time per the standard workflow; they are not spec-level gates.

---

## Changelog

- **2026-04-21** — Initial skeleton (TLDR, Problem, Architecture, Open Questions gate).
- **2026-04-22** — Q1/Q2/Q3/Q-NEW resolved. Reframed around email-deterministic many-to-many routing + automatic webhook ingest + unmatched inbox + retroactive matching. Zoom chosen as v1 reference adapter.
- **2026-04-22** — Research pass + Mat proxy bootstrapped. Q-RESEARCH-1 (polymorphic participant identity) resolved YES. Q-RESEARCH-2 (CTI in v1) resolved DEFER to v2. CTI and Meetily documented as follow-up tracks. Full spec expanded: Problem Statement, Overview, Research, Proposed Solution, Data Models, API Contracts, Commands & Events, UI & UX, i18n, Access Control, Backward Compatibility, Risks & Impact Review, Integration Test Coverage, Implementation Phases, Assumptions, Follow-up Tracks, Compliance Report template. Status moved Draft → Proposed.
- **2026-04-22** — Architectural review (`ANALYSIS-2026-04-21-crm-call-transcriptions.md`) raised 7 findings (1 Critical, 3 High, 3 Medium). All verified against the actual codebase and addressed in-line:
  - **#1 (Critical)** ACL leak via global `attachments/api/library` route → added dedicated `GET /api/customers/interactions/:id/transcript` route gated by `customers.call_transcripts.view`; UI no longer mounts `<AttachmentLibrary>` for transcript content; recommended additive `confidentialContent` partition flag for defense-in-depth. New entry in Risks table.
  - **#2 (High)** Subscriber wired to nonexistent event IDs → corrected to actual `customers.person.created` / `customers.person.updated` per `customers/events.ts:10-12`.
  - **#3 (High)** Response enrichers cannot rewrite queries → replaced with dedicated `GET /api/customers/interactions/timeline` route + opt-in `participantOf` interceptor on the existing list route.
  - **#4 (High)** Encryption contract shape was wrong + nonexistent `attachments/encryption.ts` cited → rewrote §Encryption against the real `ModuleEncryptionMap` (`{entityId, fields:[{field, hashField?}]}`); created `attachments/encryption.ts` plan; added `email_hash` / `phone_hash` columns and indexed on hashes; lookups rewritten in routing algorithm + retroactive subscriber.
  - **#5 (Medium)** Search story underdefined → added §Search with concrete `customers/search.ts` extension for `customers:customer_interaction`, including transcript snippet via decryption-aware helper, indexed snippet cap, and ACL-time gating precedent.
  - **#6 (Medium)** Provider contract used `Record<string, unknown>` → made `CallTranscriptProvider<TCredentials>` generic; added typed `JsonValue` for `providerMetadata`; per-provider zod schemas required.
  - **#7 (Medium)** Interaction detail page doesn't exist; `translations.ts` absent → dropped interaction-detail-page assumption; transcripts now surface inline on Person/Company/Deal timeline rows via a new `<CallTranscriptCard>`; `translations.ts` marked CREATE.
  - Implementation Phases 1, 3, 5 updated to reflect the new files + corrected wiring.
  - Status moves Draft → Proposed (revised).
- **2026-04-22** — Architectural re-check #2 surfaced 5 cleanup items (3 stale-text inconsistencies between corrected and old sections + 2 new findings). All addressed:
  - **#1** Subscribers section still listed `customers.customer_person_profile.created/.updated` after the routing section was already corrected → fixed to `customers.person.created/.updated` everywhere; cite line in `customers/events.ts`.
  - **#2** Architecture diagram still depicted the removed "Interaction detail page + `<AttachmentLibrary>`" model → diagram block rewritten to depict the inline-on-Person/Company/Deal-timeline model with `<CallTranscriptCard>` and the dedicated transcript route.
  - **#3** UI section's "Person / Company / Deal timeline widget updates" still said "use the participant-union response enricher" → rewritten to call the dedicated `GET /api/customers/interactions/timeline` route, with explicit note that response enrichers are additive-only.
  - **#4 (NEW)** `GET /api/customers/interactions/timeline` route was guarded by a nonexistent `customers.view` feature → corrected against `packages/core/src/modules/customers/acl.ts`: route guard requires `customers.interactions.view` plus the per-`subjectKind` view feature (`customers.people.view` / `customers.companies.view` / `customers.deals.view`).
  - **#5 (NEW)** UI test plan still targeted "Interaction detail" surface → rewritten as 12 tests against the inline timeline + `<CallTranscriptCard>` + ACL paths (TC-CRM-CT-UI-001..012). Two new tests added for transcript route ACL and timeline ACL per-subjectKind.
  - **Self-grep sweep** caught 2 additional stale spots beyond the reviewer's list: (a) §7 "Proposed Solution — Timeline union" duplicated the bad `customers.view` ACL reference (now corrected to per-`subjectKind` features); (b) the architecture diagram subscriber block still showed the old `customer_person_profile` event names and plaintext `email`/`phone` predicates (now corrected to `customers.person.*` events and `email_hash`/`phone_hash` predicates). New Mat lesson saved: "When patching a spec, always grep the whole document for the old approach — fix every hit, not just the section the reviewer cited."
  - Status remains **Proposed** (revised twice).
- **2026-04-22** — Coordinated patch from the Zoom / tl;dv sub-spec architectural reviews. §Proposed Solution.2 now explicitly introduces a new `call_transcripts` marketplace hub (required by SPEC-045 `IntegrationDefinition`) and documents the auto-discovered webhook route convention (`api/POST/webhooks/transcription/<vendor>.ts`) so all `packages/transcription-<vendor>` sub-specs have an unambiguous integration contract. This closes the gap where the sub-specs could not render in the integrations marketplace without an upstream hub declaration. No existing behavior changes.
- **2026-04-22** — Overlap de-duplication pass across parent and sub-specs. The parent spec now owns only provider-agnostic content; Zoom- and tl;dv-specific detail moved to or already lives in the respective sub-specs. Three concrete removals: (a) parent's TC-ZOOM-001..006 test matrix removed — the Zoom sub-spec owns its own TC-ZOOM-001..018 + UI-001..004 with non-colliding mappings; (b) parent §API Contracts "Webhook intakes" section rewritten as a provider-agnostic contract (every provider exposes `POST /api/webhooks/transcription/<id>`, verifies signature, resolves tenant from a provider-specific identifier, calls internal ingest); (c) parent §Access Control's Zoom-specific ACL block replaced with the `transcription_<vendor>.{view, configure}` convention plus pointers to each sub-spec. Parent §Implementation Phases Phase 2 already delegates to the Zoom sub-spec (done in an earlier pass today). No runtime behavior changes — purely source-of-truth hygiene.
- **2026-04-22** — Cross-spec architectural review (`ANALYSIS-2026-04-22-transcription-provider-specs.md`) raised 6 findings against the parent + Zoom + tl;dv set. Parent-spec fixes applied in this entry:
  - **F4 (Medium)** Search ACL — parent previously claimed transcript hits would be filtered at search time by `customers.call_transcripts.view`, but the current search stack has no user-features context at result-merge. §Search configuration rewritten: v1 indexes only `title` + `source` for call interactions; transcript body is NOT in the search index. Users find calls by title/provider; full-text transcript search is a follow-up spec that will extend `packages/search` with user-feature-aware filtering. TC-CRM-CT-019 updated to reflect the narrowed scope. `loadCallTranscriptText` helper removed from the plan.
  - **F5 (Medium)** Marketplace hub wiring — Phase 1 gains step 16 to register `'call_transcripts'` in the integrations marketplace category list, i18n bundles, icon mapping, and hub descriptor. Without these, any `packages/transcription-<vendor>` card would render with missing category treatment.
  - **F6 (Low)** Schema regression — §Proposed Solution.1 now exports a recursive `jsonValueSchema` / `providerMetadataSchema` from the shared module; §API Contracts ingest schema uses `providerMetadataSchema` instead of `z.record(z.unknown())`. Runtime contract aligned with the TypeScript type.
  - F1, F2, F3 (tl;dv per-user credential scope; Zoom URL-validation + tenant routing) are resolved in the respective sub-specs.
- **2026-04-22** — Re-review pass findings #1 and #2 applied (stale wording left over from the F4 + F1 redesigns):
  - **R1** §Architectural Review Response finding-#5 row, §Overview's attachment-content paragraph, and §Research — Market Leaders closing line all rewritten to match the narrowed v1 search scope (title + source only; transcript body deferred to a follow-up spec). The old "transcript fulltext-indexed" / "transcript as a searchable record" language is gone.
  - **R2** §Proposed Solution.1 trailing paragraph about credential storage generalized — it now describes the split between tenant-scoped vault storage (fits the Zoom pattern) and provider-owned per-user tables (fits the tl;dv pattern, forced by `IntegrationScope = { organizationId, tenantId }`). §Proposed Solution.3 "Ingest triggers" webhook bullet rewritten to (a) cite the auto-discovered file path convention instead of "registered with `packages/webhooks`" and (b) describe tenant/user resolution in provider-neutral terms, acknowledging the URL/payload/signed-secret-fingerprint family of mechanisms.
- **2026-04-22** — Readability cleanup pass (spec-writing skill review, architectural findings H1 + H2):
  - **H1** — removed two review-meta blocks from the intro (*"Resolution summary (from Open Questions gate …)"* and *"## Architectural Review Response (2026-04-22)"* with its 7-row findings table). Both duplicated content already present in this Changelog in richer form. A new reader now goes metadata → TLDR → Overview, per the spec-writing template.
  - **H2** — simplified `Status` from `Draft — Proposed (revised after architectural review ANALYSIS-2026-04-21; all 7 findings addressed in-line)` to `Proposed`. Review history lives in the Changelog, not in the frontmatter.
  - Added an `Architectural reviews` row to the metadata table pointing at the two `ANALYSIS-*` files under `.ai/specs/analysis/` so readers who want the review audit trail can find it.
- **2026-04-22** — Alignment pass against OM spec house style (surveyed `SPEC-045`, `SPEC-060`, `customers-lead-funnel`, `auto-implement-spec-skill`):
  - Added `## User Stories / Use Cases` section between §Proposed Solution and §Architecture. Content is the same 6 functional requirements that previously lived inline under §Problem Statement ("The feature must:"), reframed as `**Role** wants **Action** so that **Benefit**` per the OM convention and extended to 7 stories including the compliance officer perspective. Added an explicit mapping from each story to the downstream section(s) that satisfy it.
  - Dropped the "The feature must:" list from §Problem Statement — now pure narrative pain description, as the template specifies.
  - Filled `## Final Compliance Report — 2026-04-22` (previously a template stub). AGENTS.md files reviewed, compliance matrix with ~30 rows, internal consistency check, verdict. Runtime-only rows (generated files, migrations, integration-test green) explicitly marked "verify at implementation PR time" rather than left unchecked.
- **2026-04-22** — Module-boundary redesign (PR #1645 feedback from @dominikpalatynski). Architectural split:
  - **Split #1** — Introduced dedicated core module `packages/core/src/modules/call_transcripts/` owning: transcript aggregate (`CallTranscript` + text encrypted at rest), raw provider-reported participants (`CallTranscriptParticipant`), unmatched staging (`CallTranscriptUnmatched`), provider registry (`registerCallTranscriptProvider`, matching the verified `registerGatewayAdapter` / `registerDataSyncAdapter` module-level pattern — NOT the retired `callTranscriptProviders` DI token), ingest orchestration command, unmatched inbox UI (`/backend/call-transcripts/unmatched`), transcript read route (`GET /api/call-transcripts/:id`), transcript ACL namespace (`call_transcripts.view|manage|unmatched.resolve`), transcript-specific events (`call_transcripts.transcript.*`). Previous draft put all of this under `customers`, creating the dual-ownership problem Dominik flagged.
  - **Split #2** — `customers` retains `CustomerInteraction` as CRM source-of-truth per SPEC-046b and now exposes three new commands (`customers.interactions.{create|update|delete}_from_transcript`) plus a read-only `CustomerMatchingService`. The new `CustomerInteractionParticipant` junction stays in customers. Cross-module orchestration happens via command bus + DI service — never direct ORM (verified against root AGENTS.md).
  - **Split #3** — Webhook intake moved onto the existing `@open-mercato/webhooks` `WebhookEndpointAdapter` contract (verified in `packages/webhooks/src/modules/webhooks/lib/adapter-registry.ts`). Provider packages register via `registerWebhookEndpointAdapter`; the shared `/api/webhooks/inbound/[endpointId]` route handles raw-body preservation, signature-delegation, dedup, and rate limiting. The earlier per-provider auto-discovered `/api/webhooks/transcription/<vendor>` convention is retired — it bypassed the platform's existing inbound pipeline and would have locked a new public route shape into contract surface.
  - **Split #4** — Transcript text moved out of the attachments module. The previous draft stored transcripts in `Attachment.content` under a `customer-call-recordings` partition and required a new `attachments/encryption.ts` with global blast radius plus a `confidentialContent: boolean` partition flag for library-route hardening. All of that is retired. Transcript content lives in `call_transcripts.text` (encrypted at rest in `call_transcripts/encryption.ts`, zero cross-module side effects). Eliminates the library-route leak concern entirely — no attachments-module changes required.
  - **Naming normalization** — ACL namespace `customers.call_transcripts.*` → `call_transcripts.*`; event namespace `customers.call_transcript.*` → `call_transcripts.transcript.*`; i18n namespace `customers.call_transcripts.*` / `customers.unmatched_transcripts.*` → `call_transcripts.*` / `call_transcripts.unmatched.*`; shared module path `@open-mercato/shared/modules/customers/transcription` → `@open-mercato/shared/modules/call_transcripts/provider`.
  - **Sections rewritten**: TLDR, Overview, Metadata table, §Proposed Solution (1, 2, 3, 4, 5, 6, 7), Architecture diagram, Data Models (new `call_transcripts` entities + customers still owns junction), API Contracts, Commands & Events, UI & UX (inbox now at `/backend/call-transcripts/unmatched`; `<CallTranscriptCard>` injected into customers timeline via widget spot), i18n, Access Control, Backward Compatibility, Risks & Impact Review, Integration Test Coverage (split into per-module tables), Implementation Phases (6 phases; Phase 1-3 in call_transcripts + customers, Phases 4-5 for Zoom + tl;dv adapters, Phase 6 for polish), Assumptions, Follow-up Tracks, Downstream AI Alignment, Final Compliance Report. The Zoom + tl;dv sub-specs updated in-line to consume the new `WebhookEndpointAdapter` + `registerCallTranscriptProvider` contracts.
  - **Status**: Proposed (revised).
- **2026-04-22** — Follow-up review applied (`ANALYSIS-2026-04-22-crm-call-transcriptions-review.md`). Five findings addressed:
  - **#1 (Critical)** Unmatched resolve was under-authorized — only gated by `call_transcripts.unmatched.resolve`, which let a transcript-inbox user project a transcript onto CRM records they couldn't view. §API Contracts `POST /api/call-transcripts/unmatched/:id/resolve` now requires BOTH route-level `call_transcripts.unmatched.resolve + customers.interactions.create` AND a handler-level per-subject ACL check (`customers.people.view` for the required personId, plus `customers.companies.view` / `customers.deals.view` when those optional subjects are provided). Handler must use the caller's session ACL for subject-existence reads — no bypass. Denials return 403 `forbidden_subject_access`.
  - **#2 (Critical)** The promised atomic cross-module write was not implementable — the current customers command implementation (verified at `customers/commands/interactions.ts:259`) forks its own `EntityManager` and opens its own transaction, so a nested `customers.interactions.create_from_transcript` cannot share an outer `withAtomicFlush`. §4 "Ingest flow" rewritten as a documented two-phase commit with a durable recovery path: Phase A (transcript aggregate) commits atomically; Phase C (customers projection) commits in its own transaction; on Phase C failure the transcript row sits at `projection_status='projection_failed'` with a `last_error` column and a persistent recovery subscriber retries with exponential backoff, falling back to `projection_status='unmatched'` in the inbox after N retries. Undo rewritten as per-phase (not chain-undo) with an idempotent `customers.interactions.delete_from_transcript` inverse command. A future `commandBus.runInShared(em, …)` primitive would let Phase A+C commit as one transaction — flagged as a separate platform concern. The `CallTranscript` entity gained `projection_failed` status + `last_error` text column; Risks table updated with the visible failure mode and recovery path (replacing the old "single withAtomicFlush" row).
  - **#3 (High)** `CallTranscriptParticipant` CHECK conflicted with Zoom/tl;dv design — the earlier `CHECK (email OR phone)` rejected anonymous speakers (Zoom guests without `user_email`, tl;dv display-name-only segments). The transcript side is the raw source-of-truth; losing these rows would silently mutate provider data. CHECK relaxed to `(email IS NOT NULL OR phone IS NOT NULL OR display_name IS NOT NULL)` and a computed `matchable` boolean column added — matching phases skip display-name-only rows; UI shows them for audit. The CRM-side `customer_interaction_participants` junction keeps the stricter CHECK because CRM matching requires identity.
  - **#4 (High)** Parent spec overstated `@open-mercato/webhooks` capability — the claim that `verifyWebhook` could return a synthetic envelope and the shared route would pass it through was wrong (verified against `packages/webhooks/.../route.ts:54-106` and `.../subscribers/inbound-process.ts`: route persists a receipt, emits an event, returns fixed JSON ack; `processInbound` runs asynchronously). §Proposed Solution.3 rewritten to require an **explicit additive extension** to `@open-mercato/webhooks`: new optional `handleHandshake(input) → Promise<null | { status, headers?, body }>` hook on `WebhookEndpointAdapter`, called BEFORE `verifyWebhook` by the shared route, short-circuiting the standard flow when it returns non-null. Marked as a **hard prerequisite for Phase 4 (Zoom)**. The Zoom sub-spec §Ingestion and §Implementation Phases Phase 2 updated to consume `handleHandshake` for `endpoint.url_validation`. tl;dv doesn't need this.
  - **#5 (Medium)** tl;dv polling TLDR was internally inconsistent — claimed `GET /meetings?since=lastPolledAt` but the actual API is page-based with client-side `happenedAt` filtering (verified in the sub-spec's §Provider profile table). TLDR bullet rewritten to match the real API shape.
  - **Status**: Proposed (revised).
