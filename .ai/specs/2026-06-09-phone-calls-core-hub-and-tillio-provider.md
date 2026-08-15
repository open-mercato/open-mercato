# Phone calls core hub and Tillio provider

**Date**: 2026-06-09
**Status**: Draft - the `phone_calls` hub and the Tillio pull/list slice are implemented; transcripts, summaries, communication projection, InboxOps intake and webhooks remain design
**Scope**: Open Source
**Related**:
- [`2026-04-21-crm-call-transcriptions.md`](2026-04-21-crm-call-transcriptions.md) - sibling hub for meeting-tool transcripts; explicitly excludes CTI/PBX calls, which this spec covers.
- [`SPEC-045d-communication-notification-hubs.md`](implemented/SPEC-045d-communication-notification-hubs.md) - the `communication_channels` hub and `ChannelAdapter` contract this spec deliberately does **not** reuse (see § Architecture).
- `packages/core/src/modules/customers/` - reference module for the CRUD/command patterns used by the hub.
- `packages/shared/src/modules/payment_gateways/` - precedent for a shared provider contract plus a registry.

---

## TLDR

`phone_calls` is an Open Mercato core hub that owns short VOIP calls: normalized lifecycle, participants,
recordings, and provider-neutral read APIs. Provider packages own credentials, provider APIs, payload
normalization and health checks; the first one is `@open-mercato/tillio`.

Calls are ingest-only: they are facts received from a provider, never records a user creates. The hub
therefore exposes a read API and no create route.

What is implemented today is the thin slice: configure a Tillio environment, attach one operator, pull calls
for a date range, and read them on a filterable backend list. Transcripts, summaries, the Personal
Communication Hub projection, InboxOps intake, webhooks, and data retention and erasure are designed here but
not built.

---

## Overview

VOIP calls have no reusable home in Open Mercato. Making them work today means wiring a provider's API,
credentials, payload shape and storage into an application module, which produces a surface that cannot be
reused by the next provider and mixes provider concerns with domain concerns.

This spec introduces a two-layer split - a provider-neutral core hub plus replaceable provider packages -
so that adding a second VOIP provider is a package, not a rewrite.

## Problem statement

A call-ingestion implementation that lives inside an application module fails on several axes:

1. Provider logic is hard-wired to one vendor's routes, credentials and payload shape.
2. Call storage accumulates app-specific foreign keys (service ticket, customer, contact).
3. The settings surface bypasses the Integration Marketplace.
4. Webhook handling is provider-specific instead of using the shared webhooks module.
5. Calls get modelled as chat messages, which loses call lifecycle (ringing, answered, missed) and recordings.
6. New provider fields require ad hoc changes without a payload-evolution contract.
7. Downstream extraction/review duplicates InboxOps instead of reusing it.

## Goals

1. A reusable core `phone_calls` hub module.
2. A shared provider adapter contract and registry.
3. An official Tillio provider package.
4. Provider-neutral call and participant storage.
5. Preserved raw provider payloads for audit and backfill.
6. Provider payload evolution without breaking callers.
7. Optional projection into the Personal Communication Hub.
8. Optional InboxOps source-native intake.
9. Domain object creation kept outside provider packages and outside the core aggregate.
10. Pull/backfill as the first ingestion path; webhooks once provider semantics are confirmed.

## Non-goals

1. Multi-participant meeting transcripts - those belong to a separate `meeting_transcripts` domain.
2. Storing calls only as generic Messages.
3. Service-ticket, CRM or sales foreign keys on the `PhoneCall` aggregate.
4. A provider-specific public route in core when the shared webhooks module can own inbound routing.
5. A proposal/discrepancy engine inside `phone_calls`.
6. Requiring InboxOps or the Personal Communication Hub for `phone_calls` to be installable.
7. SMS. SMS is messaging-shaped and belongs under `communication_channels`.

---

## Architecture

```text
Provider package (@open-mercato/tillio)
  -> owns credentials and provider APIs
  -> normalizes provider payloads into shared DTOs
  -> invokes core commands
  -> (Phase 5) verifies provider webhooks

Core phone_calls hub
  -> owns the canonical call aggregate and participants
  -> emits call lifecycle events
  -> exposes provider-neutral read APIs
  -> (Phase 3+) projects to the Personal Communication Hub
  -> (Phase 4) submits to InboxOps when installed

Domain modules
  -> consume events or InboxOps proposals
  -> create tickets, interactions, tasks, notes
```

### Why a separate hub rather than `communication_channels`

`ChannelAdapter` is messaging-shaped: it models threads and messages, not a call lifecycle with ringing /
answered / missed states, a duration and a recording artifact. Calls are therefore a sibling hub, and the
Personal Communication Hub receives a projection of a call rather than owning it. SMS, being genuinely
messaging-shaped, stays under `communication_channels`.

### Core architectural rules

