# SPEC-076 — Phone Calls Core Hub & Tillio Provider

**Date**: 2026-06-09
**Status**: Draft
**Scope**: Open Mercato core + official provider package
**Supersedes**: 2026-05-05-phone-calls-core-hub-and-tillio-provider
**Related**: SPEC-045, SPEC-045d, SPEC-056, SPEC-057, SPEC-046b, 2026-03-29-integration-commands-events, 2026-04-21-crm-call-transcriptions, PR #1647 `feat(inbox_ops): make InboxOps intake source-oriented`, 2026-05-05-meeting-transcripts-separate-domain-boundary, local hackathon `src/modules/phone_calls`

## TLDR

Add `phone_calls` as an official Open Mercato core hub for short VOIP calls. The core hub owns normalized call lifecycle, participants, recordings, transcript versions, summary/fact versions, provider-neutral APIs, and source adapters for downstream workflows. Provider packages, starting with `@open-mercato/phone-calls-tillio`, own credentials, provider APIs, webhook verification, payload normalization, and health checks.

The Personal Communication Hub is not the source of truth for calls. It receives a projection/activity from `phone_calls` so operators can see VOIP events alongside email, WhatsApp, and internal messages. Domain work such as creating service tickets flows through InboxOps source-native intake or domain module commands, not through provider code and not through direct cross-module ORM relationships.

## Problem Statement

Open Mercato needs a reusable way to ingest and act on VOIP calls. The hackathon app already proves the value: Tillio calls can be imported, summarized, transcribed, and used to create service tickets. That implementation is intentionally app-local and mixes provider integration, call storage, transcript generation, service-ticket shortcuts, settings UI, and provider-specific webhook routes.

That shape is not suitable for core Open Mercato because:

1. Provider logic is hard-wired to Tillio route names, credentials, token setup, and payload shape.
2. Call storage contains app-specific links such as service ticket, customer, and contact ids.
3. The settings surface bypasses the Integration Marketplace.
4. Webhook handling is provider-specific instead of using the shared webhooks module.
5. Phone calls are not the same domain as chat messages, email messages, or meeting transcripts.
6. New Tillio fields would currently require ad hoc changes unless a stable provider evolution contract exists.
7. Downstream extraction/action review should reuse InboxOps source-native intake rather than create a second review pipeline.

## Goals

1. Introduce a reusable core `phone_calls` hub module.
2. Introduce a shared provider adapter contract and registry.
3. Ship an official Tillio provider package.
4. Store provider-neutral call, participant, transcript, and summary data.
5. Preserve raw provider payloads for audit and future backfill.
6. Support provider payload evolution without breaking existing callers.
7. Project calls into the Personal Communication Hub for unified communication visibility.
8. Integrate with InboxOps source-native intake when installed.
9. Keep domain object creation outside provider packages and outside the core call aggregate.
10. Support pull/backfill as the phase-1 ingestion path and webhooks when provider semantics are confirmed.

## Non-Goals

1. Do not model multi-participant meeting transcripts. Those belong in a separate `meeting_transcripts` domain.
2. Do not store calls only as generic Messages.
3. Do not put service-ticket, CRM, or sales foreign keys on the official `PhoneCall` aggregate.
4. Do not create a provider-specific public route in core when the shared webhooks module can own inbound routing.
5. Do not create a local proposal/discrepancy engine inside `phone_calls`.
6. Do not require InboxOps or the Personal Communication Hub for `phone_calls` to be installable.
7. Do not model SMS. SMS is messaging-shaped and belongs under `communication_channels`.

## Terminology

| Term | Meaning |
|------|---------|
| Phone call | A short VOIP call, usually caller/callee or caller/agent, with call lifecycle and optional recording |
| Provider | External VOIP provider such as Tillio |
| Core hub | Core module that owns provider-neutral storage and lifecycle |
| Provider package | Official package that integrates one external provider |
| Personal Communication Hub | Unified operator communication layer built from `communication_channels`, Messages, and related SPEC-045d concepts |
| Communication projection | A provider-neutral activity/message representation of a call for unified inbox/timeline UX |
| Source-native InboxOps | InboxOps flow that accepts non-email source submissions directly |

## Proposed Solution

Create a two-layer architecture:

```text
Provider package
  -> validates credentials
  -> verifies provider webhooks
  -> calls provider APIs
  -> normalizes provider payloads
  -> invokes core commands

Core phone_calls hub
  -> stores canonical call aggregate
  -> stores participants
  -> stores transcript and summary versions
  -> emits call lifecycle events
  -> provides read and mutation APIs
  -> projects to Personal Communication Hub
  -> submits to InboxOps when installed

Domain modules
  -> consume InboxOps proposals or phone_calls events
  -> create service tickets, customer interactions, sales tasks, notes, etc.
```

