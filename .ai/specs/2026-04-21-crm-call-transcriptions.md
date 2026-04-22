# CRM Call Transcriptions

| Field | Value |
|---|---|
| **Date** | 2026-04-21 |
| **Status** | Proposed |
| **Author** | Piotr (om-cto) + om-spec-writing |
| **Scope** | OSS |
| **Module(s)** | `customers`, `attachments`, `webhooks`, `integrations`, new `packages/transcription-zoom` |
| **Related specs** | `.ai/specs/implemented/SPEC-046b-2026-02-27-customers-interactions-unification.md`, `.ai/specs/SPEC-030-2026-02-24-deal-attachments.md`, `.ai/specs/implemented/SPEC-045-2026-02-24-integration-marketplace.md`, `.ai/specs/2026-04-11-unified-ai-tooling-and-subagents.md` |
| **Architectural reviews** | `.ai/specs/analysis/ANALYSIS-2026-04-21-crm-call-transcriptions.md`, `.ai/specs/analysis/ANALYSIS-2026-04-22-transcription-provider-specs.md` (resolutions recorded in §Changelog) |

## TLDR

- Automatic ingestion of call transcripts from external meeting tools (Zoom in v1; tldv / Meet / Fireflies / Loom / Otter / Gong / Meetily as follow-up packages) into the OM CRM. **OM never transcribes anything.** Audio/video stays on the source tool; OM stores only the transcript text, metadata, and a deep-link back.
- Driven by provider **webhooks** (primary) with a **scheduled polling fallback**. No manual upload, no paste-a-link, no browse-and-pick.
- Routing is email-deterministic and many-to-many. For each participant email in a transcript, match to `CustomerPerson.primary_email` (and secondary-email CE when declared). One transcript yields ONE `CustomerInteraction` (`interactionType='call'`) + ONE `Attachment` + N `CustomerInteractionParticipant` rows. Unmatched participants keep a row with `customerEntityId=null` and either `email` or `phone` populated.
- Retroactive matching: when a new `CustomerPerson` is created (or an email/phone is updated), a persistent subscriber backfills participant rows, surfacing past calls on the person's timeline automatically.
- **Unmatched Transcripts inbox**: zero-match transcripts stage in `customer_unmatched_transcripts` and appear in a new backend page; a user claims each by picking a target Person (required) + optional Company + optional Deal, at which point the full routing runs.
- Data model reuse: `CustomerInteraction` and `Attachment` unchanged. ONE new entity (`CustomerInteractionParticipant`) + ONE staging table (`customer_unmatched_transcripts`) + a handful of interaction custom fields.
- Provider contract: `CallTranscriptProvider.fetchTranscript(externalRecordingId) → TranscriptResult`. No STT method. Each provider ships as a separate npm workspace package (`packages/transcription-<vendor>`).
- Out of scope for v1: STT of raw audio; audio/video file storage; CTI / PBX / phone-call events; voicemail; SMS voice; LLM summaries / action-item extraction / sentiment; retention worker; manual upload / paste-a-link.

---

## Problem Statement

Calls with prospects, leads, and customers contain the highest-signal insights a sales team generates — objections, competitor mentions, pricing reactions, next-step commitments. Today these insights live in the meeting tool (Zoom transcripts, tldv notes, Fireflies highlights). They are not visible alongside the CRM records they are about, they are not searchable from the CRM, and they are not surfaced on the timelines of the Person / Company / Deal the call belongs to.

Without an ingestion layer, a sales team either: (a) copy-pastes transcripts into notes (high friction, almost never happens), (b) asks the meeting tool to "sync to CRM" via a brittle Zapier flow that only covers one provider, or (c) loses the insight entirely.

---

## Overview

This spec introduces a transcript ingestion pipeline under `packages/core/src/modules/customers`. A new single provider interface (`CallTranscriptProvider`) is defined; each meeting-SaaS integration ships as a separate workspace package implementing it. Providers register via DI + the existing integrations marketplace (SPEC-045) and reuse its credential vault.

Each provider package exposes a webhook intake route via `packages/webhooks`. When the source tool finishes transcribing a meeting, the webhook handler verifies the signature, pulls the transcript via the provider's fetch method, and submits a normalized `TranscriptResult` to an internal ingest API on the customers module. A scheduled polling worker provides a fallback for tenants whose networks can't receive inbound webhooks.

The customers module hosts the routing algorithm: match each participant email / phone to a CRM Person, pick a deterministic primary, and write one `CustomerInteraction` + one `Attachment` + N `CustomerInteractionParticipant` junction rows in a single atomic flush (per SPEC-018). Zero-match transcripts are staged for a user to claim from a new Unmatched Transcripts inbox page. A persistent subscriber backfills participant links when a new Person is added whose email or phone matches an earlier unmatched row.