1. Provider packages MUST NOT write `phone_calls` ORM entities directly.
2. Provider packages MUST return normalized DTOs and invoke core commands.
3. `PhoneCall` MUST contain provider-neutral fields only.
4. Domain links MUST live in extension/projection modules, never on the core aggregate.
5. Every tenant-scoped entity MUST carry `tenant_id` and `organization_id`.
6. Cross-module references MUST be FK ids only, never direct ORM relationships.
7. Recording URLs and raw payloads MUST be encrypted at rest.
8. Raw provider payloads MUST be preserved for audit and backfill.
9. The Personal Communication Hub projection MUST be optional and idempotent.
10. InboxOps integration MUST be optional and feature-detected.

### Module and package layout

Implemented paths are unmarked; `[planned]` marks designed-but-unbuilt files.

```text
packages/shared/src/modules/phone_calls/
  index.ts
  provider.ts            # PhoneCallsProvider adapter contract
  types.ts               # NormalizedPhoneCall and related DTOs

packages/core/src/modules/phone_calls/
  index.ts  acl.ts  setup.ts  events.ts  di.ts  encryption.ts
  data/entities.ts
  migrations/
  commands/calls.ts      # phone_calls.call.ingest
  api/calls/route.ts     # list (read-only)
  api/openapi.ts
  backend/page.tsx       # call list
  i18n/                  # en, de, es, pl
  __integration__/
  backend/[id]/page.tsx          # [planned] call detail
  commands/transcripts.ts        # [planned]
  commands/summaries.ts          # [planned]
  commands/projections.ts        # [planned] communication projection
  commands/inbox.ts              # [planned] InboxOps submission
  lib/provider-registry.ts       # [planned] multi-provider dispatch

packages/tillio/src/modules/tillio/
  index.ts  acl.ts  setup.ts  di.ts  integration.ts
  api/pull/route.ts              # readiness (GET) + queue a pull (POST)
  api/operators/route.ts         # list + attach operator
  api/operators/[id]/route.ts    # detach operator
  lib/adapter.ts                 # dispatches by operator plugin
  lib/client.ts  lib/errors.ts  lib/environment.ts
  lib/health.ts                  # env validation via getPlugins
  lib/operators.ts  lib/operators-store.ts
  lib/pull-readiness.ts          # blocker precedence
  lib/pull-job.ts                # the durable pull: cursor walk plus ingest
  lib/queue.ts                   # tillio-pull queue
  lib/preset.ts                  # env preconfiguration
  cli.ts                         # configure-from-env
  workers/tillio-pull.ts         # runs lib/pull-job.ts off the request
  lib/normalizer.ts  lib/tz.ts  lib/url-guard.ts
  widgets/injection/pull-calls/          # pull action on the hub list toolbar
  widgets/injection/operators-config/    # operator configuration tab
  __tests__/  __integration__/
  lib/webhook.ts                 # [planned] Phase 5
```

---

## Tillio configuration model

Tillio is configured on two levels, because the two levels have different lifecycles and different owners.

**Environment** (the Tillio instance itself) lives in the integration's native `Credentials` tab:
`apiUrl`, `apiKey`, an optional `timeZone`, and a generated `tenantSystemId`. It is validated by the standard
health `Check`, which calls `getPlugins` as a connection test.

`timeZone` is the zone the instance reports wall-clock timestamps in, defaulting to `Europe/Warsaw`. It is
configuration rather than a constant because an instance serving another market reports that market's local
time, and reading those stamps in the wrong zone shifts every call by the offset. It is validated against
`Intl`, and deliberately left out of the environment fingerprint: the operator token is not bound to a
display zone, so changing it must not raise `environment_drift`.

**Operator** (the telephony plugin bound to that environment) lives in a separate detachable store
(`tillio_operators`) surfaced by a custom `Operator configuration` tab. One Tillio tile holds one operator
slot; the operator is attachable and detachable without touching the environment.

The two levels are bound by an environment fingerprint recorded on the operator when it is attached. If the
environment changes afterwards, the fingerprint no longer matches and the pull is blocked with
`environment_drift` rather than silently calling a provider the operator was never bound to.

`Ringostat` is the supported plugin today. The adapter dispatches by plugin, so a second plugin is additive.

### Deployment-managed preconfiguration - implemented

An operator running environment-managed infrastructure has to bootstrap or rotate Tillio without typing into
the UI, so the provider parses its own env vars in `lib/preset.ts`.

| Variable | Required | Meaning |
|----------|----------|---------|
| `OM_INTEGRATION_TILLIO_API_URL` | yes | Tillio API base URL |
| `OM_INTEGRATION_TILLIO_API_KEY` | yes | Tillio API key |
| `OM_INTEGRATION_TILLIO_TIMEZONE` | no | IANA zone the instance reports timestamps in (default `Europe/Warsaw`) |
| `OM_INTEGRATION_TILLIO_RINGOSTAT_KEY` | no | Ringostat key; when set, the operator is attached too |
| `OM_INTEGRATION_TILLIO_FORCE_PRECONFIGURE` | no | Overwrite credentials that already exist (default off) |
| `OM_INTEGRATION_TILLIO_REPLACE_OPERATOR` | no | Pre-answers the operator replacement prompt for unattended runs (default off) |

