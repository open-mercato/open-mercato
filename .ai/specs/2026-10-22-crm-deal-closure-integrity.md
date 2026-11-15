# CRM deal closure integrity

## 📝 TLDR

Make stage, semantic outcome, actual close date and closure events agree for every deal write. Add explicit stage outcomes and a stable `closed_at` separate from `expected_close_at`; preserve all existing status spellings and integrate with the tenant vocabulary proposed in [PR #7625](https://github.com/open-mercato/open-mercato/pull/7625). This is the closure capability of [issue #7700](https://github.com/open-mercato/open-mercato/issues/7700), independently shippable before other CRM field work.

## Overview

Proposed on 2026-10-22 against `main` `0c886d0a14c02106ff2abc9728be36c04c5a2ccd`. The [Phase 1 decision record](2026-10-22-crm-field-model-phase-1.md) supplies shared implementation and validation rules. #5106 is closed; current `commands/deals.ts` handles status-to-stage, while Kanban sends stage IDs. `lib/closureStage.ts` matches English terminal labels. `/api/customers/deals/:id/stats` currently uses `updatedAt` for close date, weekly/quarterly windows and sales-cycle length. PR #7625 remains open at `a0ca00340a29549bada6558281fbc0fa7edbb9da`, now targeting `main`; it must not be described as merged functionality.

## Resolved assumptions (autonomous defaults)

| Question | Applied default | Reason |
|---|---|---|
| Does the issue's fixed status spelling override tenant vocabulary? | Defaults remain `open`/`win`/`lost`; when #7625 is integrated, use its resolved canonical tokens and legacy aliases. | Preserve the published vocabulary contract rather than hardcode English strings. |
| Does every edit of a closed deal update its close time? | No; only semantic closure transitions create a timestamp. | Reporting must survive notes, owner, amount and stage-label edits. |
| Can stage-transition rows prove an old actual close date? | Use eligible values as estimates with provenance, not authoritative history. | Existing rows are unique per deal/stage and overwritten on revisits. |
| What about generic legacy `closed`? | Keep terminal-with-unknown-outcome readable/writable during the bridge; never silently count as won/lost or reopen. | Existing API/text-column behavior is protected. |

## 📝 Problem Statement

Editing a closed deal changes `updated_at` and therefore historical closure reporting. Label-driven terminal behavior breaks with localized labels. A drag can create a stage/status contradiction and bypass the loss-reason experience. [HubSpot's deal property documentation](https://knowledge.hubspot.com/properties/hubspots-default-deal-properties) describes close-date automation and reopen behavior; [Dynamics 365](https://learn.microsoft.com/en-us/dynamics365/sales/close-opportunity-won-lost-sales) records closure date/revenue with a closure activity. These demonstrate the need for explicit semantics and history, rather than a claim that all CRMs behave alike. More source context is in the [research note](assets/crm-field-model-phase-1/research.md).

## 📝 Proposed Solution

One customers-owned transition resolver is called by deal create/update commands, including their AI, bulk and import entry points. It computes the complete new state from the old state, requested fields, pipeline stages and vocabulary. All validation happens before mutation. Persistence, transition receipt and stage history updates share a transaction; events/cache/index effects follow commit.

### Transition rules

| Request / previous state | Result |
|---|---|
| Explicit stage with `outcome=won` | Canonical won status (`win` by default), `closureOutcome=won`, `closedAt=now` only on entry to won from another semantic outcome. |
| Explicit stage with `outcome=lost` | Canonical lost status, `closureOutcome=lost`; close time as above; run existing loss-reason validation. |
| Explicit stage with `outcome=open` | Canonical `open`; clear `closureOutcome` and `closedAt`; append reopen transition if previously terminal. |
| Status/outcome supplied without stage | Resolve semantic intent using vocabulary; select same-pipeline stage with matching explicit outcome (order then ID tie-break). If none, retain existing no-stage closure behavior and show configuration warning; do not fabricate a stage. |
| Explicit status/outcome and stage disagree | Reject atomically with 400 `DEAL_OUTCOME_CONFLICT`; show fields requiring correction. Never silently prefer one. |
| Same semantic outcome, including moving between two won stages | Preserve `closedAt`; do not emit won/lost again. Status alias normalization is not a new closure. |
| Won → lost or lost → won | A new outcome transition: set new `closedAt`, record old and new outcome; emit the new outcome event once logically. |
| No outcome-related field supplied | Preserve closure fields, even on legacy contradictory rows; surface migration warning rather than repair on unrelated edit. |
| Generic legacy `closed` with no known outcome | Preserve terminal unknown classification, no won/lost event, no fabricated outcome. Existing `closedAt` is retained; newly generic-closed writes get a timestamp with unknown outcome. |
| Legacy `pipelineStage` text only | Retain the existing compatibility behavior; do not infer new semantics from arbitrary text. New UI always uses stage ID. |

Reopening clears active loss fields from the current deal projection, preserving them in the transition/audit history. Correcting loss notes on the same lost outcome does not re-close. Explicit backdated/corrected close dates are not part of this phase; `closedAt` is read-only to ordinary deal payloads. Migration is the only historical writer. `expectedCloseAt` remains a forecast date and is never overwritten by closure logic. Stage outcome edits affect future transitions only; they never mass-close or reopen existing deals. For a stage currently referenced by deals, the settings UI discloses the affected count and requires confirmation; existing contradictory deals appear in the reconciliation report.

## 📝 Architecture

Reuse `commands/deals.ts`, `lib/dealStatus.ts`, `lib/closureStage.ts`, stage commands, `events.ts`, existing notifications and bulk worker/progress infrastructure. Add `lib/dealClosureTransition.ts` for the shared resolver; no parallel route-local state machine. Keep the exported `TERMINAL_PIPELINE_STAGE_LABELS` and legacy helper signatures as deprecated bridges for at least one minor release. Add optional outcome to stage snapshots without removing keys. The resolver is internal; only documented exported compatibility helpers are public.

Integrate #7625 first, or include a separately reviewed compatibility adaptation of the closure slice when it is ready. Do not copy its settings implementation into this PR. Re-run its vocabulary/AI-staleness coverage against the combined head; record the actual dependency commit at implementation time. No `develop` branch is advertised by the remote as of this review, so the spec follows configured `main` rather than inventing an integration target.

## 📝 Data Model

| Entity/field | Contract |
|---|---|
| `CustomerPipelineStage.outcome` | Text constrained to `open`, `won`, `lost`; new stages default `open`. Existing rows are expanded nullable during migration, then backfilled before NOT NULL. |
| `CustomerDeal.closedAt` / `closed_at` | Nullable timestamptz, actual current closure timestamp; cleared on reopen. |
| `CustomerDeal.closedAtSource` / `closed_at_source` | Nullable `transition`, `legacy_stage_estimate`, `legacy_updated_at_estimate`; optional response field distinguishes historical certainty. |
| `CustomerDealClosureTransition` / `customer_deal_closure_transitions` | Append-only record with UUID, tenant/org, deal ID, created/updated timestamp, from/to semantic outcome (including unknown terminal), prior/current close time, prior/current stage ID, actor user UUID nullable, operation ID, encrypted loss-notes snapshot, loss reason ID, nullable `event_delivered_at`, retry counter. Operational delivery fields are mutable; historical business fields are immutable. |

The transition receipt is narrow domain history and recovery state, not a replacement event bus or custom queue. Unique `(tenant_id, organization_id, operation_id, deal_id)` prevents duplicate transition receipts. Index `(tenant_id, organization_id, deal_id, created_at, id)` for history and pending-delivery index for recovery. No cross-module ORM relationships. Extend `customers/encryption.ts` for sensitive transition snapshots and migration maps for existing tenants. API output includes ordinary `updatedAt`; history rows are read-only and not independently edited/deleted.

Add a newly named closure-date index on `(organization_id, tenant_id, closure_outcome, closed_at)` for reader cutover after backfill; retain the existing `customer_deals_closure_stats_idx` unchanged under the additive-only index contract. Validate both plans; this phase does not drop or rename an index.

## 📝 API Contracts

| Existing or new route | Contract changes / permission |
|---|---|
| `GET/POST/PUT/DELETE /api/customers/deals` and `GET /api/customers/deals/:id` | Add `closedAt` and `closedAtSource` response fields; preserve old status strings/aliases. Deal types and creator attribution are governed by their separate capability specs and are not dependencies. Existing `customers.deals.view/manage` guards and envelopes remain. Read-only fields cannot be client-overwritten. |
| `GET/POST/PUT/DELETE /api/customers/pipeline-stages` | Add `outcome` and `updatedAt` to list items; create defaults open, update supports outcome with stage optimistic header. Existing pipelines view/manage guards remain. |
| `POST /api/customers/pipeline-stages/reorder` | Preserve request shape and order-only semantics; never alter outcome or deal closure. |
| `POST /api/customers/deals/bulk-update-stage` | Preserve `{ids,pipelineStageId}` and `{progressJobId,...}`. Add optional `lossReasonId`, `lossNotes`, `expectedVersions: Record<dealId,updatedAt>` for the new UI. Each worker item uses the same command and its own expected version. |
| `GET /api/customers/deals/:id/stats` | Same fields; `closedAt` and calculations now use the stored date. Add optional date-source disclosure. Unknown-outcome deals retain existing `DEAL_NOT_CLOSED` handling for won/lost stats. |
| `GET /api/customers/deals/:id/closure-history` (new) | `{items:[{id,fromOutcome,toOutcome,closedAt,occurredAt,actorUserId,lossReasonId}],nextCursor}`; maximum 100; `customers.deals.view`; sensitive notes only where current deal notes are visible. |
| List/aggregate/summary/map and linked-company/person deal metrics | Keep existing URLs/envelopes; add `closedAtFrom/To` ISO timestamps where date filtering applies, retain forecast filters. Date-based realized outcome metrics use `closedAt`; current pipeline metrics keep their present meaning. |

Example update: `PUT /api/customers/deals` body `{id, pipelineStageId, lossReasonId, lossNotes}` with standard `x-om-ext-optimistic-lock-expected-updated-at`; response retains existing `{ok:true}` shape and operation metadata, and clients refetch the authoritative detail. Standard 400 validation/outcome-conflict, 401/403, scoped 404 and 409 optimistic conflict apply. No-header legacy requests remain accepted per framework contract; new UIs always send versions. Loss reason stays optional where existing contract allows it; drag opens the same dialog and supports the same optional/no-reason choice. Bulk Lost opens one shared dialog before queueing; missing reason cannot silently bypass a tenant's explicit validation policy.

## Events, concurrency and undo

Lock/re-read the deal and selected stage inside the command transaction; semantic resolution uses the locked snapshots. A vocabulary change between AI preview and apply invalidates that preview as #7625 defines. Concurrent stage-outcome edits cannot race a stale stage snapshot. Record exactly one transition per semantic change, then use the existing persistent event bus to emit `customers.deal.won/lost`; retain existing payload fields and scope in both payload and delivery options, add optional `transitionId`, `closedAt`, `previousOutcome` and `operationId`.

A crash after commit/before enqueue leaves a pending receipt. A customers worker on `@open-mercato/queue` republishes pending events with the same transition ID and marks delivery after successful persistent enqueue. Delivery is at least once, not globally exactly once; notification handlers deduplicate by transition ID and external consumers are documented to do likewise. A repeated command with no semantic change emits no new event. Recovery never changes the deal again. On errors use structured logging plus `reportError` without notes/PII. Do not introduce a separate queue implementation or alter global event delivery settings.

Undo verifies the current deal version and restores the whole before snapshot (stage/status/outcome/date/source/loss fields/relations/custom fields), then appends a compensating transition and refreshes caches/indexes. Do not re-emit won/lost as if undo were a new sale; emit a new additive `customers.deal.closure_reverted` event with transition references so downstream systems may compensate. Already sent notifications or external actions cannot be unsent; disclose that limitation. Delete/restore preserves closure history and scope; history is excluded when parent is inaccessible.

## 📝 UI/UX and Frontend Contract

Kanban, deal list/detail and bulk actions share a bounded `DealClosureDialog` client leaf for Lost, with cancellation restoring the prior card position and making no request. Pending mutations lock that card/action; 409 restores server state and presents `surfaceRecordConflict`, with no blind drag retry. Detail labels distinguish Expected close from Closed on and Estimated historical close date. Pipeline settings use a localized outcome select independent of the label/color. History uses existing activity/list primitives; no new chart dependency.

The existing large client page files are recorded as temporary legacy exceptions in the shared frontend contract; do not grow them with resolver/dialog logic. New leaves stay ≤300 LOC, use `CrudForm` or `useGuardedMutation`, shared HTTP helpers, child/parent-specific versions and DS primitives. No global provider/bootstrap changes. Browser tests must cover detail, list, `/backend/customers/deals/pipeline` and pipeline settings; verify 390px layout, keyboard loss dialog, hydration and failed/conflicting transitions.

## Migration & Backward Compatibility

1. Add nullable fields and stage outcome; classify existing stage labels using the current exported terminal sets. Unknown/localized labels default open with a report for review, never guessed from color/order. After explicit outcome exists, label edits never change it; legacy exported functions remain bridges.
2. Backfill only deals with a recognized won/lost status or nonconflicting `closure_outcome`. Conflicting status/outcome rows are reported and left unchanged until reviewed. Prefer the latest eligible terminal-stage `transitioned_at` consistent with the current outcome and bounded by created/updated times; mark `legacy_stage_estimate`. Otherwise use migration-time snapshot of `updated_at`, marked `legacy_updated_at_estimate`. These are estimates because the current transition table is a mutable per-stage projection, not a complete ledger. No fake historical won/lost events.
3. Backfill generic `closed` date from snapshot `updated_at` with estimate provenance, but leave outcome null. Open deals remain null. Backfills are scoped, resumable/keyset-batched (500 rows) and record counts/IDs/errors without PII; >1000 rows use queue/progress.
4. Dual readers fall back to legacy timestamps only while a clearly tracked migration remains incomplete. After cutover, edits never alter historical estimates. Keep legacy columns/text/status values, OpenAPI shapes and filter aliases. Upgrade notes explain reporting date changes, estimates, and at least one-minor compatibility bridges.

Rollback disables new write semantics only after pausing writers and validating a compatibility release; retain dates/history and old columns. Never drop migrated data in a routine down migration. Snapshot before-values in the reviewed migration artifact; reversing approved backfills is version-checked and skips later edits. The high-risk operation is data/semantic cutover, not this design-only PR.

## 📝 Risks & Impact Review

| Scenario / severity | Mitigation | Residual risk |
|---|---|---|
| Ambiguous legacy dates change reporting / high | Estimate provenance, migration report and per-tenant reconciliation before reader cutover. | Exact history cannot be reconstructed. |
| Dual vocabulary/stage resolver disagrees / high | One semantic resolver, #7625 integration gate, contradiction rejection, case/alias tests. | Third-party direct SQL bypasses commands. |
| Crash loses notification or retry duplicates it / high | Durable transition receipt, existing queue recovery, stable event ID and consumer dedupe. | External consumers must adopt idempotence. |
| Stage edit silently closes many deals / high | Never recompute current deals on settings writes; explicit future transitions only. | Old contradictions need reconciliation. |
| Concurrent close/reopen or bulk overwrite / high | Transaction lock, version checks per deal, per-item failures/progress. | Legacy no-version callers retain compatibility semantics. |

## Integration Coverage

Add `customers/__integration__/TC-CRM-CLOSURE-001.spec.ts` through `004`: all deal create/update pathways (HTTP, command, AI approval, import, bulk worker), stage CRUD/reorder, history, stats, summary/aggregate/map/linked-record metrics. Test localized labels, two won stages, conflicting explicit inputs, missing terminal stage, generic closed, unknown/custom aliases, case normalization, no-header legacy requests, stale versions, cross-org stage IDs, viewer/wildcard permissions, missing/optional reason, delete/restore, undo, event scope and duplicate delivery. Frozen clock covers open→won→edit→lost→reopen→won and stable report periods. Fixture migration includes multiple stage revisits, conflicting outcomes, no transitions and custom dictionaries; verify no closure events during backfill. Inject crash before/after enqueue and assert eventual one logical event/notification. Use disposable fixtures, deterministic queue draining and cleanup. UI interaction matrix includes every route named above and cancellation/error/conflict paths.

## Final Compliance Report — 2026-10-22

Reviewed against core/customers/events/queue/progress/UI/shared concurrency guidance and backward-compatibility categories. Models, response additions, transition rules, event retries, scoped history, command undo and tests align. Runtime delivery is high risk and requires data reconciliation and #7625 compatibility verification before implementation merge. This design does not claim migration accuracy beyond marked estimates or executed tests.

## Changelog

- 2026-10-22: Initial spec; corrected issue's mutable-stage-history assumption; preserved vocabulary and generic-closed compatibility; specified crash recovery and compensated undo.

## 📋 Implementation Plan

### Phase 1 — Add closure data without changing active workflows

1. Integrate/verify #7625 contracts, then add schema, outcome settings and migration report with fixture tests. Existing deal writes remain functional under bridges.
2. Ship scoped backfill/provenance and report regression tests while legacy readers retain their compatibility fallback; do not cut readers over until Phase 2 step 1 has deployed every transition-aware writer.

### Phase 2 — Unify all state changes

1. Route create/update/AI/import/bulk through atomic resolver and history receipts; test the state matrix, optimistic conflicts, after-commit event/recovery and undo in the same change. After every writer is deployed and the final reconciliation passes, cut reporting readers over to stored closure dates, verifying new closes/reopens during the migration window.
2. Wire shared Lost dialog, outcome settings and close-date UI; ship browser tests and performance evidence. Remove duplicate route/UI logic only after every real call site uses the resolver.