The provider package is replaceable. The core data model and APIs are stable. The Personal Communication Hub sees a projection of the call, while `phone_calls` remains the durable operational source of truth.

## Relationship To CRM Call Transcriptions

The existing `2026-04-21-crm-call-transcriptions` spec is the closest prior architecture reference and should be treated as a sibling design, not ignored. That spec introduces a `call_transcripts` hub for meeting-tool transcripts such as Zoom and tl;dv. It explicitly excludes CTI / PBX / phone-call events, voicemail, and SMS voice.

This spec covers the excluded VOIP/CTI side:

| Area | `call_transcripts` | `phone_calls` |
|------|--------------------|---------------|
| Primary source | Meeting tools and finished meeting transcripts | VOIP / CTI / PBX call providers |
| Examples | Zoom, tl;dv, Fireflies, Meetily | Tillio, Aircall-like providers, PBX/phone integrations |
| Source of truth | Transcript aggregate | Phone-call lifecycle aggregate |
| Lifecycle | Transcript ingested after meeting/call artifact exists | Call started/ringing/answered/missed/completed plus optional artifacts |
| Participants | Meeting attendees | Caller, callee, agent |
| Recording | Deep-link/source metadata | Provider recording can be first-class call artifact |
| CRM exposure | Deferred/projection consumer | Deferred/projection consumer |
| SMS | Out of scope | Out of scope; use `communication_channels` |

Shared patterns to reuse from `call_transcripts`:

1. dedicated core hub plus provider packages
2. Integration Marketplace hub registration
3. shared `@open-mercato/webhooks` inbound route
4. provider registry pattern
5. provider-owned webhook verification
6. raw payload preservation
7. optional downstream CRM projection instead of core CRM ownership

Open question for architects: whether `phone_calls` and `call_transcripts` should remain separate hubs long term, or whether a later common abstraction should exist below both. This spec assumes separate hubs for now because phone calls have lifecycle states and routing semantics that finished meeting transcripts do not.

## Core Architectural Rules

1. Provider packages MUST NOT write `phone_calls` ORM entities directly.
2. Provider packages MUST return normalized DTOs and invoke core commands.
3. Core `PhoneCall` MUST contain provider-neutral fields only.
4. Domain links MUST live in extension/projection modules or downstream action records, never as direct core aggregate relationships.
5. Every tenant-scoped entity MUST include `tenant_id` and `organization_id`.
6. Cross-module references MUST be stored as FK ids only, never direct ORM relationships.
7. Transcript content MUST be protected by explicit permissions and encrypted at rest where platform encryption is available.
8. Provider raw payloads MUST be preserved for audit and backfill.
9. Personal Communication Hub projection MUST be optional and idempotent.
10. InboxOps integration MUST be optional and feature-detected.

## Module And Package Layout

```text
packages/shared/
  src/modules/
    phone_calls/
      provider.ts
      types.ts

packages/core/
  src/modules/
    phone_calls/
      index.ts
      acl.ts
      setup.ts
      events.ts
      di.ts
      integration.ts
      message-types.ts
      inbox-ops-sources.ts
      data/
        entities.ts
        validators.ts
        enrichers.ts
      commands/
        calls.ts
        transcripts.ts
        summaries.ts
        projections.ts
        inbox.ts
      api/
        calls/route.ts
        calls/[id]/route.ts
        calls/[id]/reingest/route.ts
        calls/[id]/request-inbox-submission/route.ts
        providers/[providerKey]/pull/route.ts
      backend/
        phone-calls/page.tsx
        phone-calls/[id]/page.tsx
      widgets/
        injection/
        injection-table.ts
      lib/
        provider-registry.ts
        payload-evolution.ts
        projection.ts

packages/phone-calls-tillio/
  package.json
  src/
    index.ts
    modules/
      phone_calls_tillio/
        index.ts
        integration.ts
        acl.ts
        setup.ts
        di.ts
        lib/
          adapter.ts
          client.ts
          normalizers.ts
          webhook.ts
          health.ts
          credentials.ts
        widgets/
          injection/
            tillio-setup-help/
```

## Integration Marketplace Alignment

The Integration Marketplace gains a hub descriptor:

```ts
export const phoneCallsHub = {
  id: 'phone_calls',
  category: 'communication',
  title: 'Phone Calls',
  description: 'Import, transcribe, summarize, and route short VOIP conversations.',
}
```

Provider integrations register against:

```ts
{
  id: 'phone_calls_tillio',
  providerKey: 'tillio',
  category: 'communication',
  hub: 'phone_calls',
  package: '@open-mercato/phone-calls-tillio'
}
```

This intentionally does not use `communication_channels` as the hub. Calls are a sibling communication hub with a projection into the Personal Communication Hub.

## Relationship To Personal Communication Hub