The preset performs no writes of its own: each step calls the service the admin UI calls for the same
action - `integrationCredentialsService` for the credentials form, `integrationStateService` for the enable
toggle, `integrationHealthService` for `Check`, and `attachOperator` for the operator route. An env-driven
tenant and a hand-configured one therefore end up with identical stored state, and everything the preset
wrote stays editable in the UI. The operator token is not read from env at all: it is minted by
`attachOperator`, exactly as it is when somebody submits the form.

The order is forced by the data: the health check mints the `tenantSystemId` that the operator token is
bound to, so attaching before it has passed is refused. When the health check does not report healthy, the
preset stops after the environment and reports it rather than attaching against an instance it could not
reach.

It applies from `setup.ts` on tenant bootstrap and is rerunnable as
`yarn mercato tillio configure-from-env --tenant <id> --org <id> [--force]`. Rerunning is safe: existing
credentials are kept unless forced, and an occupied operator slot is reported as kept rather than treated as
an error. The keep-unless-forced rule is what makes UI edits durable - without it every bootstrap would
silently restore the env values over a rotation performed by hand. A half-set preset is reported and skipped
rather than thrown, so it cannot fail tenant bootstrap.

A forced run whose variables point at a *different* instance is the one case that cannot be resolved by
writing credentials alone: the attached operator's token was minted by the stored environment, so once the
credentials are replaced it can no longer be revoked and the record can only be dropped by force. The preset
therefore refuses that switch unless the replacement is approved, either by
`OM_INTEGRATION_TILLIO_REPLACE_OPERATOR` for unattended runs or by answering the CLI prompt. On approval the
operator is detached first, while the credentials that minted its token are still stored, and reattached from
`OM_INTEGRATION_TILLIO_RINGOSTAT_KEY` afterwards - which is why the switch is also refused when that key is
absent. Tenant bootstrap has nobody to ask, so without the variable it refuses and logs the reason.

The preset also marks the integration enabled, because an integration with no state row resolves to disabled
and the scheduled health probe only visits enabled ones.

### Blocker precedence

Readiness is evaluated in a fixed order and surfaces exactly one blocker, which the UI maps to the settings
section that can resolve it:

| Blocker | Section | Meaning |
|---------|---------|---------|
| `environment_not_ready` | environment | No credentials, or the health check has not passed |
| `operator_missing` | operator | Environment is healthy, no operator attached |
| `environment_drift` | operator | Environment changed after the operator was attached |

---

## Data models

### PhoneCall - implemented

Table `phone_calls`. Provider-neutral; carries no domain foreign keys.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `organization_id`, `tenant_id` | uuid | scope, indexed together |
| `provider_key` | text | e.g. `tillio` |
| `integration_id` | text | nullable |
| `external_call_id` | text | unique per provider + scope |
| `external_conversation_id` | text | nullable |
| `direction` | text | `inbound` / `outbound` / `internal` / `unknown` |
| `status` | text | `new` / `ringing` / `answered` / `missed` / `failed` / `completed` / `unknown` |
| `started_at`, `answered_at`, `ended_at` | timestamptz | nullable |
| `duration_seconds` | integer | nullable |
| `recording_url` | text | nullable, encrypted |
| `recording_attachment_id` | uuid | nullable |
| `active_transcript_version_id`, `active_summary_version_id` | uuid | nullable, reserved for later phases |
| `communication_projection_id` | uuid | nullable, reserved for Phase 3 |
| `provider_facts` | jsonb | nullable, encrypted |
| `raw_snapshot` | jsonb | nullable, encrypted |
| `ingest_status` | text | default `pending` |
| `last_ingested_at` | timestamptz | nullable |
| `created_at`, `updated_at`, `deleted_at` | timestamptz | soft delete |

Uniqueness: `(provider_key, external_call_id)` within scope - this is what makes re-pulling a range update
instead of duplicate.

### PhoneCallParticipant - implemented

Table `phone_call_participants`. `phone_number`, `display_name` and `email` are encrypted; the call is
referenced by `phone_call_id` (FK id, no ORM relationship).

### Encryption map

`phone_calls:phone_call` - `raw_snapshot`, `provider_facts`, `recording_url`.
`phone_calls:phone_call_participant` - `phone_number`, `display_name`, `email`.

Raw payloads carry caller and destination numbers, so whole-JSONB encryption is used, matching the existing
`sales.*_snapshot` and `audit_logs.snapshot_*` precedent. `QueryEngine` decrypts transparently on read.

### Planned entities