Attachments are tagged with `storage_driver=<provider.id>` (following SPEC-030's precedent where `google-drive` marks a linked external resource). The attachment's `url` deep-links back to the source recording. The attachment's `content` column holds the transcript text — encrypted at rest via the attachments encryption map. The transcript body is served only through the ACL-gated `GET /api/customers/interactions/:id/transcript` route; it is **not** present in the search index in v1 (only `title` + `source` are indexed for call interactions — see §Search configuration for why and for the follow-up track that adds user-feature-aware full-text search once `packages/search` supports it).

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

File: `packages/shared/src/modules/customers/transcription.ts` (new).

```ts
// Typed JSON value — exported from @open-mercato/shared for any provider that
// needs to round-trip arbitrary serializable metadata without resorting to `unknown`.
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
// packages/shared/src/modules/customers/transcription.ts
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

### 2. Provider registry

Each provider package registers its implementation in `di.ts` as a multi-provider under a shared token `callTranscriptProviders` (string-keyed registry). The customers module resolves providers by `TranscriptResult` source or by attachment `storage_driver`. Registration mirrors SPEC-045 integrations pattern.

**Marketplace hub**: SPEC-045's `IntegrationDefinition` requires a `hub` value. Existing hubs (verified in the codebase): `payment_gateways`, `shipping_carriers`, `data_sync`, `webhook_endpoints` — none fit transcription providers. This spec introduces a new hub id `call_transcripts`. The hub is declared by the customers module (owner of the feature) and consumed by every `packages/transcription-<vendor>` package's `integration.ts`:

```ts
export const integration: IntegrationDefinition = {
  id: 'transcription_<vendor>',
  category: 'call_transcripts',
  hub: 'call_transcripts',
  providerKey: '<vendor>',
  // ...
}
```

**Webhook registration convention**: transcription-provider webhooks use OM's auto-discovered API route convention — each provider package ships a single handler at `src/modules/transcription_<vendor>/api/POST/webhooks/transcription/<vendor>.ts` which materializes `POST /api/webhooks/transcription/<vendor>`. Providers do NOT use `registerWebhookHandler` from `@open-mercato/shared/modules/payment_gateways/types` — that export is scoped to payment gateways and takes a `VerifyWebhookInput` shape that doesn't fit the transcription pipeline's signed-body-pull-fetch-transcript pattern.

### 3. Ingest triggers

- **Webhook path (primary).** Each provider package ships a signed webhook intake route via OM's auto-discovered route convention, file path `src/modules/transcription_<vendor>/api/POST/webhooks/transcription/<vendor>.ts`. Handler responsibilities:
  1. Verify the provider's signature (algorithm chosen by each provider — HMAC-SHA256 for Zoom, shared-secret-header for tl;dv).
  2. Resolve the call's tenant (and user, when the provider is per-user) from a provider-specific identifier. The identifier MAY live in the URL (e.g. Zoom's signed tenant token in `?t=`), in the payload (e.g. Zoom's `account_id`), or in the signed secret itself (e.g. tl;dv's `sha256` fingerprint of `X-OM-Webhook-Secret` keying a provider-owned credentials table). Sub-specs document the exact mechanism per provider.
  3. Call `provider.fetchTranscript(externalRecordingId)`.
  4. Submit the `TranscriptResult` to the internal ingest command (`customers.call_transcripts.ingest`).
- **Polling fallback.** Each provider package ships its own scheduled worker (e.g. `workers/poll-zoom.ts`, `workers/poll-tldv.ts`) with concurrency 1 per connected scope (per tenant for tenant-scoped providers; per (tenant, user) for per-user providers). The worker iterates `listRecentRecordings(since=lastPolledAt)` for each connected scope and submits new recordings through the same internal ingest path.
- **Manual reingest.** `POST /api/customers/interactions/:id/reingest-transcript` (admin-only) refetches the transcript and overwrites `Attachment.content` + `storage_metadata.transcription`. Used when the provider upgrades the transcript post-hoc.

### 4. Routing algorithm

Executed inside the `customers.call_transcripts.ingest` command. All DB writes happen inside a single `withAtomicFlush` with `transaction: true` per SPEC-018.

```
INPUT: TranscriptResult r, providerId

1. matched := []
   for each p in r.participants:
     person := null
     if p.email:
       emailHash := encryption.hash(p.email)
       person := CustomerPerson.by(primary_email_hash=emailHash)
                ?? CustomerPerson.by(secondary_email_hash CE=emailHash)
     if !person and p.phone:
       phoneHash := encryption.hash(p.phone)
       person := CustomerPerson.by(primary_phone_hash=phoneHash)
                ?? CustomerPerson.by(secondary_phone_hash CE=phoneHash)
     matched.push({ participant: p, person: person, emailHash, phoneHash })

2. if every matched.person is null:
     write row to customer_unmatched_transcripts
     emit customers.call_transcript.unmatched
     STOP

3. primary := pick from matched[where person != null] in this precedence:
     a. the Person linked to exactly ONE active Deal (if unambiguous)
     b. the Person linked to the most-recently-active Deal
     c. the first matched Person (by r.participants index)

4. interaction := create CustomerInteraction(
     entity_id         = primary.customer_entity_id,
     entity_kind       = 'customer_person_profile',
     interaction_type  = 'call',
     title             = r.title ?? `${providerLabel} call`,
     body              = null,              // body is the transcript — lives in Attachment.content
     occurred_at       = r.occurredAt,
     status            = 'done',
     source            = providerId,
     custom_values     = {
       durationSec: r.durationSec,
       direction: null,                     // set by CTI providers in v2
       sourceProvider: providerId,
       sourceRecordingId: r.externalRecordingId,
       sourceMeetingUrl: r.sourceMeetingUrl,
       language: r.language,
     })

5. attachment := create Attachment(
     entity_id        = 'customers:customer_interaction',
     record_id        = interaction.id,
     partition_code   = 'customer-call-recordings',
     storage_driver   = providerId,
     storage_path     = r.externalRecordingId,    // opaque per-provider id
     url              = r.sourceMeetingUrl,
     file_name        = interaction.title,
     mime_type        = 'text/vnd.om.transcript', // synthetic — transcript is text
     file_size        = Buffer.byteLength(r.text, 'utf8'),
     content          = r.text,
     storage_metadata = {
       transcription: {
         language: r.language,
         segments: r.segments,
         durationSec: r.durationSec,
         providerMetadata: r.providerMetadata,
       },
     })

6. for each m in matched:
     create CustomerInteractionParticipant(
       interaction_id     = interaction.id,
       customer_entity_id = m.person?.customer_entity_id ?? null,
       email              = m.participant.email ?? null,        // encryption layer encrypts on write
       email_hash         = m.emailHash ?? null,                 // populated alongside (deterministic)
       phone              = m.participant.phone ?? null,
       phone_hash         = m.phoneHash ?? null,
       display_name       = m.participant.displayName ?? null,
       role               = m.participant.role ?? 'participant',
       matched_via        = m.person
                              ? (matchedByEmail(m) ? 'primary_email'
                                 : matchedBySecondaryEmail(m) ? 'secondary_email'
                                 : matchedByPhone(m) ? 'primary_phone'
                                 : 'secondary_phone')
                              : null)

7. emit customers.call_transcript.ingested { interactionId, attachmentId, primaryPersonId, participantCount }
```

### 5. Retroactive matching

Persistent subscriber `subscribers/backfill-participant-match.ts` reacts to the **actual customers events** (verified against `packages/core/src/modules/customers/events.ts:10-12`):
- `customers.person.created`
- `customers.person.updated`

The subscriber inspects the payload's primary_email / primary_phone (and secondary-email/phone CE if present) and, for each non-empty identifier, runs:

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

(Lookup uses the deterministic `email_hash` / `phone_hash` columns since the plaintext columns store ciphertext at rest — see §Encryption.)

For each affected row, emit `customers.interaction_participant.matched { interactionId, participantId, customerEntityId }`. Batched to 200 rows per emission to avoid subscriber storms on bulk imports.

The `customers.person.updated` payload contract MUST include the previous `primary_email`/`primary_phone` snapshot so the subscriber can detect identifier changes; if not already in the payload, this spec adds that field via the existing customers update command and validators (additive, BC-safe).

### 6. Unmatched Transcripts inbox

New backend page `/backend/customers/unmatched-transcripts` under the customers module (see UI & UX section). User claims a row via a dialog → picks Person (required) + optional Company + optional Deal → runs routing step 4+ with the user-picked primary, then deletes the staging row.

### 7. Timeline union on Person / Company / Deal pages

**(Corrected per ANALYSIS finding #3 — response enrichers are additive-only and cannot rewrite queries.)**

Existing timeline widgets currently fetch interactions where `entity_id = <record.id>`. To surface calls where the subject is a participant (not the primary entity), this spec adds a dedicated route plus an opt-in interceptor — both verified-supported mechanisms per `packages/core/AGENTS.md` §API Interceptors:

**(a) Dedicated timeline route (preferred).**

`GET /api/customers/interactions/timeline?subjectKind=person|company|deal&subjectId=<uuid>&page=&pageSize=&sortDir=`

- Server-side union: interactions where `entity_id = subjectId` ∪ interactions whose `id` appears in `customer_interaction_participants` for `subjectId` (joining through Person → Company and Person → Deal for the company/deal subjectKinds).
- Returns the same shape as `GET /api/customers/interactions` so the widget swaps endpoints transparently.
- ACL: route guard requires `customers.interactions.view`; the handler additionally requires the per-`subjectKind` view feature (`customers.people.view` for `subjectKind=person`, `customers.companies.view` for `company`, `customers.deals.view` for `deal`). There is no umbrella `customers.view` feature — see §API Contracts and `packages/core/src/modules/customers/acl.ts`.

**(b) Backwards-compatible widening on the existing list route.**

For consumers that keep using `GET /api/customers/interactions`, an API interceptor at `customers/api/interceptors.ts` accepts an optional `participantOf=<uuid>` query param. When present, it pre-resolves the union of matching interaction IDs from the participants junction (and Person→Company/Deal joins) and injects them via `query.ids` (comma-separated UUIDs) per the OM interceptor contract. This is an **additive** query-shape change — old calls without `participantOf` keep their current behavior.

Query cost: one indexed lookup on `customer_interaction_participants(organization_id, tenant_id, customer_entity_id)` plus a (bounded) join on `customer_people` / `customer_companies` / `customer_deals` for the company/deal subject kinds.

The Person / Company / Deal timeline widgets are updated to call (a) or (b); the choice is per widget but (a) is preferred for new code.

---

## User Stories / Use Cases

- **Sales rep** wants **every call to land automatically on the right Person / Company / Deal timelines** so that **follow-up context is never lost to copy-paste friction**.
- **Sales manager** wants **a call attended by three CRM contacts to appear on all three timelines without duplicating records** so that **the full history of every contact is preserved without data sprawl**.
- **Sales rep (reviewer)** wants **zero-match transcripts to queue in an inbox and be claimable manually** so that **no call silently disappears when a participant is missing from CRM**.
- **Ops / BD lead** wants **a new contact added to CRM to retroactively surface their past calls** so that **historical context arrives as soon as the relationship is formalized**.
- **Platform integrator** wants **to ship a new transcription provider as its own npm package without forking core** so that **tldv, Meet, Fireflies, Loom, Otter, Gong, Meetily can be added by the community**.
- **Ops admin** wants **OM to never run speech-to-text** so that **the platform has no audio storage cost, no transcription billing, and no STT-quality debt**.
- **Security / compliance officer** wants **transcript content encrypted at rest and readable only by users with `customers.call_transcripts.view`** so that **regulated PII in call bodies never leaks via the global attachments library or the search index**.

These stories map directly to sections below:
- "automatic ingestion" → §Proposed Solution.3 (webhook + polling) + §API Contracts (`POST /api/customers/call-transcripts/ingest`).
- "three timelines without duplication" → `CustomerInteractionParticipant` junction + §API Contracts (`GET /api/customers/interactions/timeline`).
- "zero-match inbox" → `CustomerUnmatchedTranscript` staging + §UI & UX (`/backend/customers/unmatched-transcripts`) + the notify-unmatched subscriber.
- "retroactive matching" → `subscribers/backfill-participant-match.ts`.
- "provider-agnostic" → shared `CallTranscriptProvider<TCredentials>` contract + sub-specs for Zoom + tl;dv.
- "never STT" → contract has `fetchTranscript` only; no `transcribe(audio)` method.
- "ACL-gated transcript read" → dedicated `GET /api/customers/interactions/:id/transcript` route + encryption map on `attachments:attachment.content`.

---

## Architecture

```
 External meeting tools (each ships as a separate workspace package)
 ┌──────────────┬──────────────┬──────────────┬──────────────┬────────────┐
 │ Zoom         │ tldv         │ Google Meet  │ Fireflies    │ Loom/Otter │
 │ (v1)         │ (follow-up)  │ (follow-up)  │ (follow-up)  │ (follow-up)│
 └──────┬───────┴──────┬───────┴──────┬───────┴──────┬───────┴─────┬──────┘
        │ Webhook (primary)                                        │ Poll
        ▼                                                          ▼ (fallback)
 ┌──────────────────────────────────────────────────────────────────────┐
 │ packages/webhooks + packages/transcription-<provider>                 │
 │   POST /api/webhooks/transcription/<provider>    (signed, tenant-scoped)
 │   + scheduled worker calling listRecentRecordings(since=lastPolledAt) │
 │                                                                       │
 │ CallTranscriptProvider contract (core):                               │
 │   • fetchTranscript(externalRecordingId, ctx) → TranscriptResult      │
 │   • listRecentRecordings?(ctx, since) → AsyncIterable<summary>        │
 │   NO transcribe() method — OM never runs STT.                         │
 └────────────────────────────────┬─────────────────────────────────────┘
                                  │ submit TranscriptResult
                                  ▼
 ┌──────────────────────────────────────────────────────────────────────┐
 │ packages/core/src/modules/customers — INGEST PIPELINE                 │
 │                                                                       │
 │ Command: customers.call_transcripts.ingest                            │
 │   Routing algorithm (§4). withAtomicFlush, transaction=true.          │
 │   On zero-match → stage in customer_unmatched_transcripts.            │
 │                                                                       │
 │ Subscriber: backfill-participant-match (persistent)                   │
 │   on customers.person.created / .updated →                            │
 │     UPDATE customer_interaction_participants                          │
 │       SET customer_entity_id, matched_via                             │
 │       WHERE customer_entity_id IS NULL                                │
 │         AND (email_hash=? OR phone_hash=?)                            │
 │   Emit customers.interaction_participant.matched per affected row.    │
 │                                                                       │
 │ Events (new):                                                         │
 │   customers.call_transcript.ingested      (persistent, clientBroadcast)
 │   customers.call_transcript.unmatched     (persistent)                │
 │   customers.interaction_participant.matched (persistent)              │
 └────────────────────────────────┬─────────────────────────────────────┘
                                  │
                                  ▼
 ┌──────────────────────────────────────────────────────────────────────┐
 │ DATA MODEL                                                            │
 │                                                                       │
 │ CustomerInteraction (unchanged schema; interaction_type='call')       │
 │   cf: durationSec, direction, sourceProvider, sourceRecordingId,      │
 │       sourceMeetingUrl, language                                      │
 │   └ 1..1 ─────────────────────────────────────────────────────────┐  │
 │                                                                    │  │
 │ Attachment (unchanged schema)                                      ▼  │
 │   entity_id='customers:customer_interaction', record_id=<interaction> │
 │   partition_code='customer-call-recordings'                           │
 │   storage_driver=<providerId>                                         │
 │   url = deep-link back to source recording                            │
 │   content = TRANSCRIPT TEXT (encrypted at rest)                       │
 │   storage_metadata.transcription = { language, segments, durationSec, │
 │                                       providerMetadata }              │
 │                                                                       │
 │ CustomerInteractionParticipant (NEW junction)                         │
 │   id, interaction_id, customer_entity_id (nullable),                  │
 │   email (nullable), phone (nullable), display_name, role, matched_via,│
 │   organization_id, tenant_id, created_at                              │
 │   CHECK (email IS NOT NULL OR phone IS NOT NULL)                      │
 │   Indexed on (org, tenant, email), (org, tenant, phone),              │
 │               (org, tenant, customer_entity_id), (interaction_id)     │
 │                                                                       │
 │ customer_unmatched_transcripts (NEW staging)                          │
 │   id, provider_id, source_recording_id, raw_transcript_result (jsonb),│
 │   participants_summary (jsonb), status ('pending'|'resolved'),        │
 │   organization_id, tenant_id, created_at, resolved_at, resolved_by    │
 │   UNIQUE (tenant_id, provider_id, source_recording_id)                │
 └──────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
 ┌──────────────────────────────────────────────────────────────────────┐
 │ CRM UI — automatic surface, no manual upload                          │
 │                                                                       │
 │ NO interaction detail page in v1. Transcripts surface INLINE on the   │
 │ existing Person / Company / Deal detail pages via the timeline widget │
 │ (verified: customers/backend has only people/companies/deals pages).  │
 │                                                                       │
 │ Person / Company / Deal timeline widgets                              │
 │   • Call to GET /api/customers/interactions/timeline                  │
 │       ?subjectKind=person|company|deal&subjectId=<uuid>               │
 │     (server-side union: entity_id = subject ∪ subject in participants │
 │     junction). NOT a response enricher — enrichers are additive-only. │
 │   • Each interaction_type='call' row expands to <CallTranscriptCard>: │
 │       - Header: provider icon + occurredAt + duration                 │
 │       - Action: "Open in <provider>" deep-link via Attachment.url     │
 │       - Action: "Reingest transcript" (gated)                         │
 │       - Participants pills: matched → Link to Person;                 │
 │         unmatched → "Invite to CRM" affordance                        │
 │       - Transcript: fetched via                                       │
 │         GET /api/customers/interactions/:id/transcript                │
 │         (CRM-owned, ACL-gated; NOT the global attachments library)    │
 │   • Live refresh via useAppEvent('customers.call_transcript.ingested')│
 │   • Deep-link: /backend/customers/people/<id>#interaction-<callId>    │
 │     scrolls to the row and auto-expands the card.                     │
 │                                                                       │
 │ NEW page: /backend/customers/unmatched-transcripts                    │
 │   DataTable of staged rows; row action "Claim" → dialog with Person   │
 │   (required) + optional Company + optional Deal; runs routing and     │
 │   discards staging row.                                               │
 └──────────────────────────────────────────────────────────────────────┘

 Credentials flow: provider package → integrations module credential vault
   (SPEC-045). User connects Zoom / tldv / … from Integrations Marketplace.
```

---

## Data Models

### New entities (customers module)

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

**`CustomerUnmatchedTranscript`** — staging for zero-match transcripts pending human review.

```ts
@Entity({ tableName: 'customer_unmatched_transcripts' })
@Unique({ name: 'cut_tenant_provider_recording_unique',
          properties: ['tenantId', 'providerId', 'sourceRecordingId'] })
@Index({ name: 'cut_status_idx', properties: ['organizationId', 'tenantId', 'status'] })
export class CustomerUnmatchedTranscript {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' }) id!: string
  @Property({ name: 'provider_id',          type: 'text' }) providerId!: string
  @Property({ name: 'source_recording_id',  type: 'text' }) sourceRecordingId!: string
  @Property({ name: 'source_meeting_url',   type: 'text' }) sourceMeetingUrl!: string
  @Property({ name: 'occurred_at',          type: Date, nullable: true }) occurredAt?: Date | null
  @Property({ type: 'text', nullable: true }) title?: string | null
  @Property({ name: 'raw_transcript_result', type: 'jsonb' }) rawTranscriptResult!: Record<string, unknown>
  @Property({ name: 'participants_summary',  type: 'jsonb' }) participantsSummary!: Array<{
    email?: string; phone?: string; displayName?: string; role?: string
  }>
  @Property({ type: 'text', default: 'pending' }) status: 'pending' | 'resolved' | 'dismissed' = 'pending'
  @Property({ name: 'organization_id', type: 'uuid' }) organizationId!: string
  @Property({ name: 'tenant_id',        type: 'uuid' }) tenantId!: string
  @Property({ name: 'created_at',  type: Date, onCreate: () => new Date() }) createdAt: Date = new Date()
  @Property({ name: 'resolved_at', type: Date, nullable: true }) resolvedAt?: Date | null
  @Property({ name: 'resolved_by', type: 'uuid', nullable: true }) resolvedBy?: string | null
}
```

### Custom fields on `CustomerInteraction`

Declared in `packages/core/src/modules/customers/ce.ts` under the `customers:customer_interaction` entity:

| Key | Type | Required | Notes |
|---|---|---|---|
| `durationSec` | integer | no | Seconds. Populated by provider. |
| `direction` | enum('inbound','outbound','n_a') | no | Defaults `n_a` for meeting-SaaS; CTI providers set it in v2. |
| `sourceProvider` | text | yes (when `interaction_type='call'`) | Matches `CallTranscriptProvider.id`. |
| `sourceRecordingId` | text | yes (when `interaction_type='call'`) | Provider-opaque ID. Used for idempotency + reingest. |
| `sourceMeetingUrl` | text | yes (when `interaction_type='call'`) | Deep-link back. |
| `language` | text | no | BCP-47 tag when provider reports it. |

Idempotency: an ingest is a no-op if a `CustomerInteraction` already exists with matching `sourceProvider` + `sourceRecordingId` custom-field pair (check via query index before insertion; reingest updates instead of duplicates).

### Attachment partition

Seeded in `packages/core/src/modules/attachments/setup.ts`:

```ts
{
  code: 'customer-call-recordings',
  title: 'Customer call recordings',
  description: 'Transcripts of calls and meetings ingested from external providers',
  storageDriver: 'local',         // overridden by per-tenant config; the per-attachment driver
                                  // records the actual source (zoom, tldv, …)
  isPublic: false,
  requiresOcr: false,
  encryptionEnabled: true,
}
```

### Encryption maps

**(Corrected per ANALYSIS finding #4 — uses the real `ModuleEncryptionMap` contract from `packages/shared/src/modules/encryption.ts`. The previous draft used invented field names. Real shape: `{ entityId, fields: [{ field, hashField? }] }`.)**

**CREATE** `packages/core/src/modules/attachments/encryption.ts` — does not exist today. Encrypts the `content` column on the global `Attachment` entity. Trade-off: applies to **all** attachments regardless of partition. Acceptable because (a) `content` is text payload (transcripts, OCR output) that is sensitive in nearly every realistic use, and (b) per-partition gating would require a partition-aware encryption hook that the framework doesn't currently expose.

```ts
import type { ModuleEncryptionMap } from '@open-mercato/shared/modules/encryption'

export const defaultEncryptionMaps: ModuleEncryptionMap[] = [
  {
    entityId: 'attachments:attachment',
    fields: [{ field: 'content' }],
  },
]

export default defaultEncryptionMaps
```

**EXTEND** `packages/core/src/modules/customers/encryption.ts` (file exists today) with one new entry for the participants junction. Email gets a `hashField` so we can keep matching/lookups working without decryption (uses the existing OM encryption pattern).

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

This requires adding `email_hash` and `phone_hash` columns to `CustomerInteractionParticipant` (TEXT, indexed). The retroactive-match subscriber and routing algorithm look up by `email_hash` / `phone_hash`, never by plaintext.

**Custom fields on `CustomerInteraction`:** the new `sourceMeetingUrl` and `language` custom fields do not contain regulated PII; no new encryption entry needed. `sourceProvider` and `sourceRecordingId` are opaque tokens, also unencrypted.

**Read-path discipline.** All reads in the customers module that touch `email`, `phone`, or `display_name` on participants (and `content` on attachments) MUST use `findWithDecryption` / `findOneWithDecryption` per `packages/shared/AGENTS.md`. Plain `em.find` is forbidden on these tables.

### Migration

Auto-generated via `yarn db:generate` after declaring the entities. Expected output: one new migration under `packages/core/src/modules/customers/migrations/` creating both tables, indexes, CHECK constraint, UNIQUE constraint, hash columns.

### Search configuration

**(Scope-reduced per ANALYSIS 2026-04-22-transcription-provider-specs.md finding #4: the current search stack — verified in `packages/search/src/service.ts` and `packages/shared/src/modules/search.ts` — has no mechanism to filter results by the querying user's ACL features. `SearchOptions` receives only `tenantId`/`organizationId`/`entityTypes`/`strategies`; no user-features context reaches result merging, and `fieldPolicy.excluded` is a static index-time rule, not a runtime ACL filter. Indexing transcript text therefore cannot be gated by `customers.call_transcripts.view` without extending the search service — out of scope for v1.)**

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
- Transcript text lives only in `Attachment.content` (encrypted at rest) and is served exclusively through the ACL-gated `GET /api/customers/interactions/:id/transcript` route.
- Users find calls by **title** and **provider** via search ("Zoom call with Acme"); they cannot search for a phrase that appears inside the transcript body. Accepted trade-off for v1 per proxy lesson #2 ("ship simple — don't build guardrails without evidence they're needed"). A follow-up spec will introduce a user-features-aware search filter on `packages/search` and, once that lands, transcript text can be added to the index without risking cross-ACL leaks.
- Vector embeddings over the full transcript are explicitly out of scope.
- No `loadCallTranscriptText` helper is introduced — the previous draft's helper relied on the absent runtime ACL filter.

---

## API Contracts

All routes export an `openApi` spec per OM rules.

### Internal: ingest a transcript

`POST /api/customers/call-transcripts/ingest`
- **Auth**: service-to-service only. Called by provider-package webhook handlers after they verify the provider signature and resolve tenant context. Exposed via an `api_key`-gated route guard with the `customers.call_transcripts.manage` feature.
- **Request** (zod, `data/validators.ts`):

```ts
export const callTranscriptIngestSchema = z.object({
  providerId: z.string().min(1),
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
{ status: 'ingested', interactionId: string, attachmentId: string, primaryPersonId: string, participantCount: number }
| { status: 'unmatched', unmatchedTranscriptId: string }
| { status: 'duplicate', interactionId: string }   // idempotency
```

### Read transcript (CRM-scoped, NOT via attachments library)

**(Added per ANALYSIS finding #1 — the global `attachments/api/library` route returns `content` to anyone with `attachments.view`. We must not rely on it for transcripts.)**

`GET /api/customers/interactions/:id/transcript`
- **Auth**: `requireAuth`, `requireFeatures: ['customers.call_transcripts.view']`.
- Resolves the linked attachment for partition `customer-call-recordings`, decrypts `content` via `findOneWithDecryption`, returns the transcript payload.
- **Response**:
```ts
{
  interactionId: string,
  attachmentId: string,
  language: string | null,
  durationSec: number | null,
  text: string,
  segments: Array<{ speaker?: string, startSec: number, endSec: number, text: string }> | null,
  sourceProvider: string,
  sourceMeetingUrl: string,
  participants: Array<{
    id: string,
    customerEntityId: string | null,
    email: string | null,
    phone: string | null,
    displayName: string | null,
    role: 'host' | 'participant' | null,
    matchedVia: string | null,
  }>,
}
```
- The CRM UI ALWAYS uses this route to display transcript text. The global `attachments/api/library` route is NOT used to render transcripts.

### Attachments-library hardening (Finding #1 mitigation, optional but recommended)

The attachments module's library route (`packages/core/src/modules/attachments/api/library/route.ts:124-137`) currently returns `content` for every attachment to any user with `attachments.view`. As a defense-in-depth measure, this spec proposes a small additive change to that route:

- Skip the `content` field for attachments whose partition is flagged `confidentialContent: true`.
- Add `confidentialContent: boolean` to the partition entity (default `false`); set `true` for the `customer-call-recordings` partition in `setup.ts`.

This is a separate (additive) PR if scoped out of v1, but RECOMMENDED to land alongside this feature so transcripts can never leak through the attachments-library UI. If this hardening is deferred, the new transcript route + UI plan above is still safe (UI never asks the library route for transcript text), but a future module that mounts `<AttachmentLibrary>` for the call-recordings partition would re-introduce the leak. Owner: attachments module maintainers.

### Manual reingest

`POST /api/customers/interactions/:id/reingest-transcript`
- **Auth**: `requireAuth`, `requireFeatures: ['customers.call_transcripts.manage']`.
- Resolves the `sourceProvider` + `sourceRecordingId` from the interaction's custom fields, calls `provider.fetchTranscript`, overwrites `Attachment.content` + `storage_metadata.transcription`, emits `customers.call_transcript.reingested`.

### Subject timeline (Person / Company / Deal)

**(Added per ANALYSIS finding #3 — replaces the response-enricher plan with a real query-rewriting mechanism.)**

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

### Unmatched inbox

`GET /api/customers/unmatched-transcripts`
- **Auth**: `requireFeatures: ['customers.unmatched_transcripts.resolve']`.
- **Query**: `page`, `pageSize` (≤100), `providerId?`, `status?`, standard CRUD filters.
- **Response**: paged list including `participantsSummary`, `occurredAt`, `title`, `sourceMeetingUrl`, `providerId`, per-row "can resolve" flag.

`POST /api/customers/unmatched-transcripts/:id/resolve`
- **Auth**: `requireFeatures: ['customers.unmatched_transcripts.resolve']`.
- **Request**: `{ personId: uuid, companyId?: uuid, dealId?: uuid }`.
- Runs routing algorithm with user-picked primary; on success, sets staging `status='resolved'`, `resolvedBy`, `resolvedAt`; returns the created `interactionId`.
- On failure (e.g. Person deleted between list and resolve), returns 409 with an error code consumers can localize.

### Webhook intakes (provider-agnostic contract)

Every transcription provider sub-spec MUST expose a route at `POST /api/webhooks/transcription/<providerId>`, materialized by OM's auto-discovered API route convention (file: `packages/transcription-<vendor>/src/modules/transcription_<vendor>/api/POST/webhooks/transcription/<vendor>.ts`).

The route MUST:
- Verify the provider's signature (HMAC / shared secret / OAuth-token-bound signature — provider's choice, documented in each sub-spec).
- Resolve the tenant (and user, when the provider is per-user) from a provider-specific identifier — examples: Zoom's `account_id` + signed tenant token in the URL path, tl;dv's webhook-secret fingerprint via a provider-owned credentials table. The SPEC-045 integrations vault holds tenant-level enablement marker and (where applicable) tenant-scoped credentials; per-user credentials live in a provider-owned table when needed, since `IntegrationScope` is tenant-scoped.
- Call the internal ingest route `POST /api/customers/call-transcripts/ingest` with a normalized `TranscriptResult`.
- Return 200 `{ status: 'received' }` on successful verification (even when downstream ingest errors — the parent's ingest is idempotent and provider retries should not stack).

Provider-specific details (event names, signature algorithms, payload shapes, URL-validation handshakes, replay windows, etc.) live in each provider's sub-spec. Examples:
- Zoom: see `.ai/specs/2026-04-22-transcription-zoom-adapter.md` §Webhook security.
- tl;dv: see `.ai/specs/2026-04-22-transcription-tldv-adapter.md` §Webhook security (no HMAC).

### OpenAPI helpers

`packages/core/src/modules/customers/api/openapi.ts` gains a `buildCallTranscriptsOpenApi` factory (mirrors the existing `buildCustomersCrudOpenApi`).

---

## Commands & Events

### Commands (undoable where state-changing; see `commands/call-transcripts.ts`)

| Command ID | Input | Result | Undo behavior |
|---|---|---|---|
| `customers.call_transcripts.ingest` | `CallTranscriptIngestInput` | `{ interactionId, attachmentId, primaryPersonId, participantIds[] }` | Delete attachment, participants junction rows, interaction. Cascade event emission on undo: `customers.call_transcript.ingest_reverted` (internal, not clientBroadcast). |
| `customers.call_transcripts.resolve_unmatched` | `{ unmatchedTranscriptId, personId, companyId?, dealId? }` | Same as ingest result + the resolved staging row's snapshot | Undo: re-create staging row from snapshot, delete interaction/attachment/participants. |
| `customers.call_transcripts.reingest` | `{ interactionId }` | `{ interactionId, attachmentId, overwrittenAt }` | Undo: restore previous `Attachment.content` + `storage_metadata.transcription` snapshot. |
| `customers.interaction_participants.manually_link` | `{ participantId, customerEntityId }` | `{ participantId }` | Undo: reset `customerEntityId=null`, `matchedVia=null`. |

All commands invoke `emitCrudSideEffects` with `indexer: { entityType: 'customers:customer_interaction', cacheAliases: [...] }` so the query index + caches refresh, and `emitCrudUndoSideEffects` symmetrically.

### Events (declared in `customers/events.ts`)

```ts
{ id: 'customers.call_transcript.ingested',
  label: 'Call transcript ingested',
  category: 'custom',
  entity: 'customer_interaction',
  clientBroadcast: true,
  persistent: true }
{ id: 'customers.call_transcript.unmatched',
  label: 'Call transcript could not be matched',
  category: 'custom',
  persistent: true }
{ id: 'customers.call_transcript.reingested',
  label: 'Call transcript reingested',
  category: 'custom',
  persistent: true }
{ id: 'customers.call_transcript.ingest_reverted',
  label: 'Call transcript ingest reverted (undo)',
  category: 'system',
  persistent: false,
  excludeFromTriggers: true }
{ id: 'customers.interaction_participant.matched',
  label: 'Interaction participant matched',
  category: 'custom',
  persistent: true }
```

### Subscribers

`subscribers/backfill-participant-match.ts`
- Events: `customers.person.created`, `customers.person.updated` (verified against `packages/core/src/modules/customers/events.ts:10-12`).
- `persistent: true`, `id: 'backfill-participant-match'`.
- Idempotent: uses participant row IDs as the unit of work; updates are `WHERE customer_entity_id IS NULL` and rely on the deterministic `email_hash` / `phone_hash` columns.

`subscribers/notify-unmatched-transcript.ts`
- Event: `customers.call_transcript.unmatched`.
- `persistent: true`.
- Emits an in-app notification of type `customers.unmatched_transcript` (declared in `notifications.ts`) to all users with the `customers.unmatched_transcripts.resolve` feature.

`subscribers/reindex-transcript.ts`
- Events: `customers.call_transcript.ingested`, `customers.call_transcript.reingested`.
- `persistent: true`.
- Calls the search reindex API for the attachment `entity_id` + `record_id`.

---

## UI & UX

All UI uses `@open-mercato/ui` components and the semantic color tokens. No arbitrary Tailwind sizes. `Cmd/Ctrl+Enter` to submit dialogs, `Escape` to cancel.

### Inline transcript rendering on existing detail pages

**(Corrected per ANALYSIS finding #7 — there is no interaction detail page in `customers/backend/`. Verified: only `people/[id]`, `companies/[id]`, `deals/[id]` and their `-v2` variants exist.)**

There is no dedicated interaction detail page in v1. Transcripts surface inline on the existing **Person / Company / Deal detail pages** via the timeline widget. Each timeline row whose `interactionType='call'` becomes expandable with the transcript content, participants, and provider deep-link. This matches how interactions are surfaced today (per SPEC-046b's interactions unification).

A new component `<CallTranscriptCard>` lives in the customers module (`packages/core/src/modules/customers/components/CallTranscriptCard.tsx`) and is rendered inside expanded timeline rows. It fetches transcript content from the dedicated `GET /api/customers/interactions/:id/transcript` route (NOT the global attachments-library route — see API Contracts).

Layout of the expanded card:

1. **Header row**:
   - Provider icon + label ("Zoom call", "tldv call", …).
   - `occurredAt` as a human-readable timestamp (`useT` + `Intl.DateTimeFormat`).
   - `durationSec` formatted `HH:MM:SS` when present.
   - Primary action: **"Open in Zoom"** / **"Open in tldv"** / … as a `<Button asChild>` wrapping `<Link>` to the source meeting URL. Uses provider's `viewLabel`.
   - Secondary action: **"Reingest transcript"** (gated by `customers.call_transcripts.manage`), uses `useGuardedMutation`.

2. **Participants strip**:
   - One pill per `CustomerInteractionParticipant` row, rendered with `<StatusBadge>` and a `<Link>` when `customerEntityId` is set.
   - Matched: clickable → Person detail.
   - Unmatched: non-clickable pill + "Invite to CRM" affordance that opens the existing Person create dialog prefilled with `email`, `phone`, `displayName`. After create, the backfill subscriber matches automatically; a toast confirms the participant is now linked.
   - Host participants show with a small `crown` icon (lucide).

3. **Transcript area**:
   - Full text rendered with preserved line breaks; collapsed to ~12 lines by default with a "Show full transcript" expand affordance.
   - Language chip in the top-right when `language` is set.
   - When `segments` present: a toggle switches to a segmented view (speaker, timestamp, text per row) using `<CollapsibleSection>`.
   - States: `<LoadingMessage>` when fetching, `<ErrorMessage>` on failure, `<EmptyState>` when no transcript (e.g. provider returned empty `text`).

4. **No `<AttachmentLibrary>` mount.** The earlier draft mounted `<AttachmentLibrary partition="customer-call-recordings" readOnly>` — removed because (a) the component does not accept those props per its current implementation, and (b) the global library route would expose `content` outside the customers ACL. Transcript rendering now goes exclusively through the customers-owned route above.

The "deep-link to a specific call" pattern (`/backend/customers/people/<id>#interaction-<callId>`) is handled by the timeline widget: it scrolls the matching row into view and auto-expands its `<CallTranscriptCard>`.

### Unmatched Transcripts inbox — `/backend/customers/unmatched-transcripts`

`backend/customers/unmatched-transcripts/page.tsx`:

- Header: `<PageHeader title={t('customers.unmatched_transcripts.title')} />` with a count badge.
- `<DataTable>`:
  - Columns: Provider, Occurred At, Title, Participants (comma-joined first 3 emails/phones + "…N more"), Created At, row actions.
  - Row action: **Claim** — opens the Claim dialog.
  - Bulk action: **Dismiss** — soft-dismisses rows (sets `status='dismissed'`), feature-gated by `customers.unmatched_transcripts.resolve`.
  - Default `pageSize: 25`, max 100 per OM rules.
  - `emptyState`: `<EmptyState title={t('customers.unmatched_transcripts.empty.title')} description={t('customers.unmatched_transcripts.empty.description')} />`.
  - Filters: provider dropdown, status dropdown.

Claim dialog:
- `<FormField label={t('customers.unmatched_transcripts.claim.person_label')} required>` — Person async-search picker.
- `<FormField label={t('customers.unmatched_transcripts.claim.company_label')}>` — Company async-search picker, optional.
- `<FormField label={t('customers.unmatched_transcripts.claim.deal_label')}>` — Deal async-search picker scoped to the selected Person/Company, optional.
- Submit runs `POST /api/customers/unmatched-transcripts/:id/resolve`.
- On success: close dialog, flash success, row disappears from the table (live event `customers.call_transcript.ingested`).
- On error: inline `<Alert variant="destructive">` inside the dialog.

Notification: the `subscribers/notify-unmatched-transcript.ts` in-app notification links directly to this page when clicked.

### Person / Company / Deal timeline widget updates

The existing timeline widgets switch their data source to `GET /api/customers/interactions/timeline?subjectKind=&subjectId=` (the dedicated route from §API Contracts). This is server-side query rewriting via a real route, NOT a response enricher (response enrichers are additive-only and cannot widen result sets — see Architectural Review Response, finding #3).

Each timeline row whose `interactionType='call'` renders the new `<CallTranscriptCard>` inline (per §"Inline transcript rendering on existing detail pages" above). Call rows display with a `phone` icon and provider tag in the collapsed state; expanding fetches the transcript via the dedicated transcript route.

Performance: one indexed lookup on `customer_interaction_participants(organization_id, tenant_id, customer_entity_id)` plus a bounded join through `customer_people` / `customer_companies` / `customer_deals` for company/deal subjects.

### Sidebar menu item

Add `unmatched_transcripts` menu item into the customers settings submenu via widget injection (`menu:sidebar:settings`):
- Icon: `inbox` (lucide).
- Badge: live count of `status='pending'` rows per tenant; `useAppEvent('customers.call_transcript.unmatched')` + `useAppEvent('customers.call_transcript.ingested')` to auto-refresh.

---

## Internationalization

All user-facing strings live under the `customers` namespace. Key inventory (declared in `packages/core/src/modules/customers/i18n/en.json` and translated files):

```
customers.call_transcripts.title
customers.call_transcripts.open_in_provider          // "Open in {{provider}}"
customers.call_transcripts.reingest                  // "Reingest transcript"
customers.call_transcripts.reingest_confirm          // confirm dialog
customers.call_transcripts.transcript_tab            // "Transcript"
customers.call_transcripts.segments_tab              // "Segments"
customers.call_transcripts.language_chip             // "{{language}}"
customers.call_transcripts.library.empty.title
customers.call_transcripts.library.empty.description

customers.call_transcripts.participants.title        // "Participants"
customers.call_transcripts.participants.matched      // a11y label on matched pill
customers.call_transcripts.participants.unmatched    // a11y label on unmatched pill
customers.call_transcripts.participants.host_badge
customers.call_transcripts.participants.invite_to_crm
customers.call_transcripts.participants.manually_link

customers.unmatched_transcripts.title
customers.unmatched_transcripts.description
customers.unmatched_transcripts.empty.title
customers.unmatched_transcripts.empty.description
customers.unmatched_transcripts.claim                // row action label
customers.unmatched_transcripts.claim_dialog.title
customers.unmatched_transcripts.claim.person_label
customers.unmatched_transcripts.claim.person_required
customers.unmatched_transcripts.claim.company_label
customers.unmatched_transcripts.claim.deal_label
customers.unmatched_transcripts.claim.submit
customers.unmatched_transcripts.claim.error.person_not_found
customers.unmatched_transcripts.dismiss
customers.unmatched_transcripts.notifications.new

customers.audit.call_transcripts.ingest              // audit log
customers.audit.call_transcripts.reingest
customers.audit.call_transcripts.resolve_unmatched
customers.audit.interaction_participants.manually_link
```

Translatable fields: **CREATE** `packages/core/src/modules/customers/translations.ts` (verified absent today per ANALYSIS finding #7). Initial declaration:

```ts
export const translatableFields: Record<string, string[]> = {
  'customers:customer_interaction': ['title'],
}
```

Run `yarn generate` after creation. Participant rows are machine-generated and not user-translatable.

---

## Access Control

New ACL features (declared in `packages/core/src/modules/customers/acl.ts`):

```
customers.call_transcripts.view
customers.call_transcripts.manage
customers.unmatched_transcripts.resolve
```

Default role assignments (seeded in `customers/setup.ts` `defaultRoleFeatures`):

| Feature | superadmin | admin | manager | employee |
|---|:-:|:-:|:-:|:-:|
| `customers.call_transcripts.view` | ✓ | ✓ | ✓ | ✓ |
| `customers.call_transcripts.manage` | ✓ | ✓ | ✓ | — |
| `customers.unmatched_transcripts.resolve` | ✓ | ✓ | ✓ | — |

Each transcription-provider package declares its own ACL features aligned to the OM provider-package convention (`<module>.view` + `<module>.configure`), verified against `packages/gateway-stripe/src/modules/gateway_stripe/acl.ts`. Convention:

```
transcription_<vendor>.view        // read-only access to the provider's integrations card
transcription_<vendor>.configure   // install / reconfigure / rotate / disconnect the provider
```

Webhook intake routes are NOT gated by ACL features — they're signature-authenticated against the tenant's vaulted secret. This applies to every `packages/transcription-<vendor>` sub-spec.

Default role seeding: `admin` + `superadmin` get `.configure`; plus `manager` for `.view`. Individual sub-specs MAY tighten (never loosen) these defaults.

Specifics per provider:
- Zoom: see `.ai/specs/2026-04-22-transcription-zoom-adapter.md` §Access Control.
- tl;dv: see `.ai/specs/2026-04-22-transcription-tldv-adapter.md` §Access Control.

Routes and pages use **declarative guards** (`requireAuth`, `requireFeatures`) from page metadata — never `requireRoles` per the OM security rule.

---

## Backward Compatibility

Reviewed against the 13 contract surfaces in `BACKWARD_COMPATIBILITY.md`. All changes are **additive**. No deprecations, no bridges needed.

| # | Surface | Classification | This spec's changes |
|---|---|---|---|
| 1 | Auto-discovery file conventions | FROZEN | No changes — new files follow existing conventions. |
| 2 | Type definitions & interfaces | STABLE | Additive only: `CallTranscriptProvider`, `TranscriptResult`, `ProviderCtx`, `RecordingSummary`. |
| 3 | Function signatures | STABLE | No changes to existing signatures. |
| 4 | Import paths | STABLE | New path `@open-mercato/shared/modules/customers/transcription`. |
| 5 | Event IDs | FROZEN | Additive only: 5 new event IDs, none reused. |
| 6 | Widget injection spot IDs | FROZEN | No changes. Uses existing `menu:sidebar:settings` spot. |
| 7 | API route URLs | STABLE | Additive only: 4 new routes under `customers`, 1 webhook route per provider package. |
| 8 | Database schema | ADDITIVE-ONLY | 2 new tables + 6 new interaction custom fields. No renames, no drops. |
| 9 | DI service names | STABLE | New multi-provider token `callTranscriptProviders`. |
| 10 | ACL feature IDs | FROZEN | 3 new feature IDs in customers + 2 per provider package. |
| 11 | Notification type IDs | FROZEN | 1 new type `customers.unmatched_transcript`. |
| 12 | CLI commands | STABLE | No new CLI in v1 (future optional: `yarn mercato customers reingest-call-transcript <id>`). |
| 13 | Generated file contracts | STABLE | No changes to generator output shapes. |

Release notes entry:
> **CRM Call Transcriptions (OSS).** Added automatic ingestion of call transcripts from external meeting tools. Ships with a Zoom reference adapter; provider contract `@open-mercato/shared/modules/customers/transcription`. New data: `customer_interaction_participants` junction, `customer_unmatched_transcripts` staging table. New events: `customers.call_transcript.ingested`, `.unmatched`, `.reingested`, `customers.interaction_participant.matched`. All changes additive.

---

## Risks & Impact Review

| Risk | Severity | Affected area | Mitigation | Residual |
|---|---|---|---|---|
| Provider webhook spoofing | High | Security | Provider packages MUST verify signatures; handler rejects on mismatch with 401. | Low |
| PII leakage via transcripts (health, religion, etc. in call content) | High | Privacy / GDPR | `Attachment.content` encrypted at rest via NEW `attachments/encryption.ts`; participants email/phone encrypted via extended `customers/encryption.ts` with hash columns; ACL-gated read route (`GET /api/customers/interactions/:id/transcript`); source-tool consent prompt is the capture point. | Medium — OM cannot enforce consent the tool didn't capture. |
| **Transcript content leak via global attachments-library route** *(ANALYSIS finding #1)* | High | Security | Transcript reads NEVER use `attachments/api/library` — that route returns `content` to anyone with `attachments.view`. CRM UI uses the dedicated `GET /api/customers/interactions/:id/transcript` route gated by `customers.call_transcripts.view`. RECOMMENDED additive hardening: add `confidentialContent: boolean` flag to `AttachmentPartition`, default false, true for `customer-call-recordings`; the library route skips `content` for confidential partitions. Defense-in-depth — see API Contracts. | Low if hardening lands; Medium if deferred (no UI surface in v1 mounts the library against this partition, but a future module could). |
| Email matching false positive (shared inbox alias like `sales@acmeco.com` matched to a dummy Person) | Medium | Data quality | Exact match only — no fuzzy, no domain-based fallback. Require `primary_email` on the Person to be exact. Warn in admin UI when a matched email is flagged as role-account in the dictionaries. | Low |
| Queue saturation on bulk backfill (tenant imports 10k People, subscriber fires 10k matching passes) | Medium | Performance | Subscriber batches 200 participant rows per emission; worker concurrency capped per-tenant; events are `persistent: true` so queue retries absorb spikes. | Low |
| Idempotency breakage on provider replay (Zoom replays `recording.transcript_completed` webhook) | Medium | Data quality | Command checks `(sourceProvider, sourceRecordingId)` via query index before insert; duplicate submissions return `{status: 'duplicate'}`. | Low |
| Stale provider credentials mid-polling | Low | Reliability | Polling worker catches auth errors, marks the integration as `needs_reconnect` in the vault, notifies admins. | Low |
| Retroactive match latency for bulk imports | Low | UX | Subscriber is persistent + batched; UX accepts that a bulk-imported 10k contact set may take minutes before historical calls surface. | Low |
| GDPR right-to-forget on a Person with historical transcripts | Medium | Privacy | Deleting a Person: participant rows are cascaded (FK ON DELETE CASCADE). Interactions where the deleted person was primary: `entity_id` set to another matched participant; if none remain, the interaction is moved to `customer_unmatched_transcripts` for review. | Medium — requires documented operator flow. |
| Transcript indexing cost (1-hour Zoom call ≈ 30k chars) | Low | Performance | Attachment content search indexing is async + tenant-scoped; vector embeddings explicitly out of scope. | Low |
| Webhook handler downtime loses transcripts | Medium | Reliability | Polling fallback catches up within the polling interval. Provider packages SHOULD surface a missed-ingestion indicator in the admin UI. | Low |

---

## Integration Test Coverage

Tests live in `packages/core/src/modules/customers/__integration__/` and `packages/transcription-zoom/src/__integration__/`, per `.ai/qa/AGENTS.md`. Each test is self-contained: fixtures created via API in setup, cleaned up in teardown, no reliance on seed data.

### API / pipeline tests (`customers` module)

| ID | Path | Covers |
|---|---|---|
| TC-CRM-CT-001 | `POST /api/customers/call-transcripts/ingest` happy path | All participants match → interaction + attachment + N participants created; events fired. |
| TC-CRM-CT-002 | Ingest with zero matches | Staging row created; `customers.call_transcript.unmatched` fired; no interaction. |
| TC-CRM-CT-003 | Ingest with partial matches | Matched + unmatched participants coexist in junction; primary selected by algorithm. |
| TC-CRM-CT-004 | Primary selection precedence | Deterministic tie-breakers (single active deal → most-recent deal → first matched). |
| TC-CRM-CT-005 | Idempotent replay | Same `(sourceProvider, sourceRecordingId)` ingested twice → second returns `duplicate`. |
| TC-CRM-CT-006 | Reingest overwrite | `POST /reingest-transcript` overwrites `Attachment.content`; old `storage_metadata` snapshotted for undo. |
| TC-CRM-CT-007 | Unmatched list + resolve | List → claim with person → interaction created; staging row resolved. |
| TC-CRM-CT-008 | Unmatched resolve with deleted person (409) | Person deleted between list and resolve → 409 + localized error code. |
| TC-CRM-CT-009 | Retroactive match on Person create | Unmatched participant with email X → create Person with `primary_email=X` → subscriber backfills; `customers.interaction_participant.matched` fired. |
| TC-CRM-CT-010 | Retroactive match on email update | Existing Person's email updated to match → backfill still triggers. |
| TC-CRM-CT-011 | Timeline union on Person page | Person is in participants junction but not primary → appears on timeline. |
| TC-CRM-CT-012 | Timeline union on Deal page | Deal linked via a participant's Person → appears on deal timeline. |
| TC-CRM-CT-013 | Undo `ingest` command | Deletes attachment, participants, interaction. |
| TC-CRM-CT-014 | Undo `resolve_unmatched` | Recreates staging row from snapshot. |
| TC-CRM-CT-015 | ACL gating | User without `customers.call_transcripts.view` cannot read transcript content. |
| TC-CRM-CT-016 | ACL gating (unmatched) | User without `customers.unmatched_transcripts.resolve` cannot list/claim. |
| TC-CRM-CT-017 | Participant CHECK constraint | Insert with both `email=null` and `phone=null` → DB rejects. |
| TC-CRM-CT-018 | Encrypted fields round-trip | Transcript `content`, participant `email`/`phone` encrypted on write, decrypted on authorized read. |
| TC-CRM-CT-019 | Global search hit | Searching by interaction title ("Zoom call with Acme") and by provider source → search API returns the matching interaction. Searching by a phrase that appears ONLY inside the transcript body returns no hit (transcript body is not indexed in v1 — see §Search configuration). |
| TC-CRM-CT-020 | Unmatched inbox notification | `customers.call_transcript.unmatched` → notification created for eligible users. |

### UI tests (`customers` module, Playwright)

| ID | Flow |
|---|---|
| TC-CRM-CT-UI-001 | **Person timeline**: expanding a `call` row mounts `<CallTranscriptCard>`; transcript text + language chip render after fetch from `GET /api/customers/interactions/:id/transcript`. |
| TC-CRM-CT-UI-002 | **Person timeline**: `<CallTranscriptCard>` "Open in Zoom" button targets `Attachment.url` (provider deep-link). |
| TC-CRM-CT-UI-003 | **Person timeline**: unmatched participant pill → "Invite to CRM" creates Person draft, backfill subscriber matches on save, pill turns into a clickable Person link via SSE refresh. |
| TC-CRM-CT-UI-004 | **Unmatched inbox**: DataTable renders pending rows; `Claim` dialog opens; Cmd+Enter submits; row disappears via live event. |
| TC-CRM-CT-UI-005 | Unmatched inbox empty state renders per DS rules. |
| TC-CRM-CT-UI-006 | **Person / Company / Deal timeline union**: a call where the subject is in the participants junction (not the primary entity) appears in the timeline by virtue of the `GET /api/customers/interactions/timeline` route. |
| TC-CRM-CT-UI-007 | Sidebar badge updates live on new unmatched arrival (SSE). |
| TC-CRM-CT-UI-008 | Escape cancels Claim dialog; focus returns to the triggering row action. |
| TC-CRM-CT-UI-009 | Reingest button on `<CallTranscriptCard>` is hidden for users lacking `customers.call_transcripts.manage`. |
| TC-CRM-CT-UI-010 | **Deep-link**: navigating to `/backend/customers/people/<id>#interaction-<callId>` scrolls the matching row into view and auto-expands its `<CallTranscriptCard>`. |
| TC-CRM-CT-UI-011 | **ACL on transcript route**: a user without `customers.call_transcripts.view` gets 403 on `GET /api/customers/interactions/:id/transcript`; the card shows `<ErrorMessage>` accordingly. |
| TC-CRM-CT-UI-012 | **Timeline ACL gating**: a user with `customers.interactions.view` but without `customers.people.view` gets 403 on `GET /api/customers/interactions/timeline?subjectKind=person&subjectId=…`. |

### Provider package tests

Each `packages/transcription-<vendor>` adapter owns its own test matrix. Test IDs are namespaced per provider (`TC-ZOOM-*`, `TC-TLDV-*`, …) and are defined in the respective sub-spec:

- Zoom: `.ai/specs/2026-04-22-transcription-zoom-adapter.md` §Integration Test Coverage (TC-ZOOM-001..019 + UI-001..004).
- tl;dv: `.ai/specs/2026-04-22-transcription-tldv-adapter.md` §Integration Test Coverage (TC-TLDV-001..018 + UI-001..002).

The parent spec's test matrix (above) covers only the customers-module pipeline and the module-agnostic contract; provider-specific signature verification, VTT parsing, URL-validation handshakes, plan-gate checks, etc. live in the sub-specs. An implementer of a new transcription provider does not need a parent-spec test entry — they define their adapter's tests in their own sub-spec.

---

## Implementation Phases

Each phase produces a running, testable app increment. A phase is only "done" when all tests in its scope pass and the code-review gate succeeds.

### Phase 1 — Data model, contract, internal ingest

1. Declare entities: `CustomerInteractionParticipant` (with `email_hash`/`phone_hash` columns + CHECK constraint), `CustomerUnmatchedTranscript`.
2. Declare custom fields on `customer_interaction` in `ce.ts` (`durationSec`, `direction`, `sourceProvider`, `sourceRecordingId`, `sourceMeetingUrl`, `language`).
3. Seed `customer-call-recordings` attachment partition in `attachments/setup.ts` (with the new `confidentialContent: true` flag — see Risks; ship the partition flag and the library-route skip together).
4. **CREATE** `packages/core/src/modules/attachments/encryption.ts` with `entityId: 'attachments:attachment', fields: [{field: 'content'}]`.
5. **EXTEND** `packages/core/src/modules/customers/encryption.ts` with the participants entry (email/phone with hashField, display_name).
6. Register ACL features in `customers/acl.ts` + defaults in `setup.ts`.
7. Declare events in `customers/events.ts` (5 new IDs per §Commands & Events).
8. **CREATE** `packages/core/src/modules/customers/translations.ts` with `customer_interaction.title`.
9. Create `packages/shared/src/modules/customers/transcription.ts` (generic `CallTranscriptProvider<TCredentials>` + `JsonValue` + zod schemas).
10. Create DI multi-provider token `callTranscriptProviders`.
11. Create command `customers.call_transcripts.ingest` in `customers/commands/call-transcripts.ts` (routing algorithm using hash-based lookups + `withAtomicFlush`).
12. Create internal API route `POST /api/customers/call-transcripts/ingest` with openApi + api-key guard.
13. **Create dedicated read route** `GET /api/customers/interactions/:id/transcript` gated by `customers.call_transcripts.view` (Finding #1 mitigation).
14. **Create dedicated timeline route** `GET /api/customers/interactions/timeline?subjectKind=&subjectId=` (Finding #3 mitigation).
15. Create a **stub provider** `customers/lib/__tests__/stub-transcript-provider.ts` for tests only.
16. **Register the `call_transcripts` marketplace hub** (ANALYSIS 2026-04-22-transcription-provider-specs.md finding #5). Every change is additive:
    - Extend `packages/core/src/modules/integrations/backend/integrations/filters.ts` — add `'call_transcripts'` to `INTEGRATION_MARKETPLACE_CATEGORIES`.
    - Extend `packages/core/src/modules/integrations/i18n/{en,pl,...}.json` — add `integrations.marketplace.categories.call_transcripts` copy for every locale shipped today.
    - Add a `call_transcripts` icon mapping where category icons are resolved (grep for `integrations.marketplace.categories.` to find the icon/registry site; if none exists, fall back to the generic "phone" lucide icon, and document the fallback in the i18n file).
    - Seed the hub descriptor in `packages/core/src/modules/integrations/lib/hubs.ts` (or wherever `IntegrationHubId` values get registered as runtime descriptors) so the marketplace page knows the hub's title/description at render time.
    - This step is a precondition for every `packages/transcription-<vendor>` adapter. Without it, provider cards render with missing category treatment.
17. Run `yarn generate` (translations + events + DI), then `yarn db:generate` + commit the generated migration.
18. Run `yarn mercato configs cache structural --all-tenants` (nav/category surfaces changed).
19. Integration tests: TC-CRM-CT-001..005, 015, 017, 018.

**Result**: running app with a working internal ingest path exercised by tests via a stub provider. ACL-safe transcript read route in place. Encryption end-to-end. No real Zoom yet; no UI yet.

### Phase 2 — Zoom provider package

Phase 2 is specified in detail in the dedicated Zoom sub-spec `.ai/specs/2026-04-22-transcription-zoom-adapter.md`. Summary:

1. `packages/transcription-zoom/` scaffolded per OM provider-package convention (`src/modules/transcription_zoom/...`).
2. `provider.ts` implements `CallTranscriptProvider.fetchTranscript` + `.listRecentRecordings` (VTT parse, HMAC-SHA256 webhook verify, plan gate).
3. `api/POST/webhooks/transcription/zoom.ts` — auto-discovered webhook route; verifies signature; resolves tenant; submits to internal ingest.
4. `workers/poll-zoom.ts` — scheduled worker.
5. `integration.ts` — SPEC-045 marketplace entry under `hub: 'call_transcripts'`.
6. `di.ts` — registers provider under `callTranscriptProviders`.
7. `acl.ts` — `transcription_zoom.view`, `transcription_zoom.configure`.
8. i18n for provider copy.
9. Integration tests TC-ZOOM-001..018 (mocked Zoom API).
10. `.env.example` documents `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET`, `ZOOM_WEBHOOK_SECRET_TOKEN`.

**Result**: a tenant connects Zoom in Integrations Marketplace; real Zoom meetings ingest automatically end-to-end.

### Phase 3 — CRM UI surfaces

1. Create `packages/core/src/modules/customers/components/CallTranscriptCard.tsx` — fetches via `GET /api/customers/interactions/:id/transcript`. Renders Source row, Participants strip with matched/unmatched pills, "Invite to CRM" affordance, transcript with collapse/expand, optional segments view, "Open in <provider>" deep-link, "Reingest" action (gated).
2. Extend the existing Person / Company / Deal timeline widgets to:
   - Use `GET /api/customers/interactions/timeline?subjectKind=&subjectId=` (the new dedicated endpoint, Finding #3 fix).
   - Render `<CallTranscriptCard>` inline in each `interactionType='call'` row.
   - Subscribe to `useAppEvent('customers.call_transcript.ingested')` for live refresh.
   - Honor `#interaction-<id>` URL hash for deep-link scroll-and-expand.
3. i18n keys populated for `en` locale; other locales stubbed.
4. Integration tests TC-CRM-CT-011, 012, 019 + UI TC-CRM-CT-UI-001..003, 006, 009.

**Result**: users see call transcripts inline on Person / Company / Deal timelines, with live refresh. No new interaction detail page; everything surfaces via existing pages.

### Phase 4 — Unmatched inbox + retroactive matching

1. `backend/customers/unmatched-transcripts/page.tsx` + `page.meta.ts`.
2. `api/unmatched-transcripts/route.ts` (list) + `api/unmatched-transcripts/[id]/resolve/route.ts` (claim).
3. Command `customers.call_transcripts.resolve_unmatched` with undo.
4. Subscriber `subscribers/backfill-participant-match.ts` (batched).
5. Subscriber `subscribers/notify-unmatched-transcript.ts` + notification type.
6. Widget injection for sidebar badge.
7. Integration tests TC-CRM-CT-002, 007, 008, 009, 010, 014, 020 + UI TC-CRM-CT-UI-004, 005, 007, 008.

**Result**: zero-match transcripts land in the inbox; claim flow works; adding a new Person retroactively surfaces past calls.

### Phase 5 — Hardening

1. **Search**: extend `customers/search.ts` with the `customers:customer_interaction` entry from §Search; create `customers/lib/searchTranscript.ts` helper for decryption-aware transcript loading. Reindex existing call interactions via `yarn mercato search reindex --entity customers:customer_interaction`.
2. Manual reingest command + API route + UI action (if not already in Phase 3).
3. **Optional but recommended**: land the attachments-library `confidentialContent` partition flag + library-route skip if not bundled in Phase 1 — coordinate with attachments module owners.
4. Full `__integration__` test sweep; address flakes.
5. Code-review gate (`om-code-review`).
6. Release notes entry.
7. Spec changelog updated; move spec to `.ai/specs/implemented/` after deploy.

**Result**: feature-complete, release-ready.

---

## Assumptions

1. **Ingest is fully automatic** — provider webhook (primary) + polling fallback. No manual upload.
2. **Provider scope v1**: Zoom only; all others are community-driven follow-ups.
3. **OM does not transcribe.** The interface has `fetchTranscript` only; no `transcribe(audio)`.
4. **Retention**: OM keeps transcripts forever by default. Audio/video lives on the source tool.
5. **Consent**: captured by the source tool; OM only stores what's provided.
6. **Diarization**: transcript as single blob; segments passed through when supplied.
7. **Routing**: email + phone deterministic, many-to-many via junction. Polymorphic from day one to unblock v2 CTI.
8. **Retroactive matching**: persistent subscriber on Person create/update.
9. **Unmatched inbox**: human-claim required when zero matches.
10. **ACL**: new features `customers.call_transcripts.view|manage` + `customers.unmatched_transcripts.resolve`.
11. **Credentials**: tenant-scoped credentials live in the SPEC-045 integrations vault. Provider packages whose authentication model is per-user (e.g. tl;dv) own their own encrypted credentials table inside the provider package and store only a tenant-level enablement marker in the vault — the shared vault's `IntegrationScope` is tenant-scoped only.
12. **GDPR**: transcript content + participant email/phone encrypted at rest.
13. **Real-time UX**: clientBroadcast events drive live refresh; no top-bar progress pill needed.
14. **Scope (v1)**: meeting-SaaS only. CTI / PBX, voicemail, SMS voice, LLM summaries, action items = out of scope.

---

## Follow-up Tracks

Not in this spec; each gets its own.

- **CTI / PBX ingest (v2)** — Zammad-style Generic CTI via `packages/webhooks`. Adds a second provider interface `CallEventProvider` (start/answer/hangup events, caller-ID popup). Phone-number matching path already supported by v1's polymorphic participant identity. First adapter candidates: Twilio, Asterisk Generic CTI. Estimated +4–6 atomic commits per adapter.
- **Meetily adapter** — `packages/transcription-meetily`. On-device desktop app. Auth = per-user API key, not tenant OAuth. Implements `CallTranscriptProvider.fetchTranscript`; no webhook (desktop pushes to OM). ~2–3 atomic commits.
- **tl;dv adapter** — see dedicated sub-spec `.ai/specs/2026-04-22-transcription-tldv-adapter.md`. Live-API-verified provider profile (per-user `x-api-key`, `TranscriptReady` webhook, polling fallback). **Critical limitation captured**: tl;dv's `invitees[]` is empty for ad-hoc meetings → organizer-only deterministic matching by default; non-organizer speakers preserved as display-only segment metadata. v2 calendar-enrichment (Google Calendar / Outlook attendees lookup via `extraProperties.conferenceId`) is the long-term fix and gets its own spec.
- **Other meeting-SaaS providers** — `packages/transcription-meet`, `…-fireflies`, `…-otter`, `…-loom`, `…-gong`, `…-grain`. Each is one follow-up spec targeting the same `CallTranscriptProvider` contract.
- **AI-driven downstream features** — summaries, action-item extraction, sentiment, next-step suggestions, "what did we commit to?" digests. All layer on top via the unified AI tooling stack (`.ai/specs/2026-04-11-unified-ai-tooling-and-subagents.md`) using the baseline attachment tool pack to read `Attachment.content`. No data model changes needed.
- **Retention worker** — OM-side transcript pruning (e.g. delete transcripts older than N months). Separate spec.
- **Vector embeddings over transcripts** — semantic search. Uses existing `search` module vector strategy. Separate spec once AI tooling lands.
- **Transcript export** — per-user or per-deal "give me all transcripts as a zip." Low priority.
- **Provider-side mutations** — e.g. "delete transcript in Zoom when deleted in OM." Deferred until demand is concrete; introduces mutation-capable provider interface.

---

## Downstream alignment — Unified AI Tooling (PR #1478 / 2026-04-11 spec)

Verified. No architectural conflict.

- Transcripts land in the existing attachments module's `Attachment.content`. The unified AI spec reuses that module for attachment context (`D9. File Upload Storage`).
- Future focused agents (`customers.sales-intel`, `customers.call-summarizer`, …) can read transcripts via the planned baseline attachment tool pack. No additional AI tools required by this spec.
- AI-driven mutations are deferred in the unified AI spec; our manual Reingest is a regular user action, not an agent action.
- The attachment-to-model bridge handles text-like files transparently — transcripts fit the text-like case.

This spec ships independently; the AI stack layers on top when its own implementation lands.

---

## Final Compliance Report — 2026-04-22

### AGENTS.md Files Reviewed

- `AGENTS.md` (root)
- `packages/core/AGENTS.md`
- `packages/shared/AGENTS.md`
- `packages/core/src/modules/customers/AGENTS.md`
- `packages/core/src/modules/integrations/AGENTS.md`
- `packages/search/AGENTS.md`
- `packages/webhooks/AGENTS.md`
- `packages/events/AGENTS.md`
- `packages/cache/AGENTS.md`
- `packages/queue/AGENTS.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|---|---|---|---|
| root AGENTS.md | Entities singular, tables plural snake_case | Compliant | `CustomerInteractionParticipant` → `customer_interaction_participants`; `CustomerUnmatchedTranscript` → `customer_unmatched_transcripts`. |
| root AGENTS.md | No direct ORM relationships between modules | Compliant | All cross-module references use FK IDs (`customer_entity_id`, `interaction_id`, attachment `record_id`). |
| root AGENTS.md | Filter by `organization_id` on every tenant-scoped query | Compliant | Every new entity carries `organization_id` + `tenant_id`; routing algorithm, retroactive subscriber, and read routes all scope explicitly. |
| root AGENTS.md | DI (Awilix) — no direct `new` | Compliant | Providers registered via `callTranscriptProviders` DI token; commands and services resolved from the container. |
| root AGENTS.md | Event IDs `module.entity.action`, singular entity, past tense | Compliant | `customers.call_transcript.ingested`, `.unmatched`, `.reingested`, `customers.interaction_participant.matched`. |
| root AGENTS.md | `requireFeatures` (declarative), never `requireRoles` | Compliant | All new routes and pages use `requireFeatures`. |
| root AGENTS.md | No hardcoded user-facing strings (i18n only) | Compliant | Parent owns `customers.call_transcripts.*` + `customers.unmatched_transcripts.*` keys; `customers/translations.ts` created. |
| root AGENTS.md | Cmd/Ctrl+Enter + Escape on every dialog | Compliant | Claim dialog and provider connect dialogs honor both shortcuts. |
| root AGENTS.md | DS rules — semantic tokens only, no arbitrary text sizes | Compliant | `<StatusBadge>`, `<Alert>`, `<EmptyState>`, `<LoadingMessage>` from `@open-mercato/ui`. |
| root AGENTS.md | Integration tests live alongside the feature, self-contained | Compliant | `packages/core/src/modules/customers/__integration__/` + each provider's `__integration__/`. |
| root AGENTS.md | Generated files committed after `yarn generate` + `yarn db:generate` | Verify at PR time | Runtime gate — spec declares the files and commands to run. |
| packages/core/AGENTS.md | Auto-discovered routes at `api/<method>/<path>.ts` | Compliant | `api/POST/customers/call-transcripts/ingest.ts`, `api/POST/webhooks/transcription/<vendor>.ts`, `api/GET/customers/interactions/[id]/transcript.ts`, timeline route. |
| packages/core/AGENTS.md | API routes MUST export `openApi` | Compliant | Every new route listed in §API Contracts with `openApi` asserted. |
| packages/core/AGENTS.md | CRUD write operations via Command pattern with undo | Compliant | 4 commands declared (`ingest`, `resolve_unmatched`, `reingest`, `manually_link`); undo behavior documented per command. |
| packages/core/AGENTS.md | `withAtomicFlush` for multi-phase mutations | Compliant | Routing algorithm wraps all 6 writes in one `withAtomicFlush` with `transaction: true` per SPEC-018. |
| packages/core/AGENTS.md | ACL features in `acl.ts` + defaults in `setup.ts` | Compliant | 3 features declared (`customers.call_transcripts.view|manage`, `customers.unmatched_transcripts.resolve`); defaults seeded. |
| packages/core/AGENTS.md | Encryption maps updated when storing regulated fields | Compliant | New `attachments/encryption.ts` + extended `customers/encryption.ts` for participants (with `email_hash` / `phone_hash`). |
| packages/core/AGENTS.md | `findWithDecryption` / `findOneWithDecryption` for encrypted rows | Compliant | Read-path discipline documented in §Encryption; search helper not needed in v1 (transcript body not indexed). |
| packages/core/AGENTS.md | Custom fields declared in `ce.ts` | Compliant | 6 new CFs on `customer_interaction` declared in §Data Models. |
| packages/core/AGENTS.md | Events via `createModuleEvents` with `as const` | Compliant | 5 new events added to `customers/events.ts`. |
| packages/shared/AGENTS.md | No `any` / `unknown` in shared types | Compliant | `CallTranscriptProvider<TCredentials>` is generic; `providerMetadata: Record<string, JsonValue>` with recursive `JsonValue` + `jsonValueSchema` / `providerMetadataSchema` zod exports. |
| packages/shared/AGENTS.md | Narrow, typed interfaces | Compliant | Shared contract exports only the provider interface + result/summary/ctx types. |
| packages/search/AGENTS.md | Sensitive fields in `fieldPolicy.excluded` or `hashOnly` | Compliant | Transcript body NOT indexed (v1 scope). `customers:customer_interaction` config indexes only `title` + `source`. |
| packages/search/AGENTS.md | `checksumSource` in every `buildSource` return | Compliant | Declared in §Search configuration. |
| packages/search/AGENTS.md | `formatResult` for token strategy | Compliant | Declared in §Search configuration. |
| packages/core/src/modules/integrations/AGENTS.md | Provider packages use auto-discovered routes, not `registerWebhookHandler` | Compliant | Transcription adapters use `api/POST/webhooks/transcription/<vendor>.ts`; parent §Proposed Solution.2 documents the convention. |
| packages/core/src/modules/integrations/AGENTS.md | `integration.ts` per provider with `hub` value | Compliant | New `call_transcripts` hub introduced; each sub-spec declares `integration.ts` against it. |
| packages/core/src/modules/integrations/AGENTS.md | Tenant-scoped credential vault | Compliant | Zoom stores tenant-scoped credentials in the vault. tl;dv (per-user) owns its own encrypted credentials table and stores only a tenant enablement marker in the vault (documented in §Proposed Solution.1 and the tl;dv sub-spec). |
| packages/webhooks/AGENTS.md | Signed webhook intake; raw body preserved for HMAC | Compliant | Each provider sub-spec documents signature scheme + raw-body discipline. |
| packages/events/AGENTS.md | `clientBroadcast: true` only on UI-affecting events | Compliant | `customers.call_transcript.ingested` is broadcast; unmatched/reingested/matched are persistent but not broadcast. |
| packages/cache/AGENTS.md | Tag-based invalidation on writes | Compliant | CRUD side effects on `customers:customer_interaction` fire cache aliases via `emitCrudSideEffects`. |
| packages/queue/AGENTS.md | Idempotent workers, concurrency declared | Compliant | Polling workers per sub-spec declare concurrency-1 per scope, idempotency check against parent's query index. |
| BACKWARD_COMPATIBILITY.md | All 13 contract surfaces — additive-only | Compliant | Full matrix in §Backward Compatibility. No renames, no drops, no breaking changes. |

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