The Personal Communication Hub owns unified operator visibility. It should show that a call happened, who it involved, status, summary snippet, and links to action surfaces. It does not own call lifecycle, transcript versions, provider ingest state, or recording retention.

Projection shape:

```ts
export interface PhoneCallCommunicationProjection {
  type: 'phone_calls.call'
  sourceModule: 'phone_calls'
  sourceEntityType: 'phone_call'
  sourceEntityId: string
  providerKey: string
  externalCallId: string
  direction: PhoneCallDirection
  status: PhoneCallStatus
  subject: string
  body: string
  bodyFormat: 'text'
  primaryParticipant?: PhoneCallParticipantSnapshot | null
  metadata: {
    startedAt?: string | null
    durationSeconds?: number | null
    hasRecording: boolean
    hasTranscript: boolean
    hasSummary: boolean
    activeTranscriptVersionId?: string | null
    activeSummaryVersionId?: string | null
  }
}
```

Projection rules:

1. Projection is idempotent by `(sourceModule, sourceEntityType, sourceEntityId)`.
2. Projection should be refreshed after ingest, transcript creation, summary creation, and assignment changes.
3. Projection body MUST be concise. Full transcript stays in `phone_calls`.
4. Projection MUST respect permissions. Users without transcript access see a redacted or summary-only body.
5. If Personal Communication Hub is absent, core call storage and APIs still work.

## Relationship To InboxOps

InboxOps is the preferred human-review and action execution layer when installed. `phone_calls` provides a source adapter and source submission command, not local proposal tables.

This depends on the source-native InboxOps work from PR #1647 (`feat(inbox_ops): make InboxOps intake source-oriented`), which was closed unmerged. Implementation MUST revisit that PR before building this bridge. Some contracts, generator support, migrations, and tests may be reusable, but the core `phone_calls` module MUST NOT hard-depend on source-native InboxOps until an equivalent contract lands on `develop`.

Expected source adapter:

```ts
export const phoneCallInboxSourceAdapter = {
  sourceModule: 'phone_calls',
  sourceEntityType: 'phone_call',
  resolveSource,
  buildExtractionInput,
}
```

Extraction input should include:

1. call title
2. participant snapshots
3. active transcript text when permitted
4. active summary and fact map
5. provider key and external call id
6. links back to call detail
7. communication projection id, if present

Rules:

1. `phone_calls` MUST NOT create `InboxEmail`.
2. `phone_calls` MUST NOT write InboxOps proposals directly.
3. If InboxOps is absent, request-submission APIs return a feature unavailable result.
4. Downstream actions such as `service_tickets.create_from_phone_call` live in domain modules.
5. Until source-native InboxOps is merged, the InboxOps bridge remains a later implementation phase, not a blocker for core call ingestion.

## Relationship To Webhooks

If a provider supports inbound webhooks, shared `@open-mercato/webhooks` should own the public inbound route:

```text
POST /api/webhooks/inbound/:providerKey
```

The provider package registers a webhook endpoint adapter. That adapter verifies signatures, resolves tenant/integration context, normalizes the payload, and invokes `phone_calls.call.ingest`.

Pull/backfill remains mandatory because:

1. providers may not send all historical data via webhooks
2. webhook contracts may be delayed or incomplete
3. operators need replay after outages
4. webhook and pull must dedupe through the same ingest command

## Provider Contract

Shared package:

```ts
export interface PhoneCallProviderAdapter {
  readonly providerKey: string
  readonly displayName: string

  validateConnection(input: ValidatePhoneCallProviderInput): Promise<ProviderValidationResult>
  fetchCall(input: FetchPhoneCallInput): Promise<NormalizedPhoneCall | null>
  fetchCalls(input: FetchPhoneCallsInput): Promise<NormalizedPhoneCallBatch>
  fetchTranscript?(input: FetchPhoneCallTranscriptInput): Promise<NormalizedPhoneCallTranscript | null>
  fetchSummary?(input: FetchPhoneCallSummaryInput): Promise<NormalizedPhoneCallSummary | null>
  verifyWebhook?(input: VerifyPhoneCallWebhookInput): Promise<NormalizedPhoneCallWebhookEvent>
}
```

The adapter never receives an entity manager. It receives credentials, provider identifiers, and scope. It returns normalized DTOs.

Registry:

```ts
registerPhoneCallProvider(adapter: PhoneCallProviderAdapter): void
getPhoneCallProvider(providerKey: string): PhoneCallProviderAdapter | undefined
listPhoneCallProviders(): PhoneCallProviderAdapter[]
```

## Normalized DTOs