`PhoneCallTranscriptVersion`, `PhoneCallSummaryVersion` (versioned artifacts, active id on the call) and
`PhoneCallIngestEvent` (per-attempt audit log) are designed but not built. `PhoneCallIngestEvent` lands with
webhooks in Phase 5, when there is a delivery stream worth auditing; until then `raw_snapshot` carries the
payload. All three are new tables - additive, no rework of what exists.

---

## API contracts

Every route exports `openApi`.

### `GET /api/phone_calls/calls` - implemented

Guard: `requireAuth`, `requireFeatures: ['phone_calls.view']`.

Query: `page`, `pageSize` (max 100), `q`, `providerKey`, `status`, `direction`, `startedFrom`, `startedTo`,
`sortField`, `sortDir`, `id`.

`q` matches `external_call_id`, `external_conversation_id` or `provider_key` (ILIKE). `sortField` accepts the
camelCase names mapped by the route (`externalCallId`, `startedAt`, `durationSeconds`, …).

Response is the native `makeCrudRoute` envelope:

```ts
{ items: PhoneCallListItem[], total: number, page: number, pageSize: number, totalPages: number }
```

There is no create/update/delete route: calls are ingested, not authored. Detail is served by the same route
with `?id=<uuid>`; a dedicated `GET /api/phone_calls/calls/:id` is `[planned]` for the phase that adds
transcripts, where the detail payload stops being a row projection.

### `GET /api/tillio/pull` - implemented

Readiness probe. Guard: `requireAuth`, `requireFeatures: ['phone_calls.manage', 'integrations.manage']`.
Reads configuration from the database only; never calls Tillio.

```ts
{ ok: true, environmentReady: boolean, operatorAttached: boolean, envDrift: boolean,
  blocker: 'environment_not_ready' | 'operator_missing' | 'environment_drift' | null,
  operatorId: string | null, plugin: string | null }
```

### `POST /api/tillio/pull` - implemented

Same guard. Body: `{ from: 'YYYY-MM-DD', to: 'YYYY-MM-DD', cursor?: string, limit?: number }`; `from` must not
be after `to`.

The readiness gate runs before the provider is contacted; a blocked tenant gets `409` and no network traffic:

```ts
{ ok: false, code: PullBlocker, section: 'environment' | 'operator', message: string }
```

The route does not sweep the range itself. It creates a scoped `ProgressJob`, enqueues one
`tillio-pull` job and answers `202` with `{ ok: true, progressJobId }`; a second request while a pull is
still running is refused with `429` `pull_already_running`. A wide range can take minutes of provider
paging, which is longer than a request should stay open, and the operator gets cancellation plus progress
that survives navigation and a process restart.

`workers/tillio-pull.ts` runs `lib/pull-job.ts`, which re-resolves the environment and the operator (both can
change while the job waits), walks the provider cursor until it is exhausted, and ingests each call through
`phone_calls.call.ingest`. Each call gets its own command invocation so one bad record cannot roll back the
batch; failures are counted and emit `phone_calls.call.ingest_failed`. The job payload carries the range and
the scope but no credentials, so a replay after a rotation picks up the current ones. Replaying the whole job
is safe for the same reason re-pulling a range is: ingest keys on `(provider_key, external_call_id)`.

`meta.resourceKind` on the progress job is the hub's refresh signal - the call list reloads on
`progress.job.completed` for any job carrying it, without knowing which provider queued it.

`TILLIO_QUEUE_CONCURRENCY` (default 1, ceiling 20) bounds how many sweeps run at once. One is the default
because parallel sweeps against the same environment only buy provider throttling.

Days are interpreted in the environment time zone (`Europe/Warsaw` unless configured), then converted to instants.

The pull is provider-owned rather than a hub-generic `POST /api/phone_calls/providers/:providerKey/pull`:
the request body is provider-shaped (day granularity, provider cursor semantics), and a hub route would have
to model every provider's paging. A hub-level route becomes worthwhile once a provider registry exists and a
second provider shares the shape.

### `GET`/`POST /api/tillio/operators`, `DELETE /api/tillio/operators/:id` - implemented

Guard: `requireAuth`, `requireFeatures: ['tillio.manage', 'integrations.manage']`. List reports the attached
operator plus `supportedPlugins`, `environmentReady` and `envDrift`. Attach is refused with `409`
`environment_not_ready` until the environment health check passes. Detach of an unknown id is a no-op
returning `{ ok: true, detached: false }`.

### Planned routes

`POST /api/phone_calls/calls/:id/reingest`, `POST /api/phone_calls/calls/:id/project-communication`,
`POST /api/phone_calls/calls/:id/request-inbox-submission`, and the shared inbound webhook route
(`POST /api/webhooks/inbound/tillio`) belong to Phases 3-5.

---

## Commands and events

### `phone_calls.call.ingest` - implemented

Input is a `NormalizedPhoneCall` plus scope. Idempotent on `(provider_key, external_call_id)`: creates or
updates, upserts participants, preserves `raw_snapshot` and `provider_facts`, and returns `{ created }` so the
caller can report created-vs-updated counts.

Planned: `phone_calls.call.reingest`, `phone_calls.communication.project`,
`phone_calls.call.request_inbox_submission`.

### Events - implemented

| Event | Category | Meaning |
|-------|----------|---------|
| `phone_calls.call.ingested` | crud | A call was created by ingest |
| `phone_calls.call.updated` | crud | An existing call was updated by ingest |
| `phone_calls.call.ingest_failed` | crud | One record failed; carries provider key and external id, no PII |

## Access control

Module-level, per the platform convention:

| Feature | Grants |
|---------|--------|
| `phone_calls.view` | Read the call list and detail |
| `phone_calls.manage` | Pull and raw payload; depends on `phone_calls.view` |
| `tillio.manage` | Manage the Tillio integration |

Defaults: `admin` gets `phone_calls.*` and `tillio.*`; `employee` gets `phone_calls.view`. The pull and
operator routes additionally require `integrations.manage`, which is what makes them integration-admin
surfaces rather than call-reader surfaces.

`phone_calls.transcript.view` is `[planned]` and additive - transcript content must not be readable by
everyone who can read a call.

---

## Data retention and erasure

`[planned]` - designed here, not implemented.

The default position matches the sibling `call_transcripts` hub: Open Mercato keeps the call record, and the
recording itself stays with the provider, referenced by `recording_url` rather than copied. Retention is
therefore "keep by default", and PII exposure is bounded by encryption rather than by deletion.

Encryption alone is only half an answer. The other half is erasure.

### Right to erasure for a person

Cross-module cleanup must be event-driven, never an FK cascade - the platform forbids direct ORM
relationships between modules, so a `customers` delete cannot cascade into tables `phone_calls` owns.

`phone_calls` subscribes to `customers.person.deleted` with a persistent, idempotent subscriber and scrubs the
matching `PhoneCallParticipant`: `phone_number`, `display_name` and `email` are cleared while the call row,
its timing and its status survive, because those are business facts rather than personal data. The same pass
MUST scrub `raw_snapshot` and `provider_facts`, since the raw payload carries the same numbers - clearing the
participant alone would leave the PII behind in the snapshot.

A CLI fallback (`yarn mercato phone-calls purge-for-person --personId=<uuid>`) lets an operator re-run the
cleanup after a missed event, mirroring the fallback the sibling hub documents.

### Bounded retention window

Where a tenant needs a hard window instead of indefinite retention, the platform pattern is a queue worker,
not an HTTP endpoint: `ai_assistant:token-usage-prune` is a `WorkerMeta` worker on its own queue with
`concurrency: 1`, a retention window in days, enqueued by a daily system-scoped schedule registered from
`setup.ts`. A `phone_calls:retention-prune` worker would follow that shape, pruning calls whose `started_at`
is older than the window together with their participants.

Exposing prune over HTTP is deliberately rejected: it puts bulk deletion one request away, needs its own ACL
and audit story, and moves the schedule onto the caller. The worker keeps the schedule inside the platform.

### Boundary worth stating

`recording_url` points at the provider. Deleting a call in Open Mercato does not delete the recording at
Tillio, so any tenant-facing retention promise must name that boundary rather than imply full erasure.

Open decision for the phase that implements this: whether the shipped default stays indefinite retention, as
`call_transcripts` chose, or whether calls ship with a default window because a call carries a recording and a
phone number where a transcript carries text the source tool already holds.

---

## UI/UX

### Call list - implemented

`/backend/phone_calls`. Columns: Call ID, Direction, Status, Provider, Started, Duration, Ingest. Filters:
direction, status, provider key, started range. Search covers call/conversation/provider. Default sort is
`started_at desc`.

The list is read-only: no create, no row actions, no bulk actions. The empty state is provider-neutral
("once they are ingested from a provider") because webhooks will later feed the same table without a pull.

### Injected widgets - implemented

`pull-calls` injects into `data-table:phone_calls.calls:toolbar` - the Pull action lives where the calls are,
not on the integration page. The dialog hands the range over and closes; `ProgressTopBar` owns the run from
there, and the list reloads itself when the job completes. `operators-config` injects the
`Operator configuration` tab into the Tillio integration detail spot. Both are provider-owned; the hub does
not know Tillio exists.

### Planned

Call detail page with participants, recording playback, transcript/summary tabs; Personal Communication Hub
rendering of the projection.

---

## Integration test coverage

Per project rules, every affected API and key UI path is covered, and the tests ship with the implementation.
Tests are self-contained: fixtures are created in setup and cleaned up in teardown, with no reliance on
seeded data.

Tillio's API is never called. Every asserted path terminates at a gate before the network: readiness reads the
database, the pull is refused by the readiness gate, and attach is refused by the environment gate. A pull
against a live Tillio environment requires provider credentials and stays a manual check; the logic that runs
after a provider response (normalizer, timestamp parsing, status mapping, URL guard) is unit-tested.