```ts
export interface NormalizedPhoneCall {
  externalCallId: string
  externalConversationId?: string | null
  direction: 'inbound' | 'outbound' | 'internal' | 'unknown'
  status: 'new' | 'ringing' | 'answered' | 'missed' | 'failed' | 'completed' | 'unknown'
  participants: NormalizedPhoneCallParticipant[]
  recording?: NormalizedPhoneCallRecording | null
  startedAt?: Date | null
  answeredAt?: Date | null
  endedAt?: Date | null
  durationSeconds?: number | null
  providerFacts?: Record<string, unknown>
  rawPayload: Record<string, unknown>
}

export interface NormalizedPhoneCallParticipant {
  role: 'caller' | 'callee' | 'agent' | 'unknown'
  providerParticipantId?: string | null
  phoneNumber?: string | null
  displayName?: string | null
  email?: string | null
  metadata?: Record<string, unknown>
}

export interface NormalizedPhoneCallRecording {
  url?: string | null
  providerRecordingId?: string | null
  mimeType?: string | null
  durationSeconds?: number | null
  metadata?: Record<string, unknown>
}

export interface NormalizedPhoneCallTranscript {
  externalTranscriptId?: string | null
  content: string
  languageCode?: string | null
  speakerSegments?: NormalizedSpeakerSegment[] | null
  qualityScore?: number | null
  providerFacts?: Record<string, unknown>
  rawPayload: Record<string, unknown>
}

export interface NormalizedPhoneCallSummary {
  externalSummaryId?: string | null
  summaryText: string
  factMap: Record<string, unknown>
  fieldConfidence?: Record<string, unknown> | null
  requiresReview?: Record<string, unknown> | null
  promptVersion?: string | null
  modelName?: string | null
  qualityStatus: 'draft' | 'ready' | 'requires_review' | 'rejected'
  providerFacts?: Record<string, unknown>
  rawPayload: Record<string, unknown>
}
```

## Provider Payload Evolution Contract

Providers may add fields, rename fields, nest values differently, or introduce new event types. Core implementation must treat this as normal evolution.

Rules:

1. Raw provider payloads MUST be persisted before field-level assumptions matter.
2. Normalizers MUST accept snake_case, camelCase, and provider-specific aliases for important fields.
3. Unknown fields MUST be preserved and MUST NOT fail ingest.
4. Provider-specific facts that are useful but not stable enough for schema columns MUST go into `providerFacts`.
5. A provider field becomes a first-class core column only if it is needed for filtering, indexing, retention, permission checks, or stable cross-provider behavior.
6. A provider field becomes a domain extension field only if one domain module needs it.
7. Any promoted field requires a migration and backfill plan from raw payloads where practical.
8. Commands consume normalized DTOs only. Commands MUST NOT read arbitrary raw provider fields.
9. Adding optional normalized fields MUST be backward-compatible for API clients.

Promotion flow:

1. Add aliases to provider normalizer.
2. Add unit tests with the new payload shape.
3. Store the value in `providerFacts`.
4. Decide whether it deserves a core column, provider extension column, or domain extension.
5. Add migration only after that decision.
6. Update OpenAPI schemas and UI mappers.

## Data Models

### PhoneCall

Canonical provider-neutral call aggregate.

| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid | Primary key |
| `tenant_id` | uuid | Required |
| `organization_id` | uuid | Required |
| `provider_key` | text | e.g. `tillio` |
| `integration_id` | text nullable | Integration Marketplace id |
| `external_call_id` | text | Provider call id |
| `external_conversation_id` | text nullable | Provider conversation/session id |
| `direction` | text | `inbound`, `outbound`, `internal`, `unknown` |
| `status` | text | `new`, `ringing`, `answered`, `missed`, `failed`, `completed`, `unknown` |
| `started_at` | timestamptz nullable | Provider start time |
| `answered_at` | timestamptz nullable | Provider answer time |
| `ended_at` | timestamptz nullable | Provider end time |
| `duration_seconds` | integer nullable | Call duration |
| `recording_url` | text nullable | Provider or proxied URL |
| `recording_attachment_id` | uuid nullable | Optional core attachment id |
| `active_transcript_version_id` | uuid nullable | Active transcript version |
| `active_summary_version_id` | uuid nullable | Active summary version |
| `communication_projection_id` | uuid nullable | Optional Personal Communication Hub projection id |
| `provider_facts` | jsonb nullable | Normalized non-column provider facts |
| `raw_snapshot` | jsonb nullable | Last raw provider call payload |
| `ingest_status` | text | `pending`, `complete`, `failed` |
| `last_ingested_at` | timestamptz nullable | Last successful ingest |
| `created_at` | timestamptz | Audit |
| `updated_at` | timestamptz | Audit |
| `deleted_at` | timestamptz nullable | Soft delete |

Indexes:

1. `(tenant_id, organization_id)`
2. `(provider_key, external_call_id, tenant_id, organization_id)` unique
3. `(organization_id, started_at)`
4. `(organization_id, status)`
5. `(communication_projection_id)` where not null