| ID | Path / behavior | Asserts |
|----|-----------------|---------|
| TC-PHONE-HUB-001 | `GET /api/phone_calls/calls` | An ingested call is listed with the declared `listFields` projection |
| TC-PHONE-HUB-002 | `GET /api/phone_calls/calls` ACL | A role without `phone_calls.view` gets 403; an admin reads the same route |
| TC-PHONE-HUB-003 | `/backend/phone_calls` | List shell, seven columns, provider-neutral empty state, search |
| TC-PHONE-HUB-004 | List filters | `q` across all three `$or` columns, `direction`, `status`, `providerKey`, started range, `id`, `sortField` mapping |
| TC-PHONE-HUB-005 | Organization scope | A user homed in one organization cannot read another organization's calls |
| TC-PHONE-001 | `GET /api/tillio/pull` | Unconfigured environment reports `environment_not_ready` rather than erroring |
| TC-PHONE-002 | `POST /api/tillio/pull` | Structured 409 before the provider is contacted; reversed day range rejected with 400 |
| TC-PHONE-003 | Operator routes | Empty listing, attach refused pre-health-check, unsupported plugin rejected, unknown detach is a no-op |
| TC-PHONE-004 | Pull widget injection | The Pull action renders on the hub's list toolbar |
| TC-PHONE-005 | Operators widget injection | The `Operator configuration` tab renders with not-ready guidance |

Hub tests carry the `HUB` infix and live in `packages/core`; provider tests use the bare category and live in
`packages/tillio`, so each package keeps a contiguous sequence and a second provider starts at `TC-PHONE-006`.
Widget tests live in the provider package on purpose: the hub must keep passing with Tillio disabled.

Unit tests: Tillio client, adapter fetch, health, normalizer, operators, operators store, pull readiness,
the pull job (cursor walk, isolated ingest failure, cancellation, operator detached mid-flight), the env
preset (absent, incomplete, complete, rerun with an occupied slot, unhealthy environment, keep-unless-forced,
refused and approved environment switches),
timezone conversion and URL guard (provider package); the ingest command (core).

Two constraints worth recording for whoever writes the next test:

- The hub is ingest-only, so rows are seeded with SQL following the `dbFixtures` precedent rather than adding
  a create route for tests. Only unencrypted columns are written; the three encrypted columns are nullable and
  stay `NULL`, because a direct INSERT bypasses the encryption subscriber.
- Integration runs enable the CRUD list cache, and an INSERT does not invalidate it the way the ingest command
  does. Seeded rows must be read back through a run-unique query, or a repeating query key is served an earlier
  run's payload.
- **The cache invalidation that ingest performs is covered at the command seam, not end to end.** Proving it
  over HTTP needs a real ingest between two identical list requests, and the hub has no route that ingests:
  the only writer is the command, driven by a Tillio pull. Pointing the provider at a local stub does not work
  either, because outbound requests go through `safeOutboundFetch`, which refuses loopback and private targets
  by design. The unit test therefore pins the invariant the route and the bus have to agree on - the alias the
  command emits canonicalizes to the tag the list route derives from the entity class name - and an end-to-end
  assertion waits for a provider sandbox that is reachable from CI.

---

## Risks and impact review

| Risk | Severity | Mitigation |
|------|----------|------------|
| Calls become generic messages, losing lifecycle and recordings | High (design) | `phone_calls` stays the source of truth; only a projection reaches the communication hub |
| A pull fires against a provider the operator was never bound to, after the environment is edited | High | Environment fingerprint recorded at attach; mismatch blocks the pull with `environment_drift` |
| Provider-specific fields pollute the core schema | High | `providerFacts` plus explicit promotion rules; the core aggregate stays provider-neutral |
| Domain FKs leak into the core aggregate | High | Service/customer links live in extension tables only; enforced by review and the module-decoupling test |
| Recording URLs and raw payloads leak (numbers and recordings are PII) | High (security) | Whole-column encryption for `recording_url`, `raw_snapshot`, `provider_facts` and participant fields; `phone_calls.manage` gates raw payload |
| Cross-organization call exposure | High (security) | Tenant/org scoping on every query; covered by TC-PHONE-HUB-005 |
| A single bad record aborts a whole pull batch | Medium | One command invocation per call; failures are isolated, counted, and emitted as `ingest_failed` |
| A wide range outlives the request, leaving the operator with no progress and nothing to resume | Medium | The sweep runs in the `tillio-pull` worker behind a cancellable `ProgressJob`; the route answers `202` |
| Duplicate calls from re-pull or a later webhook | Medium | Unique `(provider_key, external_call_id)` per scope plus idempotent ingest |
| Provider timestamps are ambiguous (wall clock vs offset) | Medium | Day inputs converted from the provider's `Europe/Warsaw` wall clock; conversion unit-tested |
| Tillio's webhook contract is weaker than assumed | Medium | Pull/backfill is the required first path; webhooks are a later phase |
| Transcript content leaks through a projection | High | Permission-gated rendering and redaction, gated on `phone_calls.transcript.view` when transcripts land |
| InboxOps contract shifts | Medium | The bridge stays optional behind a source adapter |
| **Calls are encrypted but kept indefinitely**, so a person's numbers persist after they ask to be forgotten | High (privacy) | Event-driven scrub on `customers.person.deleted` covering participant fields *and* the raw snapshot, plus a CLI fallback - see § Data retention and erasure. Not implemented; until it lands, erasure is a manual database task |
| Deleting a call implies the recording is gone, but it lives at the provider | Medium (privacy) | State the boundary in any retention promise; `recording_url` is a provider reference, not a copy |

---

## Backward compatibility

Additive only. New core module `phone_calls`; new package `@open-mercato/tillio`; new provider key `tillio`;
new ACL features `phone_calls.*` and `tillio.*`; new event ids under `phone_calls.*`; two new tables. No
existing event id, API route, DI name, ACL id, widget spot id or table changes.

The hub consumes an existing spot contract (`data-table:<tableId>:toolbar`) and an existing integration
detail spot; neither is modified.

Later phases stay additive by construction: transcripts, summaries and `PhoneCallIngestEvent` are new tables;
`phone_calls.transcript.view` is a new feature; the webhook path writes to the table the pull already writes.

---

## Implementation phases

**Phase 1 - core hub foundation.** Implemented. Shared provider contract and DTOs, the `phone_calls` module,
entities and migration, the ingest command, the read API, the backend list, OpenAPI, unit tests. Deferred
within the phase: the detail page and the provider registry (one provider does not justify dispatch).

**Phase 2 - Tillio provider.** Implemented. `@open-mercato/tillio` with the two-level configuration, the
single adapter dispatching by plugin, health check, readiness, the queued pull and its worker, operator
routes, normalizer, and the two injected widgets. Deferred: additional operator plugins.

**Phase 3 - communication projection.** Planned. Register the `phone_calls.call` activity type, an idempotent
projection command refreshed after ingest, a renderer for the Personal Communication Hub, and
permission-based redaction.

**Phase 4 - InboxOps bridge.** Planned, blocked: it requires a source-native InboxOps intake contract to land
first. PR #1647 was closed unmerged, so the contract source has to be settled before this phase starts.

**Phase 5 - webhooks.** Planned, and dependent on confirming the provider's webhook contract and event types.
Register the adapter, verify signatures, dedupe by event id, and add `PhoneCallIngestEvent` as the delivery
audit log with replay.

**Phase 6 - CRM exposure.** Deferred by decision. Kept out until the CRM direction is settled; when it lands
it belongs in the CRM module or a domain extension package, not in `phone_calls`.

**Phase 7 - data retention and erasure.** Planned. The `customers.person.deleted` subscriber and the CLI
fallback are the priority, because encryption without an erasure path is an incomplete answer to a deletion
request; the optional `phone_calls:retention-prune` worker follows. Sequencing note: the erasure subscriber
must scrub `raw_snapshot`, so it is cheaper to build before transcripts and summaries add more places PII can
hide, not after.

---

## Alternatives considered

**Model calls as `communication_channels` messages.** Rejected because `ChannelAdapter` cannot express call
lifecycle, duration or a recording artifact without distorting that hub. See § Architecture.

**A hub-generic pull route.** Rejected for now because pull bodies are provider-shaped. See § API contracts.
Revisit when a second provider exists.

**Multiple operators per Tillio tile.** Rejected: one tile means one environment, and multiple operators on one
environment would make the environment-fingerprint binding ambiguous. A second environment is a second tile.

---

## Final compliance report

Scope of this report: the implemented slice (Phases 1-2). Planned phases are design only.

- **Module boundaries**: Tillio logic lives entirely in `packages/tillio/`; no provider code in
  `packages/core`. The hub never imports the provider.
- **Provider does not write ORM entities**: the pull normalizes payloads and invokes
  `phone_calls.call.ingest`; the provider package touches no `phone_calls` entity.
- **No domain FKs on the aggregate**: `PhoneCall` carries no service-ticket, customer or contact id.
- **Tenant isolation**: every query is tenant/org scoped; verified by TC-PHONE-HUB-005.
- **Encryption**: recording URL, raw snapshot, provider facts and participant PII are encrypted via the
  module's `encryption.ts`; reads go through decrypting helpers.
- **Erasure**: not implemented. Call PII is encrypted but retained indefinitely, and there is no subscriber
  answering `customers.person.deleted`. Until Phase 7 lands, honouring a deletion request is a manual database
  task. This is the one known governance gap in the implemented slice - see § Data retention and erasure.
- **RBAC**: `phone_calls.view` / `.manage` and `tillio.manage` declared in `acl.ts` and seeded in `setup.ts`
  `defaultRoleFeatures`; existing tenants pick them up via `yarn mercato auth sync-role-acls`.