Explicitly forbidden on core `PhoneCall`:

1. `service_ticket_id`
2. `customer_entity_id`
3. `contact_person_id`
4. provider-specific permanent columns such as `ringostat_*` unless promoted through the payload evolution process

### PhoneCallParticipant

Provider-neutral participant identity.

| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid | Primary key |
| `tenant_id` | uuid | Required |
| `organization_id` | uuid | Required |
| `phone_call_id` | uuid | FK to `phone_calls.id` |
| `provider_participant_id` | text nullable | Provider participant id |
| `role` | text | `caller`, `callee`, `agent`, `unknown` |
| `phone_number` | text nullable | E.164 when possible |
| `display_name` | text nullable | Provider-reported name |
| `email` | text nullable | Provider-reported email |
| `metadata` | jsonb nullable | Provider facts about participant |
| `created_at` | timestamptz | Audit |
| `updated_at` | timestamptz | Audit |

No direct relationship to customers or users. Matching is a downstream projection/action concern.

### PhoneCallTranscriptVersion

Versioned transcript content.

| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid | Primary key |
| `tenant_id` | uuid | Required |
| `organization_id` | uuid | Required |
| `phone_call_id` | uuid | FK to `phone_calls.id` |
| `external_transcript_id` | text nullable | Provider transcript id |
| `version_no` | integer | Monotonic per call |
| `source` | text | `provider_pull`, `provider_webhook`, `platform_ai`, `manual_correction`, `reingest` |
| `language_code` | text nullable | ISO language |
| `content` | encrypted text | Transcript |
| `speaker_segments` | jsonb nullable | Diarization/segments |
| `quality_score` | numeric nullable | Provider/platform score |
| `provider_facts` | jsonb nullable | Normalized provider facts |
| `raw_snapshot` | jsonb nullable | Raw transcript payload |
| `is_active` | boolean | Current active version |
| `created_at` | timestamptz | Audit |
| `updated_at` | timestamptz | Audit |
| `deleted_at` | timestamptz nullable | Soft delete |

Unique: `(phone_call_id, version_no)`.

### PhoneCallSummaryVersion

Versioned summary and fact map.

| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid | Primary key |
| `tenant_id` | uuid | Required |
| `organization_id` | uuid | Required |
| `phone_call_id` | uuid | FK to `phone_calls.id` |
| `transcript_version_id` | uuid nullable | Transcript source |
| `external_summary_id` | text nullable | Provider summary id |
| `version_no` | integer | Monotonic per call |
| `generation_type` | text | `provider`, `platform_ai`, `manual` |
| `summary_text` | text | Human-readable summary |
| `fact_map` | jsonb | Provider-neutral facts |
| `field_confidence` | jsonb nullable | Confidence by fact |
| `requires_review` | jsonb nullable | Review flags |
| `prompt_version` | text nullable | Prompt/preset version |
| `model_name` | text nullable | Model/provider name |
| `quality_status` | text | `draft`, `ready`, `requires_review`, `rejected` |
| `provider_facts` | jsonb nullable | Normalized provider facts |
| `raw_snapshot` | jsonb nullable | Raw summary payload |
| `is_active` | boolean | Current active version |
| `created_at` | timestamptz | Audit |
| `updated_at` | timestamptz | Audit |
| `deleted_at` | timestamptz nullable | Soft delete |

Unique: `(phone_call_id, version_no)`.

### PhoneCallIngestEvent

Raw inbound provider event or pull item audit.

| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid | Primary key |
| `tenant_id` | uuid | Required |
| `organization_id` | uuid | Required |
| `provider_key` | text | Provider |
| `integration_id` | text nullable | Integration instance |
| `external_event_id` | text | Provider event id or deterministic hash |
| `external_call_id` | text nullable | Call id if known |
| `event_type` | text | Provider event type or `pull_item` |
| `received_at` | timestamptz | Receive time |
| `processed_at` | timestamptz nullable | Processing time |
| `status` | text | `received`, `processed`, `failed`, `ignored` |
| `payload` | jsonb | Raw event payload |
| `error_message` | text nullable | Failure details |
| `created_at` | timestamptz | Audit |
| `updated_at` | timestamptz | Audit |

Unique: `(provider_key, external_event_id, tenant_id, organization_id)`.

### Domain Link Extensions

Core does not own service tickets, customers, or contact links. Domain modules may add extension entities such as:

```text
service_ticket_phone_call_links
customer_phone_call_links
```

Those tables live in their domain module or app module and store FK ids only.

### CRM Exposure

CRM exposure is intentionally deferred. The `call_transcripts` work and email intake work exposed early CRM/Person surfaces mainly to demonstrate the feature, while long-term CRM placement is still being decided. `phone_calls` should therefore provide stable events, source adapters, and projection inputs, but should not add CRM timeline widgets, Person tabs, or customer interaction writes in the first core PR.

When CRM direction is finalized, a separate domain extension can consume `phone_calls` via events or InboxOps source submissions and decide whether calls appear as:

1. Person timeline entries
2. Company timeline entries
3. Customer interactions
4. service/customer support activities
5. communication hub activities only

Until then, implementation should limit itself to call storage, provider ingestion, communication projection, and optional InboxOps seam preparation.

## API Contracts

Every route MUST export `openApi`.

### `GET /api/phone_calls/calls`

List calls.

Guard:

```ts
requireAuth: true
requireFeatures: ['phone_calls.view']
```

Query:

```ts
{
  page?: number
  pageSize?: number // max 100
  q?: string
  providerKey?: string
  status?: string
  direction?: string
  startedFrom?: string
  startedTo?: string
  hasTranscript?: boolean
  hasSummary?: boolean
}
```

Response:

```ts
{
  items: PhoneCallListItem[]
  page: number
  pageSize: number
  totalCount: number
}
```

### `GET /api/phone_calls/calls/:id`

Return call detail with participants, active transcript metadata, active summary, provider facts, raw snapshot only when permitted, communication projection state, and InboxOps submission state when installed.

Guard:

```ts
requireAuth: true
requireFeatures: ['phone_calls.view']
```

Transcript content requires:

```ts
requireFeatures: ['phone_calls.transcript.view']
```

### `POST /api/phone_calls/providers/:providerKey/pull`

Pull/backfill calls from a provider.

Guard:

```ts
requireAuth: true
requireFeatures: ['phone_calls.manage', 'integrations.manage']
```

Body:

```ts
{
  integrationId?: string
  from?: string
  to?: string
  cursor?: string
  limit?: number
}
```

Response:

```ts
{
  created: number
  updated: number
  ignored: number
  failed: number
  nextCursor?: string | null
}
```

### `POST /api/phone_calls/calls/:id/reingest`

Refetch provider data and create new transcript/summary versions when available.

Guard:

```ts
requireAuth: true
requireFeatures: ['phone_calls.manage']
```

Body:

```ts
{
  fetchTranscript?: boolean
  fetchSummary?: boolean
}
```

### `POST /api/phone_calls/calls/:id/project-communication`

Create or refresh a Personal Communication Hub projection.

Guard:

```ts
requireAuth: true
requireFeatures: ['phone_calls.manage']
```

If the hub is not installed, return `409` or a typed feature-unavailable response.

### `POST /api/phone_calls/calls/:id/request-inbox-submission`

Request source-native InboxOps extraction/review.

Guard:

```ts
requireAuth: true
requireFeatures: ['phone_calls.manage']
```

Additional InboxOps feature checks apply when InboxOps is installed.

### `POST /api/webhooks/inbound/tillio`

Owned by `@open-mercato/webhooks`, not by `phone_calls`.

The provider package supplies verification and processing adapter. The core `phone_calls` module only receives normalized command input.

## Commands

### `phone_calls.call.ingest`

Input:

```ts
{
  providerKey: string
  integrationId?: string | null
  call: NormalizedPhoneCall
  transcript?: NormalizedPhoneCallTranscript | null
  summary?: NormalizedPhoneCallSummary | null
  scope: { tenantId: string; organizationId: string }
}
```

Behavior:

1. Upsert call by `(providerKey, externalCallId, tenantId, organizationId)`.
2. Upsert participants.
3. Preserve raw call payload.
4. Create transcript version if supplied and content changed or forced.
5. Create summary version if supplied and content/fact map changed or forced.
6. Update active version pointers.
7. Emit `phone_calls.call.ingested` or `phone_calls.call.updated`.
8. Optionally enqueue projection refresh.

### `phone_calls.provider.pull`

Resolve provider adapter, load credentials, fetch calls, and invoke `phone_calls.call.ingest` per normalized call.

### `phone_calls.call.reingest`

Refetch one call by provider key and external call id. Existing versions are not deleted.

### `phone_calls.communication.project`

Create or refresh Personal Communication Hub projection.

### `phone_calls.call.request_inbox_submission`

Submit one call to InboxOps source-native intake when available.

## Events

| Event | Emitted When |
|-------|--------------|
| `phone_calls.call.ingested` | New call created |
| `phone_calls.call.updated` | Existing call updated |
| `phone_calls.call.reingested` | Manual reingest completed |
| `phone_calls.transcript.created` | Transcript version created |
| `phone_calls.summary.created` | Summary version created |
| `phone_calls.communication.projected` | Communication projection created or refreshed |
| `phone_calls.call.ready_for_inbox_ops` | Call has enough data for source-native review |
| `phone_calls.ingest.failed` | Provider ingest failed after persistence of raw event |