- **OpenAPI**: every route exports `openApi`.
- **i18n and design system**: list and widgets use `useT` with `en`/`de`/`es`/`pl` locale files and
  design-system tokens; no hardcoded user-facing strings or status colors.
- **Optimistic locking**: not applicable - the hub exposes no user-editable entity and no edit form.
- **Tests**: 22 integration tests (TC-PHONE-HUB-001..005, TC-PHONE-001..005) plus provider and command unit
  tests, shipped with the implementation; no live provider calls.
- **Backward compatibility**: additive only; no contract surface modified.

---

## Changelog

### 2026-08-15 - Configurable provider time zone

- The Tillio wall-clock zone moved from a module constant to an optional `timeZone` credential, validated
  against `Intl` and defaulting to `Europe/Warsaw`. It is threaded through the pull window, the outbound
  filter format and timestamp normalization, and can also be set with `OM_INTEGRATION_TILLIO_TIMEZONE`.
- It stays out of the environment fingerprint, so changing the zone does not invalidate an attached operator.

### 2026-08-14 - Deployment-managed preconfiguration

- Added `lib/preset.ts` and `cli.ts`: the provider parses `OM_INTEGRATION_TILLIO_*`, applies the preset from
  `setup.ts` on tenant bootstrap, and exposes `mercato tillio configure-from-env` for reruns and rotation.
- Every step routes through the service the admin UI uses for the same action, so env-driven and
  hand-configured tenants converge on the same stored state and the result stays editable in the UI.
- The chain covers the operator too when `OM_INTEGRATION_TILLIO_RINGOSTAT_KEY` is set; the token stays a
  product of `attachOperator` rather than an input.
- A forced switch to a different Tillio instance revokes the attached operator before the credentials are
  replaced, and is refused unless approved by `OM_INTEGRATION_TILLIO_REPLACE_OPERATOR` or the CLI prompt.

### 2026-08-14 - Pull moved off the request

- `POST /api/tillio/pull` now creates a cancellable `ProgressJob`, enqueues the `tillio-pull` worker and
  answers `202` with `{ progressJobId }`; the previous contract swept the range inside the request and
  returned counts, which left a wide range with no durable progress and nothing to resume. A concurrent pull
  is refused with `429`.
- Added `lib/pull-job.ts`, `lib/queue.ts` and `workers/tillio-pull.ts`; the worker re-resolves environment and
  operator on every attempt and carries no credentials in its payload.
- The call list reloads on `progress.job.completed` for jobs whose `meta.resourceKind` is the phone-call
  resource kind, replacing the widget's full page reload. The constant moved to
  `@open-mercato/shared/modules/phone_calls/types` so a client surface can read it without importing the
  ingest command.
- Removed `fetchCall` from the provider adapter contract: it was declared but implemented only as a throwing
  stub, and nothing consumed it. It returns with the phase that needs single-call retrieval.

### 2026-07-16 - Reconciled with the implementation

- Rewrote the document against the shipped code and removed stale design that the implementation contradicted.
- Corrected the list response to the native `makeCrudRoute` envelope (`total` / `totalPages`), previously
  documented as `totalCount`.
- Replaced the hub-generic `POST /api/phone_calls/providers/:providerKey/pull` with the implemented
  provider-owned `GET`/`POST /api/tillio/pull`, and documented the readiness contract and blocker precedence.
- Documented the operator routes, the events, and the module-level ACL (`phone_calls.view` / `.manage`);
  `phone_calls.transcript.view` marked planned and additive.
- Marked `PhoneCallTranscriptVersion`, `PhoneCallSummaryVersion` and `PhoneCallIngestEvent` as planned, with
  `PhoneCallIngestEvent` moved to the webhooks phase.
- Recorded that the list is read-only by design and that no create route exists.
- Added the integration test coverage table, the alternatives considered, and the final compliance report.
- Corrected the package name to `@open-mercato/tillio`.
- Added data retention and erasure as a designed phase. The hub encrypts call PII but keeps it indefinitely,
  which leaves a deletion request unanswered; the gap is now documented with an event-driven scrub on
  `customers.person.deleted` (participant fields plus the raw snapshot), a CLI fallback, and an optional prune
  worker following the `ai_assistant:token-usage-prune` pattern rather than an HTTP endpoint.

### 2026-07-08 - Two-level Tillio configuration

- Replaced the original single-level Tillio configuration with the two-level model: environment credentials in
  the native `Credentials` tab validated by the health check, and one detachable operator slot in a separate
  store surfaced by a custom tab, bound to the environment by a fingerprint.

### 2026-06-10 - Architecture feedback

- Kept `phone_calls` as a hub separate from `call_transcripts`, treated SMS as `communication_channels`, gated
  the InboxOps bridge on a source-native intake contract, and deferred CRM exposure.

### 2026-06-09 - Initial spec

- Core `phone_calls` hub, provider adapter contract, Tillio provider package, Personal Communication Hub
  projection, InboxOps bridge, and the provider payload evolution contract.