## UI / UX

### Integration Detail

Path: `/backend/integrations/:integrationId`

Tillio provider widget should show:

1. credential status
2. health check
3. last successful pull
4. webhook setup instructions when available
5. pull/backfill action
6. operation logs

### Phone Calls List

Path: `/backend/phone-calls`

Requirements:

1. DataTable with pagination props wired.
2. Filters for provider, status, direction, date range, transcript, summary.
3. Actions to open detail, pull provider data, project to communication hub where permitted.
4. No provider-specific columns by default except provider label.

### Phone Call Detail

Path: `/backend/phone-calls/:id`

Sections:

1. Overview
2. Participants
3. Recording
4. Transcript versions
5. Summary/facts versions
6. Provider facts
7. Communication projection
8. InboxOps submission status
9. Raw payload for privileged users only

### Personal Communication Hub Rendering

Rendered projection should include:

1. VOIP badge
2. provider label
3. status badge
4. participant summary
5. call time and duration
6. summary snippet if permitted
7. open call action
8. request review / open InboxOps action if installed

## Tillio Provider Package

Package: `@open-mercato/phone-calls-tillio`

Module id: `phone_calls_tillio`

Credential fields:

```ts
[
  { key: 'apiBaseUrl', label: 'Tillio API URL', type: 'url', required: true },
  { key: 'plugin', label: 'Plugin', type: 'text', required: true },
  { key: 'system', label: 'System', type: 'text', required: true },
  { key: 'tenant', label: 'Tenant', type: 'text', required: true },
  { key: 'tenantDomain', label: 'Tenant domain', type: 'text', required: true },
  { key: 'apiKey', label: 'Tillio API key', type: 'secret', required: true },
  { key: 'providerKey', label: 'Provider auth key', type: 'secret', required: true },
  { key: 'token', label: 'Tillio token', type: 'secret', required: false }
]
```

Responsibilities:

1. Validate Tillio config.
2. Create or refresh Tillio token when needed.
3. Pull calls.
4. Fetch transcript.
5. Fetch summary.
6. Normalize payloads defensively.
7. Register webhook adapter only when Tillio webhook contract is confirmed.
8. Register health check.

Tillio provider MUST include unit tests for:

1. multiple call payload shapes
2. missing optional fields
3. new unknown fields preserved in raw payload
4. provider facts extraction
5. transcript payload shape variants
6. summary payload shape variants
7. credential token binding changes

## Security

1. Credentials are stored through Integration Credentials API.
2. Provider tokens and secrets MUST NOT be logged.
3. Webhook signature verification is mandatory when webhooks are enabled.
4. Raw payload display requires `phone_calls.manage`.
5. Transcript content requires `phone_calls.transcript.view`.
6. Projection to Personal Communication Hub MUST not leak transcript content without permission.
7. All commands and routes scope by tenant and organization.
8. Recording URLs should be proxied or signed when provider URLs are sensitive or long-lived.

## Implementation Plan

### Phase 1: Core Hub Foundation

1. Add shared provider types and registry.
2. Add core `phone_calls` module.
3. Add entities and migrations.
4. Add commands and read APIs.
5. Add list/detail backend pages.
6. Add OpenAPI docs.
7. Add unit tests for commands and validators.

### Phase 2: Tillio Provider

1. Create `@open-mercato/phone-calls-tillio`.
2. Move hackathon Tillio client logic into provider adapter.
3. Implement defensive normalizers and provider facts.
4. Add Integration Marketplace definition.
5. Add health check and pull action.
6. Add provider unit tests.

### Phase 3: Communication Projection

1. Register `phone_calls.call` message/activity type.
2. Implement projection command.
3. Add idempotent projection refresh after ingest/summary.
4. Add renderer/widget for Personal Communication Hub.
5. Add permission-based redaction.

### Phase 4: InboxOps Bridge

1. Revisit PR #1647 and extract reusable source-native InboxOps contracts if they are still viable.
2. Land or depend on an equivalent source-native InboxOps contract on `develop`.
3. Add source adapter.
4. Add request-submission route and command.
5. Add source status display on call detail.
6. Add integration tests with a test InboxOps action.

### Phase 5: Webhooks

1. Confirm Tillio webhook contract.
2. Register webhooks adapter.
3. Implement signature verification.
4. Implement event id dedupe.
5. Add replay/reprocess support for failed ingest events.

### Phase 6: Migration From Hackathon App

1. Map local `phone_calls` records to core schema.
2. Move service-ticket link to a domain extension table.
3. Replace local Tillio settings with Integration Marketplace credentials.
4. Replace local sync route with provider pull route.
5. Keep compatibility redirects during migration window.

### Phase 7: Deferred CRM Integration

1. Wait for the CRM exposure decision referenced by architecture feedback.
2. Add CRM-specific widgets/projections in the CRM module or a domain extension package.
3. Keep `phone_calls` core unchanged unless a provider-neutral call fact is needed by multiple consumers.

## Test Plan

### Unit Tests

1. Provider registry resolves registered adapter.
2. `phone_calls.call.ingest` creates a call.
3. Duplicate ingest updates existing call.
4. Participant upsert is idempotent.
5. Transcript versions increment correctly.
6. Summary versions increment correctly.
7. Raw provider payload is preserved.
8. Provider facts are preserved.
9. Projection redacts transcript content without permission.
10. Request InboxOps submission fails cleanly when InboxOps is absent.

### Provider Tests

1. Tillio config validation maps success/failure.
2. Tillio token creation handles changed binding fields.
3. Tillio call normalizer accepts known payload variants.
4. Tillio call normalizer preserves unknown fields.
5. Tillio transcript normalizer accepts nested variants.
6. Tillio summary normalizer accepts nested variants.
7. Tillio provider maps provider errors without leaking secrets.

### API Tests

1. Call list is paginated and tenant-scoped.
2. Call detail enforces permissions.
3. Pull endpoint requires integrations manage permission.
4. Reingest creates new versions without deleting old versions.
5. Projection endpoint is idempotent.
6. Cross-tenant reads return not found or forbidden.

### Integration Tests

| Test ID | Description | Assert |
|---------|-------------|--------|
| `TC-PCORE-001` | Pull Tillio calls through provider adapter | Calls created |
| `TC-PCORE-002` | Pull same calls twice | No duplicates |
| `TC-PCORE-003` | Transcript and summary versions are created | Active ids set |
| `TC-PCORE-004` | Communication projection created | Projection id linked |
| `TC-PCORE-005` | Projection redacts transcript for unauthorized user | No transcript content |
| `TC-PCORE-006` | InboxOps source submission created when installed | Source submission references call |
| `TC-PCORE-007` | InboxOps absent | Clear feature-unavailable response |
| `TC-PCORE-008` | Domain extension links service ticket | Link stored outside core call |

## Acceptance Criteria

- [ ] `phone_calls` exists as an official core module.
- [ ] `@open-mercato/phone-calls-tillio` registers as a provider package.
- [ ] Provider code does not write ORM entities directly.
- [ ] Core commands ingest normalized provider DTOs idempotently.
- [ ] Raw provider payloads and provider facts are preserved.
- [ ] Calls, participants, transcript versions, and summary versions are tenant/org scoped.
- [ ] Personal Communication Hub projection is optional and idempotent.
- [ ] InboxOps integration is optional, source-native, and gated on the PR #1647 contract or its successor landing.
- [ ] No service-ticket/customer/contact FK exists on core `PhoneCall`.
- [ ] All routes export `openApi`.
- [ ] Tests cover payload evolution and unknown Tillio fields.
- [ ] CRM exposure is deferred to a later domain-specific PR.

## Open Questions

1. Is the official UI name "Personal Communication Hub", or should the core docs call it `communication_channels` / Messages projection until the product name is finalized?
2. Does Tillio provide signed webhooks to Open Mercato, and what exact event types are emitted?
3. Should provider-generated summaries be enabled by default, or should platform AI summaries be preferred when both are available?
4. Should `phone_calls` and `call_transcripts` remain separate hubs long term, or should they share a lower-level transcription/artifact abstraction later?
5. Which branch contains the final source-native InboxOps intake contract for implementation, given PR #1647 was closed unmerged?

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Calls become generic messages | High | Keep `phone_calls` as source of truth and project only summaries to the communication hub |
| Provider-specific fields pollute core schema | High | Use `providerFacts` and promotion rules |
| Domain FKs leak into core aggregate | High | Store service/customer links in extension/domain tables only |
| Tillio webhook contract is weaker than expected | High | Keep pull/backfill as required phase-1 path |
| Transcript content leaks through projections | High | Permission-gated projection rendering and redaction |
| InboxOps contract shifts during implementation | Medium | Keep bridge optional and behind a source adapter |
| Duplicate webhook/pull records | Medium | Unique provider/external id constraint and idempotent ingest |
| CRM exposure lands before CRM direction is settled | Medium | Defer CRM-specific UI/projection to a later domain PR |

## Changelog

| Date | Change |
|------|--------|
| 2026-06-09 | Initial numbered core spec for `phone_calls` hub, Tillio provider package, Personal Communication Hub projection, InboxOps bridge, and provider payload evolution |
| 2026-06-10 | Applied architecture feedback: keep separate hub, align with `2026-04-21-crm-call-transcriptions`, treat SMS as `communication_channels`, gate InboxOps bridge on PR #1647 successor, and defer CRM exposure |
