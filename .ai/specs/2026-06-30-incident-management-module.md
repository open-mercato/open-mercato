# Incident Management Module (OSS core)

> **Implementation status (2026-07-02):** Phases 1–6 + the v2 Elevation are implemented on `feat/incidents` (v1 P1–P2 + v2 escalation policies/runtime/sweep committed as `incidents init`; the v2 completion — settings/policy-manager UI, postmortems, action items, merge/link/reopen, portal view, bulk ops, auto-incident subscribers, impact-refresh, dashboards, user pickers, TC-INC-007–009 + unit suites — staged on top). Deviations and test-coverage deltas: see Changelog 2026-07-02. The v2 section remains the authoritative design for escalation and CRM/sales impact.

## TLDR

**Key Points:**
- A new core module `incidents` (`packages/core/src/modules/incidents/`) for **internal incident management**: incidents with configurable severity, lifecycle states, internal owners/teams/roles, an append-only timeline, postmortems + tracked action items, **customer & order impact linkage with revenue rollup**, and **timeout-driven escalation**.
- Primary value: incidents embedded next to CRM/sales data — answering "which customers, orders, and revenue are affected" — which a standalone SRE tool structurally cannot. Reuses platform engines (events, notifications, scheduler, audit_logs, attachments, messages, planner, perspectives, dashboards, portal) instead of rebuilding SRE tooling; cross-module links are FK-id + snapshot only.

**Scope (OSS core v1):**
- Incident lifecycle + states, severity & priority, internal owners/teams/per-incident roles, subscribers vs responders.
- Append-only timeline with internal vs customer-facing notes/updates; attachments.
- Customer + sales-order + customer-account impact linkage with revenue rollup; lightweight per-incident component impact; **portal-facing per-account incident visibility**.
- Acknowledge action + `acknowledged_at`; scheduler-cron escalation sweep (ack-timeout escalation, escalation chain, SLA at-risk/breach, snooze expiry); module-owned config catalogs (severity/type/role/settings) and a concurrency-safe incident-number sequence.
- Postmortems + action items + required-fields-on-resolve gate; merge/link; reopen; cascade-on-close.
- War-room detail page, list (+bulk +perspectives), create form, settings; UMES enrichers + widget injection on CRM/sales; auto-incident subscribers; dashboards widgets.

**Concerns:**
- Module independence: catalogs are **module-owned** (no `dictionaries` dependency); all peer modules are **soft-optional** (`allowUnregistered`/events) so `incidents` works enabled or disabled.
- Escalation/SLA timing depends on the scheduler sweep cadence (poll latency, bounded).
- Inbound auto-incident trigger event IDs are a contract dependency — must be verified against each source module's `events.ts` at implementation.

> **Basis:** [ANALYSIS-010-2026-06-30-incident-management-module.md](analysis/ANALYSIS-010-2026-06-30-incident-management-module.md). **Reference module:** `customers` (ARCHITECTURE §29). **Enterprise deferral:** public status pages, advanced SLA engine (business-hours calendars/pause), AI postmortems, complex on-call rotations, multi-channel paging, AIOps alert ingestion, config-as-code, SSO/SCIM, MSP analytics → separate spec under `.ai/specs/enterprise/`.

---

## Overview

`incidents` lets internal teams declare, triage, own, escalate, communicate, and learn from operational incidents — and ties every incident to the customers, orders, and revenue it affects. The audience is internal operators/support/engineering (backoffice) plus, read-only, the affected customer (portal). It mirrors the `customers` module's full-stack pattern: MikroORM 6.6 entities, `makeCrudRoute` + command pattern with undo, query-index coverage, search config, custom fields, typed events, notifications, widget injection, and a CrudForm-based create flow — with a purpose-built war-room detail page for the live-incident experience.

> **Market Reference:** Studied PagerDuty, Atlassian Opsgenie, incident.io, FireHydrant, Rootly, Jira Service Management (ITIL), ServiceNow ITSM, and Atlassian Statuspage (full matrix in the analysis doc).
> **Adopted:** configurable severity + lifecycle states; per-incident roles (Commander/Comms Lead/Scribe); responders-vs-subscribers; append-only timeline; internal-vs-customer-facing updates; postmortems + tracked action items; required-fields-on-resolve; reopen; merge/link; drill flag; types as schema drivers; ACK + escalation.
> **Rejected for OSS core (→ enterprise):** public/branded status pages, alert-ingestion/AIOps pipelines, multi-channel paging (SMS/voice/push), complex layered on-call rotations, advanced SLA calendars, AI-drafted postmortems, runbook automation against external systems. **Rejected outright:** rebuilding an on-call rotation engine (read availability from `planner`), a state-machine engine (delegate automation to `workflows`), or a catalog service (own the catalogs; do not depend on `dictionaries`).

## Problem Statement

Open Mercato has no structured place to record an incident, assign an owner, track a timeline, declare severity, escalate when unacknowledged, communicate customer impact, or capture a postmortem. Most importantly, there is no way to connect an incident to the CRM/sales records it affects, so the platform cannot answer the question that matters most inside an ERP/CRM — *which customers, orders, and revenue are impacted right now*. Adopting an external SRE tool cannot close this gap: it has no access to the customer/sales datastore and can only reason about abstract "services."

## Proposed Solution

A single, self-contained core module `incidents` built on the canonical primitives. Core domain entities (`incident`, `incident_timeline_entry`, `incident_participant`, `incident_impact`, `incident_action_item`, `incident_postmortem`) plus module-owned config catalogs (`incident_severity`, `incident_type`, `incident_role`, `incident_settings`) and a concurrency-safe `incident_number_sequence`. CRUD via `makeCrudRoute`; high-contention state changes (transition, ACK, assign, add-note, impact/participant/action edits) as **command-style action endpoints** that enforce **command-level optimistic locking against the parent incident aggregate**. Timeout-driven behavior (escalation, SLA at-risk/breach, snooze expiry) runs on a **scheduler-cron sweep worker**, because the event bus is reactive only. Cross-module value (revenue blast-radius, account-record widgets, portal visibility, customer-tier-driven escalation) is delivered through **events, FK-id + snapshot, UMES enrichers/injection, and soft-optional DI resolves** — never ORM relations or imports, so the module degrades gracefully when a peer is disabled.

### Design Decisions

| Decision | Rationale |
|---|---|
| Module-owned config catalogs (`incident_severity`/`type`/`role`/`settings`) seeded in `setup.ts` | Keeps `incidents` self-contained — no hard `requires: ['dictionaries']` (which would break the "works enabled or disabled" rule). Per the user's module-independence constraint. |
| Lifecycle states are a fixed, documented enum in v1 (open → investigating → identified → mitigated → resolved → closed) | Avoids shipping a state-machine config engine in v1; labels are i18n'd; configurable states deferred. Transitions validated server-side. |
| Scheduler-cron sweep as the single timer substrate | Events are reactive only; `SchedulerService.register()` (cron/interval) + a queue worker is the canonical, durable mechanism (used by `communication_channels`). One mechanism covers ack-timeout, escalation chain, SLA, snooze, overdue-action reminders. |
| Command-level optimistic locking on the **parent incident aggregate** for all sub-resource writes | Multiple responders mutate one live incident concurrently; guarding the aggregate's `updated_at` (document-aggregate pattern, AGENTS) yields correct 409s on timeline/participant/impact/action writes, not just CrudForm. |
| Module-owned `IncidentNumberGenerator` mirroring `SalesDocumentNumberGenerator` (atomic `INSERT … ON CONFLICT DO UPDATE … RETURNING`) | Lock-free, concurrency-safe per-(org,tenant) sequence; avoids the soft-delete/partial-unique-index flakes; format-token templating reused. |
| War-room composite detail page (not a generic CrudForm) | A live incident is a high-density operations view (status header + actions, timeline, responders, impact, action items); CrudForm is used only for the create flow and simple field edits. |
| Impact `snapshot` holds display + metric fields only (label, amount, currency, tier, status); PII re-fetched live via enricher | Sidesteps the jsonb-encryption footgun and stale-PII; revenue rollup uses stored numeric metrics; names/emails are never persisted in the snapshot. |
| Portal visibility in v1 (per the gate) | Reuses portal auth + portal event bridge for an account-scoped read-only view — the OSS substitute for a public status page. |

### Alternatives Considered

| Alternative | Why Rejected |
|---|---|
| Reuse `dictionaries` for catalogs | Hard dependency; breaks module independence (user constraint). |
| Per-incident queue delayed-jobs for escalation timing | More precise but adds cancel/reschedule complexity on every transition; scheduler sweep is simpler and durable. Hybrid deferred. |
| Reuse `resources` as a service/component catalog | Couples to `resources` and assumes teams model services there; v1 uses lightweight per-incident component entries (gate Q3). |
| Generic `audit_logs` as the timeline | Audit is append-only governance, not a curated operational timeline with internal/customer-facing visibility and composer UX; we keep a domain timeline and still get audit for free via the command bus. |
| Build an on-call rotation engine | Over-scoping; read current availability from `planner` (soft-optional); layered rotations are enterprise. |

## User Stories / Use Cases

- An **operator** wants to **declare an incident, set severity/type, and assign an owner** so that responsibility is clear immediately.
- A **responder** wants to **post timeline updates (internal) and customer-facing updates separately** so that internal coordination never leaks to customers.
- An **incident commander** wants to **see affected customers, orders, and total revenue at risk** so that severity and exec escalation reflect business impact.
- A **manager** wants an **unacknowledged incident to escalate automatically after a timeout** so that nothing is dropped.
- A **support lead** wants **postmortems with tracked action items and a required root-cause before close** so that the team actually learns.
- An **affected customer** wants to **see incidents scoped to their own account in the portal** so that they stay informed without internal access.
- A **CRM user** wants to **see an account's live incident status on the customer record** so that they have context before contacting the customer.

## Architecture

### Module shape & independence

- Location: `packages/core/src/modules/incidents/`. Standard discovery files (ARCHITECTURE §4). `index.ts` declares **no hard `requires`** for business peers — `customers`, `sales`, `customer_accounts`, `portal`, `workflows`, `business_rules`, `communication_channels`, `messages`, `planner`, `staff`, `dashboards`, `notifications`, `attachments` are all **soft-optional**, resolved via `container.resolve(key, { allowUnregistered: true })` or reached only through the event bus. The module's core (CRUD + timeline + escalation sweep) works with every peer disabled.
- Read path → `QueryEngine` over `query_index`; write path → `DataEngine` via the command bus. CRUD lists declare `indexer.entityType: E.incidents.incident` + `list.entityId`. Custom-field requests use `cf_`/`cf:`; responses use bare names.

### Escalation sweep (the timer substrate)

```mermaid
sequenceDiagram
  participant Sch as SchedulerService (cron/interval)
  participant Q as Queue: incidents-escalation-sweep
  participant W as Worker: escalation-sweep
  participant CB as Command bus
  participant N as notifications (soft-optional)
  Sch->>Q: enqueue tick { scope:{tenantId,organizationId} }  (every 60s)
  Q->>W: run(tick)
  W->>W: find active incidents WHERE next_escalation_at<=now AND snoozed_until is null/passed
  W->>CB: incidents.incident.escalate (bump level, set next_escalation_at)
  W->>W: evaluate SLA: set sla_breached / at-risk; clear expired snoozes
  CB-->>N: emit incidents.incident.escalated → notify next chain target
```

**Concurrency safety (critical — the worker has no HTTP request, so `enforceCommandOptimisticLock` does NOT apply here).** The sweep must be safe against overlapping ticks by construction, not by optimistic-lock headers:
- The escalation-sweep worker is registered **single-flight** (`concurrency: 1` in its worker metadata, mirroring the `communication_channels` poll-tick worker) so two ticks for the same queue never run concurrently.
- Each escalation is advanced with an **atomic conditional UPDATE** that both selects and claims the work in one statement: `UPDATE incidents SET escalation_level = escalation_level + 1, next_escalation_at = <recomputed>, updated_at = now() WHERE id = ? AND next_escalation_at <= now() AND deleted_at IS NULL RETURNING id` — so a double-tick can advance a given incident at most once per due window (the second tick's predicate no longer matches).
- SLA flags are **set-once** via guarded updates: `... SET sla_at_risk = true ... WHERE sla_at_risk = false AND ...` and likewise for `sla_breached`. Snooze expiry clears `snoozed_until` only `WHERE snoozed_until <= now()`.
- **SLA at-risk vs breach** are computed from `sla_targets[severity_key]`: `sla_response_due_at`/`sla_resolution_due_at` are set on create/severity-change from `response_minutes`/`resolution_minutes`; the sweep sets `sla_at_risk` when `now() >= due - (due - started_at) * (1 - at_risk_pct/100)` and not yet breached, and `sla_breached` when `now() > due`. Both are surfaced in list/detail responses and covered by an integration test.

The sweep is thus **idempotent** (re-running a tick produces no duplicate escalations and no double-set flags). Registered once per (org,tenant) in `setup.ts seedDefaults` via `SchedulerService.register({ id: <deterministic uuid from a stable key>, name, scopeType:'tenant', organizationId, tenantId, scheduleType:'interval', scheduleValue:'60s', timezone:'UTC', targetType:'queue', targetQueue:'incidents-escalation-sweep', targetPayload:{ scope:{ tenantId, organizationId } }, sourceType:'module', sourceModule:'incidents', isEnabled: true })` (resolved only when `schedulerService` is registered — soft-optional).

### Commands & Events

- **Commands** (undoable unless noted; ids `incidents.<entity>.<action>`): `incident.create/update/delete`, `incident.acknowledge`, `incident.transition_status` (covers resolve/close/reopen with the required-fields gate), `incident.change_severity`, `incident.assign`, `incident.escalate`, `incident.snooze`, `incident.merge`, `incident.link`; `timeline_entry.add` (append-only, **not undoable**); `participant.add/update_role/remove`; `impact.add/update_status/remove`; `action_item.create/update/complete/delete`; `postmortem.create/update/publish`; config `severity.*`, `type.*`, `role.*`, `settings.update`.
- **Events** (declared in `events.ts` via `createModuleEvents`, `as const`; `module.entity.action`, **past tense**): `incidents.incident.created/updated/deleted/acknowledged/status_changed/severity_changed/assigned/escalated/snoozed/resolved/closed/reopened/merged/linked`; `incidents.timeline_entry.added`; `incidents.action_item.created/completed`; `incidents.postmortem.created/published`; `incidents.incident.customer_updated` (customer-facing — **renamed from the non-past-tense `customer_update`** so it stays convention-correct once FROZEN). `clientBroadcast: true` on created/updated/status_changed/severity_changed/assigned/acknowledged/escalated/resolved/timeline_entry.added (audience: tenant + owner/team/subscribers). `portalBroadcast: true` on `customer_updated`.
- **Aggregate consistency:** every sub-resource write (timeline/participant/impact/action-item/postmortem command) MUST bump the **parent incident's `updated_at`** in the same transaction — so the command-level aggregate optimistic lock (below) and `clientBroadcast` realtime both reflect the change, and a concurrent editor of the parent gets a correct 409.
- **Portal audience resolution (verified):** the portal event bridge (`customer_accounts/api/portal/events/stream.ts` `matchesAudience`) filters by `tenantId` → optional `organizationId(s)` → optional `recipientUserId(s)` — there is **no account/customer filter**. So `customer_updated` MUST be emitted with `tenantId` + `recipientUserIds: string[]`, resolved from the impacted company/person: query `CustomerUser` (table `customer_users`) by `customerEntityId`/`personEntityId` (tenant-scoped, `deletedAt: null`) → their `.id`s. Payload is **minimal** (incident number, current status, customer-facing message only — never internal notes/PII). Omitting `recipientUserIds` would broadcast to every portal user on the tenant/org — a data-leak, so it is required.

### Cross-module coupling (verify inbound event IDs at implementation)

| Peer | Mechanism | Phase |
|---|---|---|
| `notifications` | Emit notification events to owner/team/subscribers/mentions; renderers in `notifications.client.ts`; reactive `notifications.handlers.ts` (idempotent, `features`-gated). Soft. | P2 |
| `attachments` | Evidence on incidents/notes. Soft. | P2 |
| `messages` | Internal threaded collaboration + @-mentions (distinct from notes/ChatOps); mention → notify. Soft. | P2 |
| `customers`/`sales`/`customer_accounts` | Impact links via FK-id + snapshot; revenue rollup; live PII re-fetch via enricher. Soft. | P3 |
| `customers`/`sales` (their pages) | UMES: `_incidents` enricher (`enrichMany`, `features`-gated, `timeout`/`fallback`) + widget injection (account "Incidents" tab/widget; order "affected by incident" banner). | P3 |
| `scheduler` + `queue` | Escalation/SLA/snooze sweep. | P4 |
| `portal` | `frontend/[orgSlug]/portal/incidents` (account-scoped, read-only) + portal event bridge. Soft. | P6 |
| `perspectives` | Saved/filtered incident views (DataTable-native). | P6 |
| `dashboards` | Register MTTA/MTTR/active-incident widgets with `analyticsRegistry`. | P6 |
| inbound events | `subscribers/auto-incident-*.ts` subscribe to **candidate** trigger events (`data_sync.run.failed`, `payment_gateways.payment.failed`/`webhook.failed`, `communication_channels.message.delivery_failed`/`channel.disconnected`, `integrations.state.updated`, workflow failure, `messages.message.email_failed`, `customers.deal.lost` — **each id verified against the source module's `events.ts` at P6; any that does not exist verbatim is replaced with the real declared id, never left as a silent no-op**), gated by `incident_settings.auto_incident_triggers`. **Idempotency mechanism (explicit):** the subscriber computes a deterministic `source_event_ref = <eventId>:<sourceEntityId>` and creates the incident only if no non-deleted incident with that `source_event_ref` exists for the (org,tenant) — enforced by the `incident.source_event_ref` partial-unique so redelivery/retries create at most one incident. | P6 |
| `workflows` / `business_rules` | Should-have (P7/follow-up): incident events trigger workflow definitions; rules gate severity/escalation. Soft. | P7 |
| `planner` / `staff` | Read availability / team membership for owner-on-duty; `allowUnregistered`. Should-have. | P7 |
| `communication_channels` | ChatOps lifecycle posting; emit events, channel module subscribes. Should-have. | P7 |

**Anti-patterns (forbidden):** cross-module ORM relations; importing peer entity classes; subscribing to workflow internals; direct payment/integration API calls; emitting incident events from other modules.

## Data Models

All tenant/org-scoped, UUID PKs (`gen_random_uuid()`), `created_at`/`updated_at`/`deleted_at`; **`updated_at` returned in list/detail responses** for optimistic locking on editable entities. Mirror `customers/data/entities.ts` decorator/import style — the repo is **MikroORM v7**: decorators from `@mikro-orm/decorators/legacy`, `Collection`/`OptionalProps` from `@mikro-orm/core` (verified against the reference; the earlier "6.6" note was stale). `bigint` columns map to `string` in TS. Money as BigInt minor units. Entity ids `E.incidents.<entity>`.

### incident (`incidents`)
- `id`, `organization_id`, `tenant_id`
- `number` (string, unique per org+tenant), `title`, `description` (text)
- `incident_type_id` (uuid, FK-id → incident_type, nullable), `severity_id` (uuid, FK-id → incident_severity), `priority` (string nullable)
- `status` (string enum: open/investigating/identified/mitigated/resolved/closed)
- `visibility` (string: internal/restricted)
- `is_drill` (bool, default false), `is_major` (bool, default false)
- `owner_user_id` (uuid nullable), `owning_team_id` (uuid nullable, FK-id), `reporter_user_id` (uuid)
- `detected_at`, `acknowledged_at`, `started_at`, `resolved_at`, `closed_at` (Date nullable)
- `escalation_level` (int default 0), `next_escalation_at` (Date nullable), `snoozed_until` (Date nullable)
- `sla_response_due_at`, `sla_resolution_due_at` (Date nullable), `sla_at_risk` (bool default false), `sla_breached` (bool default false)
- `merged_into_incident_id` (uuid nullable, FK-id → incident; set when this incident is merged into another — the surviving target)
- `source_event_ref` (string nullable; idempotency key for auto-created incidents — **partial-unique per (org,tenant) where not null**; format `<eventId>:<sourceEntityId>`)
- `customer_impact_summary` (text, **encrypted**)
- `created_at`, `updated_at`, `deleted_at`

> **Dropped from v1** (was speculative over-engineering for the P7-deferred `workflows` integration): `workflow_instance_id`. It is added **additively** when the `workflows` coupling ships — not carried as a frozen unused column in v1.

### incident_timeline_entry (`incident_timeline_entries`) — append-only/immutable (no `updated_at`/`deleted_at`)
- `id`, `organization_id`, `tenant_id`, `incident_id`
- `kind` (string: status_change/severity_change/assignment/role_change/note/update/action/ack/escalation/impact_change/merge/system)
- `actor_user_id` (uuid nullable; null = system)
- `body` (text, **encrypted**), `visibility` (string: internal/customer_facing)
- `metadata` (jsonb nullable: from/to values), `created_at`

### incident_participant (`incident_participants`)
- `id`, `organization_id`, `tenant_id`, `incident_id`, `user_id`
- `kind` (string: responder/subscriber), `role_id` (uuid nullable, FK-id → incident_role)
- `created_at`, `updated_at`, `deleted_at` — partial-unique `(incident_id, user_id, kind)` where `deleted_at is null`

### incident_impact (`incident_impacts`) — polymorphic (per-kind optimistic-lock reader override; see `customers/di.ts` precedent)
- `id`, `organization_id`, `tenant_id`, `incident_id`
- `target_type` (string: `customer_person`/`customer_company`/`customer_account`/`sales_order`/`sales_quote`/`sales_invoice`/`sales_credit_memo`/`component`) — **there is no unified `sales_document` entity** (verified: `SalesDocumentKind` is a TS union of per-kind tables `sales_orders`/`sales_quotes`/`sales_invoices`/`sales_credit_memos`); link the specific kind, never a fictional `sales_document`.
- `target_id` (uuid nullable), `component_label` (string nullable; for component)
- `impact_status` (string: operational/degraded/partial_outage/major_outage)
- `snapshot` (jsonb — display + metrics only: `{ label, status?, tier? }`; **no PII** — `label` MUST be a non-PII display value: order number, account/company **business** name is acceptable, never a person's name/email; live PII re-fetched via enricher)
- `revenue_amount_minor` (bigint nullable), `revenue_currency` (string nullable)
- `created_at`, `updated_at`, `deleted_at`
- **Partial-unique** `(incident_id, target_type, coalesce(target_id::text, component_label))` where `deleted_at is null` — prevents duplicate impact rows for the same target (which would double-count the revenue rollup).

### incident_action_item (`incident_action_items`)
- `id`, `organization_id`, `tenant_id`, `incident_id`, `title`, `description` (text nullable)
- `assignee_user_id` (uuid nullable), `status` (string: open/in_progress/done/cancelled)
- `due_at`, `completed_at` (Date nullable), `external_ref` (string nullable)
- `created_at`, `updated_at`, `deleted_at`

### incident_postmortem (`incident_postmortems`)
- `id`, `organization_id`, `tenant_id`, `incident_id` (unique)
- `summary`, `root_cause`, `impact`, `contributing_factors`, `lessons` (text, **encrypted**)
- `status` (string: draft/published), `published_at` (Date nullable)
- `created_at`, `updated_at`, `deleted_at`
- **required-fields-on-resolve gate** reads/writes here: the type's `required_fields_on_resolve` keys (e.g. `root_cause`) are validated against this row on resolve/close; the resolve action auto-creates a `draft` postmortem (if absent) from its `fields` payload, then blocks (400) when any required field is still empty. See API § transition.

### incident_link (`incident_links`) — non-destructive related/duplicate associations (distinct from merge, which uses `incident.merged_into_incident_id`)
- `id`, `organization_id`, `tenant_id`, `incident_id`, `linked_incident_id`
- `kind` (string: related/duplicate/caused_by)
- `created_at`, `deleted_at` — partial-unique `(incident_id, linked_incident_id, kind)` where `deleted_at is null`; both incidents scoped to the same (org,tenant).

### Config catalogs (module-owned; seeded idempotently in `setup.ts`)
- **incident_severity** (`incident_severities`): `key`, `label`, `rank` (int), `color_token` (DS status token name, e.g. `error`/`warning`/`info`), `is_default`, `is_active`. Seed: sev1/critical→error, sev2/high→warning, sev3/medium→info, sev4/low→neutral.
- **incident_type** (`incident_types`): `key`, `label`, `default_severity_id` (nullable), `default_role_ids` (jsonb nullable), `required_fields_on_resolve` (jsonb, e.g. `["root_cause"]`), `is_default`, `is_active`. Seed: operational, customer_impacting, security, maintenance.
- **incident_role** (`incident_roles`): `key`, `label`, `is_active`. Seed: commander, comms_lead, scribe, responder.
- **incident_settings** (`incident_settings`, one row per org+tenant): `number_format` (default `INC-{yyyy}{mm}{dd}-{seq:4}`), `ack_timeout_minutes`, `escalation_timeout_minutes`, `escalation_chain` (jsonb — **structure**: `[{ level: number, targets: Array<{ type: 'user'|'team'|'role', id: string }> }]`), `sla_targets` (jsonb — **structure**: `{ [severity_key]: { response_minutes: number, resolution_minutes: number, at_risk_pct: number /* default 80 */ } }`), `auto_incident_triggers` (jsonb: `{ [eventId]: { enabled: boolean, severity_key: string, type_key: string } }`).
  - **Removed from v1**: `business_hours` — it is dead code in v1 (24/7 only) and belongs with the enterprise advanced-SLA / business-hours-calendar engine; added there, not carried as a frozen unused v1 field.
- **incident_number_sequence** (`incident_number_sequences`): `current_value` (bigint), unique `(organization_id, tenant_id)`.

## API Contracts

All routes export per-method `metadata` (`requireAuth` + `requireFeatures`) and `openApi`; inputs Zod-validated (`z.infer`, no `any`); writes dispatch registered commands; reads via QueryEngine; HTTP via the route layer. Custom (non-factory) mutating routes run the mutation-guard registry and enforce command-level optimistic locking.

### CRUD (`makeCrudRoute`) — `incident`
- `GET /api/incidents` — list (filters: status, severity, owner, team, customer, type, date range, `active`, `exclude_drills`; `?ids=`; pagination ≤100). Returns `updated_at`.
- `POST /api/incidents` → `incidents.incident.create` (allocates `number` via `IncidentNumberGenerator`).
- `GET /api/incidents/[id]` — detail (includes participants, impacts, action items, postmortem ref, `updated_at`).
- `PUT /api/incidents/[id]` → `incidents.incident.update` (optimistic-locked).
- `DELETE /api/incidents/[id]` → `incidents.incident.delete` (soft delete).

### Action endpoints (command-style; **command-level optimistic lock on the parent incident aggregate**)
- `POST /api/incidents/[id]/acknowledge` → `acknowledge` (sets `acknowledged_at`, stops ack-timeout escalation).
- `POST /api/incidents/[id]/transition` `{ status, fields? }` → `transition_status`. Validates the allowed transition graph server-side. **Required-fields-on-resolve gate:** on `resolved`/`closed`, reads the incident type's `required_fields_on_resolve` (e.g. `["root_cause"]`); the `fields` payload supplies those values, which are written into a `draft` `incident_postmortem` (auto-created if absent); the transition is **rejected 400** (`createCrudFormError` with per-field errors) if any required field is empty. Sets `resolved_at`/`closed_at`.
  - **Resolve cascade:** clear per-component impact statuses to `operational`, cancel escalation (`next_escalation_at = null`) and snooze (`snoozed_until = null`).
  - **Close cascade (superset of resolve):** everything resolve does, **plus** mark responder/subscriber participations closed and stop all timers; a closed incident is immutable except via `reopen` (which clears `resolved_at`/`closed_at`, restores `open`/`investigating`, and appends a `reopen` timeline entry preserving prior context).
- `POST /api/incidents/[id]/severity` `{ severityId }` → `change_severity` (recomputes SLA dues).
- `POST /api/incidents/[id]/assign` `{ ownerUserId?, owningTeamId? }` → `assign`.
- `POST /api/incidents/[id]/escalate` → `escalate` (manual; same path the sweep uses).
- `POST /api/incidents/[id]/snooze` `{ until }` → `snooze`.
- `POST /api/incidents/[id]/merge` `{ targetId }` → `merge`. **Semantics:** merging source `[id]` into `targetId` sets `source.merged_into_incident_id = targetId` and `source.status = 'closed'` (the source **retains its own number** — numbers are never reused); copies the source's still-active `incident_impact` and open `incident_action_item` rows onto the target (de-duplicated by the impact partial-unique); appends a `merge` timeline entry to **both** incidents; the source becomes read-only (further writes rejected 409/`[internal] merged`). Guarded by command-level optimistic lock on **both** aggregates.
- `POST /api/incidents/[id]/link` `{ targetId, kind }` → `link` (non-destructive) — inserts an `incident_link` row (`kind` ∈ related/duplicate/caused_by), idempotent on the partial-unique; appends a `linked` timeline entry.
- `POST /api/incidents/bulk` `{ action: 'close'|'assign'|'change_severity'|'subscribe', ids: string[], params }` → **202** + `{ progressJobId }`. Enqueues a `ProgressJob` + worker (`incidents.incident.bulk_*`) that applies the per-id command with per-id error isolation (one failure does not abort the batch); `requireFeatures` matches the underlying action (e.g. `incidents.incident.close`).
- `POST /api/incidents/[id]/timeline` `{ kind, body, visibility }` → `timeline_entry.add`.
- `GET /api/incidents/[id]/timeline` — list entries (visibility-filtered by feature).
- `POST|PUT|DELETE /api/incidents/[id]/participants[/[pid]]` → participant commands.
- `POST|PUT|DELETE /api/incidents/[id]/impacts[/[iid]]` → impact commands (PUT sets `impact_status`).
- `POST|PUT|DELETE /api/incidents/[id]/action-items[/[aid]]`; `POST .../action-items/[aid]/complete`.
- `POST|PUT /api/incidents/[id]/postmortem`; `POST .../postmortem/publish`.

### Config (`makeCrudRoute`, `incidents.settings.manage`)
- `/api/incidents/severities`, `/api/incidents/types`, `/api/incidents/roles`, `/api/incidents/settings`.

### Portal (P6)
- `GET /api/incidents/portal` — incidents affecting the authenticated customer's account (server-derived scope from `customer_accounts`; `requireCustomerFeatures: ['portal.incidents.view']`). Returns only customer-facing fields/updates.

## Internationalization (i18n)

All strings via `useT()` / `resolveTranslations()` in en/de/es/pl. Namespace `incidents.*`: `nav.*`, `incident.{form,fields,status,severity,actions}.*`, `timeline.*`, `participants.*`, `impact.*`, `postmortem.*`, `settings.*`, `notifications.*`, `portal.*`. Internal-only `throw`/`toast` messages prefixed `[internal]`. Run `yarn i18n:check-hardcoded`.

## UI/UX

> DS mandatory (`.ai/ds-rules.md`, `.ai/ui-components.md`): semantic status tokens only (severity→status: critical→`error`, high→`warning`, medium→`info`, low→neutral; resolved/closed→`success`) — **no `text-red-*`/`bg-green-*`**, no arbitrary sizes, no inline `<svg>` (lucide-react with `aria-label`), shared primitives (`StatusBadge`, `Alert`, `FormField`, `SectionHeader`, `EmptyState`, `LoadingMessage`/`Spinner`, `RecordNotFoundState`, `ErrorMessage`). Dialogs: `Cmd/Ctrl+Enter` submit, `Escape` cancel. `pageSize ≤ 100`.

1. **List** `/backend/incidents` — `DataTable` (`tableId/entityId` `incidents.list`, `extensionTableId`): number, title, severity badge, status, owner, team, affected-customers count, revenue-at-risk, age, updated. Filters as above; saved views via `perspectives`; **bulk actions** (close/assign/severity/subscribe) via DataTable bulk + `ProgressJob` (`incidents.incident.bulk_*`). Stable `RowActions` ids (`open`/`edit`/`delete`).
2. **War-room detail** `/backend/incidents/[id]` — composite page (own tabs/sections composed directly; not a CrudForm). Distinct loading / not-found (`RecordNotFoundState`) / error states. Real-time via `useAppEvent('incidents.*', …)`.
   - **Status header:** number + title, severity badge, status pill, owner, age + SLA/escalation timers; actions: **Acknowledge**, Change status / Resolve / Close, Escalate, Declare major, Snooze, Reopen (icon buttons with `aria-label`). Writes via `useGuardedMutation` + `surfaceRecordConflict`.
   - **Main — timeline:** chronological entries; composer with **internal-note vs customer-facing-update** toggle, @-mentions (`messages`), attachments.
   - **Sidebar:** responders & roles, subscribers, severity/priority, type, owning team, custom fields.
   - **Impact panel:** affected customers (link to CRM) with **revenue/ARR rollup**, affected orders/sales-docs, components with per-component impact status.
   - **Action items panel** + **Postmortem section** (post-resolution; required-fields gate).
   - Injection spots exposed: `detail:incidents.incident:header|tabs|sidebar|timeline-actions`, `crud-form:incidents.incident:fields`.
3. **Create** `/backend/incidents/create` — `CrudForm`: title, type, severity, description, owner, team, affected customers/orders (async selects hydrated as value+options), customer-impact summary. `createCrud`/`createCrudFormError`; conflict via `surfaceRecordConflict`.
4. **Settings** `/backend/incidents/settings` — severity scale, types, roles, SLA targets, ack/escalation timeouts + chain, auto-incident triggers. `incidents.settings.manage`.
5. **Cross-module injections** — CRM customer detail "Incidents" tab/widget (enricher `_incidents` + injection); order/sales-doc "affected by incident" banner; dashboards active-incidents + MTTA/MTTR widgets; in-app notifications.
6. **Portal** `frontend/[orgSlug]/portal/incidents` — `requireCustomerAuth` + `requireCustomerFeatures: ['portal.incidents.view']`; account-scoped read-only list/detail showing customer-facing updates only; live via portal event bridge.

## Configuration

- No new env vars required. Optimistic locking honors `OM_OPTIMISTIC_LOCK`. Search honors `OM_SEARCH_ENABLED`. Sweep cadence is a module constant (default 60s) overridable per-tenant via `incident_settings`.

## Encryption & GDPR

`incidents/encryption.ts` exports `defaultEncryptionMaps` for: `incident.customer_impact_summary`; `incident_timeline_entry.body`; `incident_postmortem.summary/root_cause/impact/contributing_factors/lessons`. All reads via `findWithDecryption`/`findOneWithDecryption` (5-arg) with `{ tenantId, organizationId }`. No equality lookups on encrypted columns (no hash fields needed). Impact `snapshot` deliberately excludes PII (person names/emails re-fetched live), avoiding the jsonb-encryption footgun. No hand-rolled crypto.

> **Encryption-scope decision (explicit, per cross-model review).** `incident.title`/`incident.description` and `incident_action_item.title/description` are **operational, internal-only text** (systems/services/remediation, RBAC-gated to `incidents.*`) and are **deliberately NOT encrypted** so they remain fulltext/vector **searchable** (`search.ts` indexes `title`/`description`). Encrypting them would defeat search and they are not the PII surface. **All customer/person PII belongs in the encrypted fields** (`customer_impact_summary`, timeline `body`, postmortem free-text) — the composer/UX and validators steer PII there. The impact `snapshot.label` MUST be a non-PII display value (order number / business account name / component name), enforced by review + a test asserting the snapshot never persists an email/person-name.

## Search

`incidents/search.ts`: tokens + fulltext + vector over `incident` — index `number`, `title`, `description`, status, severity label; impact/customer notes `hashOnly`; no secrets. Tokens entity has `formatResult` (→ `/backend/incidents/<id>`); vector `buildSource` paired with `checksumSource`.

## Access Control & Setup

`acl.ts` features (`<module>.<entity>.<action>`, immutable): `incidents.incident.view/create/manage/assign/close/escalate`, `incidents.postmortem.view/manage`, `incidents.settings.manage`; portal: `portal.incidents.view`. `setup.ts`:
- `defaultRoleFeatures`: `admin: ['incidents.*']`; `employee: ['incidents.incident.view','...create','...manage','...assign','...escalate','incidents.postmortem.view','incidents.postmortem.manage']`; customer role grant `portal.incidents.view`.
- `seedDefaults` (idempotent, check-before-insert): severity/type/role catalogs, `incident_settings` row, and register the escalation-sweep schedule via `SchedulerService.register()`.
- After implementation: `yarn mercato auth sync-role-acls`.

## Migration & Backward Compatibility

Greenfield — **no existing surface is broken** (all additive). Everything introduced becomes a FROZEN/STABLE contract surface on release (ARCHITECTURE §27), so it must be right the first time:

| Surface | New value | Class |
|---|---|---|
| Module id | `incidents` | FROZEN |
| Event IDs | `incidents.*` | FROZEN |
| Widget spot IDs | `detail:incidents.incident:*`, `crud-form:incidents.incident:fields` | STABLE (public) |
| API routes | `/api/incidents/*` | STABLE |
| DB schema / entity ids | `incident*` tables, `E.incidents.*` | FROZEN |
| ACL feature ids | `incidents.*`, `portal.incidents.view` | FROZEN (DB-stored) |
| Notification type ids | `incidents.*` | FROZEN |
| DI keys | `incidentNumberGenerator`, optimistic-lock readers | STABLE |
| Enriched field namespace | `_incidents` on customers/sales responses | STABLE (contract) |
| Custom-entity id | `incidents:incident` (`ce.ts`) | STABLE |

**Inbound dependency:** auto-incident subscribers rely on peer event IDs being exactly correct (a wrong id = silent no-op). Implementation MUST verify each trigger event against the source module's `events.ts`. Migrations via `yarn db:generate` (review SQL + snapshot, commit both). Deployable without downtime; new tables only; no backfill.

## Implementation Plan

> One lean commit per step; run `yarn generate` after discovery-file changes; `yarn db:generate` after entity changes. Each phase ends green (typecheck/lint/test + its integration tests).

### Phase 1 — Foundation (entity + CRUD + catalogs + numbering)
- [x] Scaffold module (`index.ts`, `di.ts`, `acl.ts`, `setup.ts`, `ce.ts`, `events.ts`, `search.ts`, `translations.ts`, `encryption.ts`, i18n en/de/es/pl).
- [x] Entities: `incident` + config catalogs (`incident_severity/type/role/settings`, `incident_number_sequence`). `yarn db:generate` (+snapshot).
- [x] `IncidentNumberGenerator` service (atomic upsert) + DI registration + optimistic-lock reader for `incident`.
- [x] Zod validators; `commands/incident.ts` (create/update/delete, undoable); `makeCrudRoute` for `/api/incidents` (+`openApi`); config CRUD routes.
- [x] `setup.ts` seeds catalogs + settings (idempotent); `defaultRoleFeatures`; `search.ts`.
- [x] List page (`DataTable`) + create form (`CrudForm`) + minimal detail + `page.meta.ts`.
- [x] **Tests:** CRUD happy/validation, RBAC 403, tenant isolation, optimistic-lock 409, **number-sequence concurrency** (parallel creates → unique numbers), settings/catalog CRUD.

### Phase 2 — Timeline, participants, roles, notifications
- [x] `incident_timeline_entry` (immutable) + `incident_participant`; commands (`timeline_entry.add`, participant add/update_role/remove); action endpoints with **command-level optimistic lock on the incident aggregate**.
- [x] Acknowledge + transition_status + change_severity + assign commands/endpoints (transitions validated; timestamps).
- [x] War-room detail page composition (header + timeline + sidebar); internal/customer-facing composer; attachments (soft-optional); @-mentions via `messages` (soft-optional).
- [x] `notifications.ts`/`.client.ts`/`.handlers.ts`: notify owner/team/subscribers/mentions on key transitions (idempotent, `features`-gated, de-dup + actor-suppression).
- [x] **Tests:** ACK sets `acknowledged_at`; transition gate; concurrent timeline/assign → 409; notification fan-out de-dup; visibility filtering.

### Phase 3 — Customer/order impact + revenue rollup + CRM/sales surfacing
- [x] `incident_impact` (polymorphic) + per-kind optimistic-lock override; commands (add/update_status/remove); revenue rollup from stored metrics.
- [x] Lightweight component impact entries; cascade-on-resolve clears component statuses.
- [x] `data/enrichers.ts` `_incidents` (enrichMany, `features`-gated, timeout/fallback) on customers (person/company/account) + sales order responses; widget injection (account tab; order banner).
- [x] **Tests:** impact add/link; revenue rollup; enricher (no N+1, fallback on timeout); injection renders; cascade clears on resolve.

### Phase 4 — Escalation, ACK timeout, SLA, snooze (scheduler sweep)
- [x] `workers/escalation-sweep.ts` (queue `incidents-escalation-sweep`); register schedule in `setup.ts`.
- [x] Escalation chain + `next_escalation_at`/`escalation_level`; SLA dues + at-risk/breach flags; snooze + expiry; (overdue-action reminders).
- [x] List/detail SLA at-risk/breached indicators.
- [x] **Tests:** sweep idempotency (double-tick no dup), ack-timeout escalation fires, snooze suppresses then expires, SLA breach set-once, scope isolation (one tenant's sweep never touches another).

### Phase 5 — Postmortems, action items, merge/link, reopen, required-on-resolve
- [x] `incident_postmortem` + `incident_action_item`; commands; required-fields-on-resolve gate; merge/link + reopen.
- [x] Postmortem section + action-items panel + centralized postmortem list.
- [x] **Tests:** required-fields blocks resolve; action item lifecycle; merge sets relation + timeline; reopen preserves context.

### Phase 6 — Portal visibility, bulk ops, perspectives, auto-incident, dashboards
- [x] Portal `frontend/[orgSlug]/portal/incidents` (`requireCustomerAuth`/`requireCustomerFeatures`) + `portalBroadcast` `customer_update`; `GET /api/incidents/portal`.
- [x] Bulk actions via `ProgressJob` + worker; perspectives saved views.
- [x] `subscribers/auto-incident-*.ts` (verified trigger events; toggle-gated; idempotent dedupe).
- [x] `dashboards` widgets (active/MTTA/MTTR via analyticsRegistry).
- [x] **Tests:** portal scope (customer sees only own-account, customer-facing fields only, cross-account 403); bulk progress; auto-incident creates once per source event; dashboard widget data.

### Deferred (OSS should-have follow-up, not v1): Phase 7 — `workflows`/`business_rules` automation, `communication_channels` ChatOps, `planner` owner-on-duty. **Enterprise (separate spec):** status pages, advanced SLA, AI postmortems, complex on-call/paging, AIOps, config-as-code, SSO/SCIM, MSP analytics.

### File Manifest (abridged)
| File | Action | Purpose |
|---|---|---|
| `packages/core/src/modules/incidents/{index,di,acl,setup,ce,events,search,encryption,translations}.ts` | Create | Module wiring |
| `…/data/{entities,validators,extensions,enrichers}.ts` | Create | Entities, Zod, links, `_incidents` enricher |
| `…/services/incidentNumberGenerator.ts` | Create | Atomic per-tenant numbering |
| `…/commands/*.ts` (+`index.ts` barrel) | Create | Undoable mutations |
| `…/api/**/route.ts` + `api/openapi.ts` | Create | CRUD + action + portal routes |
| `…/backend/incidents/{page.tsx,page.meta.ts,create/page.tsx,[id]/page.tsx,settings/page.tsx}` | Create | Backoffice UI |
| `…/frontend/[orgSlug]/portal/incidents/{page.tsx,page.meta.ts}` | Create | Portal view |
| `…/workers/escalation-sweep.ts`, `…/subscribers/auto-incident-*.ts` | Create | Sweep + auto-incident |
| `…/widgets/{injection,injection-table.ts}` | Create | CRM/sales injection |
| `…/notifications{,.client,.handlers}.ts`, `…/i18n/{en,de,es,pl}.json` | Create | Notifications + i18n |
| `…/migrations/*` + `.snapshot-open-mercato.json` | Create | Schema |

## Integration Test Coverage

Self-contained (API fixtures created in setup, cleaned in teardown; no seeded-data reliance; policy-compliant passwords; randomized unique codes). Workers=1 where undo/round-trip is asserted.

**API paths:** incidents CRUD (happy/validation/RBAC/tenant-isolation/optimistic-lock 409/`?ids=`); number-sequence concurrency (parallel creates → unique numbers); every action endpoint (acknowledge, transition incl. **required-fields-on-resolve 400 gate** + resolve cascade + **close cascade** + reopen-preserves-context, severity, assign, escalate, snooze, **merge** [source closed, number retained, impacts/action-items moved, both timelines get a merge entry, source read-only 409] and **link** [idempotent on partial-unique]); timeline add + visibility filtering + aggregate 409 (**sub-resource write bumps parent `updated_at`**); participants/impacts (**duplicate-target rejected by partial-unique**) /action-items/postmortem CRUD; config CRUD; escalation sweep (**double-tick idempotency via atomic conditional UPDATE**, ack-timeout escalation fires, snooze suppresses then expires, **SLA at-risk set-once then breach set-once**, scope isolation one-tenant-never-touches-another); auto-incident subscriber (**creates once per `source_event_ref` under redelivery**, toggle-gated); enricher (`_incidents`, no N+1, fallback on timeout); portal API (own-account-only, customer-facing-only, cross-account 403); bulk endpoint (202 + progress, per-id error isolation).
**UI paths:** create incident; war-room ACK + transition + resolve-with-required-fields; add internal vs customer-facing update; add impact + revenue rollup; bulk action (progress); CRM account incidents widget; portal account view.

## Risks & Impact Review

### Data Integrity Failures
- Concurrent responder writes on one incident → resolved by command-level optimistic locking on the aggregate; multi-field writes wrapped in `withAtomicFlush`. Parent-deleted-mid-write guarded by soft-delete + scoped `findOneOrFail`.

### Cascading Failures & Side Effects
- Subscriber failures are isolated (persistent, retried, idempotent); a failed notification never blocks the incident write. Auto-incident subscribers dedupe by source-event ref to prevent storms. Enrichers set `timeout`/`fallback` so a slow incidents lookup never breaks a customer/order page.

### Tenant & Data Isolation Risks
- Every query/row/event/index/cache key carries `tenant_id`(+`organization_id`); the sweep payload carries explicit scope and processes one (org,tenant) per tick. The number sequence is keyed per (org,tenant) — no cross-tenant counter. Portal scope is server-derived from `customer_accounts`, never client-supplied.

### Migration & Deployment Risks
- New tables only; no backfill; deployable without downtime; migration re-runnable. No breaking API changes (greenfield).

### Operational Risks
- Sweep cadence bounds escalation/SLA latency (≤ poll interval) — acceptable for v1; documented. Blast radius is module-isolated (peers soft-optional). Bulk ops run through `ProgressJob` (no event storms). Encrypted free-text columns bound PII exposure.

### Risk Register

#### Lost updates from concurrent responders
- **Scenario:** Two responders change status/owner/notes on the same live incident simultaneously.
- **Severity:** High
- **Affected area:** incident aggregate + sub-resources (timeline/participant/impact/action).
- **Mitigation:** command-level optimistic lock on the parent incident's `updated_at` (`enforceCommandOptimisticLock`); UI surfaces 409 via `surfaceRecordConflict`.
- **Residual:** A conflicting writer must retry; acceptable.

#### Duplicate incident numbers under concurrent creation
- **Scenario:** Parallel `create` calls race the sequence.
- **Severity:** High
- **Affected area:** `incident.number` uniqueness.
- **Mitigation:** atomic `INSERT … ON CONFLICT DO UPDATE … RETURNING` (lock-free); unique constraint on `number` per (org,tenant); avoids partial-unique-index pitfalls.
- **Residual:** None material.

#### Escalation/SLA never fires (no timer)
- **Scenario:** Reactive events alone leave unacked incidents un-escalated.
- **Severity:** High
- **Affected area:** escalation, SLA, snooze, reminders.
- **Mitigation:** scheduler-cron sweep worker; idempotent; per-tenant scope. Covered by sweep integration tests.
- **Residual:** Latency bounded by cadence.

#### Wrong inbound trigger event id → dead auto-incident subscriber
- **Scenario:** A subscriber listens to a misspelled/renamed peer event id and silently never fires.
- **Severity:** Medium
- **Affected area:** auto-incident creation.
- **Mitigation:** verify every trigger id against source `events.ts` at implementation; subscribers are toggle-gated and tested for the create-once behavior.
- **Residual:** Peer may later rename its event (separate BC concern on the peer).

#### Scope creep into a standalone SRE tool
- **Scenario:** On-call rotations / paging / status pages / AIOps creep into OSS core.
- **Severity:** High (architectural)
- **Affected area:** module boundary + edition split.
- **Mitigation:** hard OSS/enterprise line (this spec § Overview/Phasing); v1 reads availability from `planner` and delegates automation to `workflows`; builds no rotation/paging/status-page engine.
- **Residual:** None if review enforces the line.

#### PII leakage via impact snapshots or free text
- **Scenario:** Customer names/emails persisted unencrypted in snapshots or timeline.
- **Severity:** Medium
- **Affected area:** GDPR.
- **Mitigation:** snapshots store non-PII display/metrics only (PII re-fetched live); free-text columns declared in `encryption.ts` and read via `findWithDecryption`.
- **Residual:** None material.

## Final Compliance Report — 2026-06-30

### AGENTS.md Files Reviewed
- `AGENTS.md` (root), `ARCHITECTURE.md` (§4/§5/§7/§9/§11/§13/§14/§15/§16/§17/§20/§25/§27/§29/§31)
- `packages/core/AGENTS.md`, `packages/ui/AGENTS.md`, `packages/ui/src/backend/AGENTS.md`
- `packages/shared/AGENTS.md`, `packages/events/AGENTS.md`, `packages/queue/AGENTS.md`, `packages/search/AGENTS.md`, `packages/scheduler` (services), `packages/core/src/modules/{customers,sales,staff,planner,customer_accounts,portal,progress}/AGENTS.md`
- `BACKWARD_COMPATIBILITY.md`, `.ai/ds-rules.md`, `.ai/ui-components.md`, `.ai/lessons.md`

### Compliance Matrix
| Rule Source | Rule | Status | Notes |
|---|---|---|---|
| root AGENTS.md | No cross-module ORM relationships | Compliant | FK-id + snapshot + `data/extensions.ts` |
| root AGENTS.md | Filter by `organization_id`/`tenant_id` | Compliant | All entities/queries/sweep scoped |
| root AGENTS.md | Optimistic locking default-ON | Compliant | `updated_at` on editable entities; command-level lock on aggregate for action endpoints |
| ARCHITECTURE §4 | Module works enabled or disabled | Compliant | No hard business `requires`; peers soft-optional |
| ARCHITECTURE §7 | CRUD via `makeCrudRoute` + `indexer.entityType` + `list.entityId` | Compliant | Declared |
| ARCHITECTURE §9 | Non-factory writes run mutation guards + commands undoable | Compliant | Action endpoints use guard registry; commands `isUndoable` (timeline immutable, documented) |
| ARCHITECTURE §11 | Cross-module via UMES; compose own UI directly; new spot ids = contract | Compliant | Enrichers/injection for peers; war-room composed directly; spot ids listed in BC |
| ARCHITECTURE §13 | `clientBroadcast`/`portalBroadcast`; durable/bulk = `ProgressJob` | Compliant | Declared; bulk via progress |
| ARCHITECTURE §16 | Encrypted PII via `encryption.ts` + `findWithDecryption` | Compliant | Free-text maps; snapshots PII-free |
| ARCHITECTURE §25 | Enterprise scope isolated + flagged | Compliant | Enterprise features deferred to separate spec |
| packages/ui AGENTS.md | `CrudForm`/`DataTable`/`apiCall`/`useGuardedMutation`; no raw fetch/form | Compliant | Create uses CrudForm; war-room writes via guarded mutations |
| DS rules | Semantic tokens, scale, primitives, lucide icons | Compliant | Severity→status mapping; no raw colors/sizes |
| packages/scheduler | Module schedules via `SchedulerService.register` in setup | Compliant | Sweep registered idempotently |

### Internal Consistency Check
| Check | Status | Notes |
|---|---|---|
| Data models match API contracts | Pass | Entities ↔ routes aligned |
| API contracts match UI/UX | Pass | War-room actions ↔ action endpoints |
| Risks cover all write operations | Pass | CRUD + action endpoints + sweep + auto-incident |
| Commands defined for all mutations | Pass | Listed; timeline append-only documented as non-undoable |
| Realtime/portal coverage | Pass | client/portal broadcast declared |

### Non-Compliant Items
- None blocking. **Implementation-time verifications (not spec gaps):** confirm MikroORM 6.6 decorator imports against `customers/data/entities.ts`; verify exact `SchedulerService.register` and `IncidentNumberGenerator` shapes against `communication_channels/setup.ts` and `sales/services/salesDocumentNumberGenerator.ts`; verify every inbound trigger event id against the source module's `events.ts`; confirm portal feature-guard wiring against `customer_accounts`/`portal`.

### Verdict
- **Fully compliant** — approved for implementation (resolve the implementation-time verifications during P1–P6 as noted).

## v2 Elevation — Escalation Policies + Deepened CRM/Sales (2026-07-01)

> **Why v2.** User feedback on the shipped P1–P2: the module is "functional but simplistic," escalation is unintuitive ("possibility of multiple escalations and it's not clear what happens when a ticket gets escalated"), and it "isn't well integrated with the rest of the modules." Root causes (verified in code): `escalate` only increments a **bare `escalation_level` counter** with no chain lookup, no targeting, no notification, no cap, and no visible meaning; the escalation-sweep worker was never built; and Phases 3–6 (impact/revenue, notifications, portal, dashboards, auto-incident) are unbuilt. This section elevates escalation to a **named escalation-policy model** (the incident.io/PagerDuty pattern, minus the on-call rotation engine) and makes the **CRM/sales impact + revenue-at-risk** integration best-in-class — the differentiator a standalone SRE tool structurally cannot match (it only holds a lagging, manually-synced projection of customer/order/revenue data; an embedded module reads the live source of truth). User-chosen scope: **finish + elevate all remaining phases**; escalation via **policies (no on-call engine)**; deepest investment in **CRM/sales impact + revenue**; keep the **OSS/enterprise line strict** (no public status pages, no rotations, no paging, no AIOps, no advanced-SLA calendars in core).

### v2.1 Escalation policy model (supersedes `incident_settings.escalation_chain` + the bare counter)

**Concepts (research-grounded: PagerDuty "escalation policy → rules/levels + escalates-after-N-min"; incident.io "escalation path → levels + wait + who-will-be-paged preview"; Grafana/Rootly step+delay; the universal *ack halts escalation* mechanic).** OSS-lean adaptation: policies target **users/teams/roles** directly (no rotation engine); a `role`/`team` target optionally resolves to a currently-available person via `planner` (soft-optional) — absent planner, it notifies all members. This delivers ~90% of the escalation clarity without an on-call scheduler (PagerDuty/incident.io both accept plain user targets and still provide levels, timers, ack-stops-timer, and manual escalate).

**New entity — `incident_escalation_policy` (`incident_escalation_policies`)** — a 5th module-owned config catalog (mirrors `incident_severity`/`type`/`role`):
- `id`, `organization_id`, `tenant_id`
- `key` (string), `name` (string), `is_default` (bool), `is_active` (bool)
- `steps` (jsonb): `[{ delay_minutes: number /* REQUIRED per step, runtime-authoritative */, targets: Array<{ type: 'user'|'team'|'role', id: string }>, notify_strategy: 'all' /* v1: notify ALL targets in the step; 'round_robin' deferred (rotation-adjacent, needs a cursor — out of OSS-lean v1 scope) */ }]` — **ordered; the array index is the authoritative step number** (no separate `level` field — it would drift on reorder). Step 0 fires on escalation start; each subsequent step fires `delay_minutes` after the previous if still unacknowledged. Validation (rejected 400) requires `steps.length >= 1`, every step `delay_minutes >= 0` and `targets.length >= 1`; an `is_active`, non-deleted default policy must exist.
- `repeat_count` (int, default 0) — after the last step, loop from step 0 up to `repeat_count` times before exhaustion.
- `created_at`, `updated_at`, `deleted_at` — partial-unique `(organization_id, tenant_id, key)` where `deleted_at is null`.

**`incident_type` gains** `default_escalation_policy_id` (uuid nullable, FK-id → policy) alongside the existing `default_severity_id`/`default_role_ids`.

**`incident` gains (v2 escalation state):**
- `escalation_policy_id` (uuid nullable, FK-id → incident_escalation_policy) — the active policy (resolved on create from type default → settings default).
- `escalation_status` (string enum: `inactive`/`active`/`acknowledged`/`exhausted`, default `inactive`) — the single field the UI and the set-once sweep guards key off.
- `escalation_level` (int, default 0) — **reinterpreted** as the current 0-based step index within the policy (no longer an unbounded free counter; bounded by `steps.length` × `(repeat_count+1)`).
- `escalation_repeats_done` (int, default 0).
- `next_escalation_at` (Date nullable) — when the sweep advances to the next step; **cleared on ack/resolve/close/snooze-start** (existing field).
- `escalation_last_targets` (jsonb nullable) — snapshot of the current level's paging, resolved at page-time so the UI/handlers don't re-resolve stale membership: `{ targets: [{ type, id, label }], recipients: [{ userId, label }], resolvedAt }` — `targets` are the abstract policy targets, `recipients` are the concrete users actually paged (a team/role target expands to its members via `planner`/membership at that instant). This lets the war-room render "Notified: **Platform Team** (Alice, Bob)" after the fact and lets async notification handlers page exactly `recipients` (see v2.6 idempotency).
- (existing, unchanged: `acknowledged_at`, `snoozed_until`, `sla_*`.)

> **Removed from v1 (pre-release, no BC):** `incident_settings.escalation_chain` (jsonb) — superseded by the named-policy entity. `incident_settings` keeps `ack_timeout_minutes`, `escalation_timeout_minutes` (**UI default only** — the value pre-filled for a new step's `delay_minutes` in the policy editor; it is **never** a runtime fallback, since every step carries its own required `delay_minutes`), `sla_targets`, `auto_incident_triggers`, and gains `default_escalation_policy_id` (uuid nullable).

**Lifecycle of escalation (the "what happens when escalated" answer, now explicit):**
1. **Start.** On `create` (declare), if a policy resolves and the incident is not auto-acknowledged: set `escalation_status='active'`, `escalation_level=0`, page step-0 targets immediately (emit `escalation_started` + notifications), snapshot `escalation_last_targets`, set `next_escalation_at = now + steps[0].delay_minutes` (the wait before step 1). Append an `escalation` timeline entry `{ trigger:'auto', to_level:0, targets, policy_key }`.
2. **Auto-advance (sweep).** While `escalation_status='active'` and `acknowledged_at IS NULL` and not snoozed and `status NOT IN (resolved,closed)`, when `next_escalation_at <= now`: advance to the next step (notify **additive** — prior responders stay, next step's targets are also paged), snapshot targets, append timeline, emit `escalated`, set `next_escalation_at` for the following step. If no next step: if repeats remain, loop to step 0 and increment `escalation_repeats_done`; else set `escalation_status='exhausted'`, clear `next_escalation_at`, emit `incidents.incident.escalation_exhausted` (notify owner/commander "escalation exhausted, still unacknowledged").
3. **Ack halts.** `acknowledge` sets `acknowledged_at` **and** `escalation_status='acknowledged'` + `next_escalation_at=null` (the universal mechanic — ack stops the clock). The war-room shows "Acknowledged by <user>". Escalation does not auto-resume in v1 (re-trigger deferred).
4. **Resolve/close** cascade already clears `next_escalation_at`/`snoozed_until`; v2 also sets `escalation_status='inactive'`.
5. **Snooze** clears `next_escalation_at` and pauses. **Resume rule (no new column needed):** on snooze expiry the sweep sets `next_escalation_at = snoozed_until + steps[escalation_level].delay_minutes` — i.e. the current pending step's timer restarts fresh from snooze-expiry. (Simpler and fully implementable; it does not attempt to preserve fractional elapsed time, which is acceptable for v1.)
6. **Policy changed mid-flight.** If `escalation_policy_id` is changed (via `assign`/update) while `escalation_status='active'`: **reset** — set `escalation_level=0`, `escalation_repeats_done=0`, re-page the new policy's step 0, re-snapshot `escalation_last_targets`, recompute `next_escalation_at`, and append an `escalation` timeline entry `{ trigger:'policy_changed', policy_key }`. If the incident is `acknowledged`/`exhausted`/`inactive`, changing the policy only swaps the id and does **not** re-activate escalation (no surprise re-paging). Clearing the policy to null sets `escalation_status='inactive'` and `next_escalation_at=null`.

**Manual escalate (PagerDuty "escalate to next level" semantics + incident.io preview):**
- `POST /api/incidents/[id]/escalate` — advances **one step now** (same code path as one sweep tick for this incident), keeping the automation running. Returns a **rich body**: `{ ok, incidentId, escalationLevel, escalationStepCount, escalationStatus, nextEscalationAt, pagedTargets: [{type,id,label}], updatedAt }` so the UI updates without a refetch. Bounded: escalating past the last step (repeats exhausted) returns `409 [internal] escalation_exhausted` rather than incrementing forever — **this is the fix for "multiple escalations" being unbounded/meaningless**.
- `GET /api/incidents/[id]/escalate/preview` — **the who-will-be-paged preview** (incident.io's standout intuitive pattern): resolves the *next* step's targets to concrete recipients + the notification message, returns `{ nextLevel, stepCount, targets: [{type,id,label}], recipients: [{userId,label}], willExhaust: boolean }`. The war-room confirm dialog renders "You're about to page **Engineering Managers** (Alice, Bob) — this is level 2 of 3" instead of a generic confirm.
- **Idempotency / double-click safety:** the advance is an **atomic conditional UPDATE** keyed on the expected current `escalation_level` (`... WHERE id=? AND escalation_level=? AND ...`), so a rapid double-submit advances at most one level per confirmed intent; the client also disables the button while pending.

**Sweep worker (Phase 4 — new `workers/escalation-sweep.ts`, queue `incidents-escalation-sweep`, `concurrency: 1` single-flight; the header-less-worker concurrency rules from § *Escalation sweep* still apply):** does auto-advance (above) via atomic conditional UPDATE, SLA at-risk/breach set-once, snooze-expiry resume, and overdue-action reminders. Registered per (org,tenant) in `setup.ts seedDefaults` via `SchedulerService.register()` (soft-optional). Target resolution (role/team → users) reads `planner` availability when present (soft-optional), else all members; resolution failures degrade to "notify owner + commander" and never crash the tick.

**Notifications (Phase 2 tail — now built, because escalation is meaningless without it).** `notifications.ts`/`.client.ts`/`.handlers.ts`: on `escalation_started`/`escalated`/`escalation_exhausted`, notify the step's resolved targets (idempotent, `features`-gated, actor-suppressed, de-duped); on `assigned`/`status_changed`/`severity_changed`/`acknowledged`, notify owner/team/subscribers/mentions. Notification type ids `incidents.*` (FROZEN on release).

**War-room escalation card (UI).** A dedicated **Escalation** panel (header/sidebar) with a live state line: `🔴 Escalating — Level 2 of 3` / `✅ Acknowledged by Jane` / `Not escalated` / `⚠️ Escalation exhausted — unacknowledged`; a "Notified: **Platform Team** (Alice on-call)" line from `escalation_last_targets`; a "Next escalation in 4m → **Engineering Managers**" countdown from `next_escalation_at` + preview; and buttons **Acknowledge** (stops escalation), **Escalate now** (opens the who-will-be-paged preview dialog), **Snooze**. Escalation timeline entries render inline as "Escalated to X (level N)". Severity→status DS tokens only; `useGuardedMutation` + `surfaceRecordConflict` on all writes. Real-time via `useAppEvent('incidents.incident.escalated'|'escalation_exhausted'|'acknowledged', …)`.

**Settings UI (`/backend/incidents/settings`, `incidents.settings.manage`).** Adds an **Escalation Policies** manager: list of named policies, each an ordered step editor (delay + user/team/role targets + strategy), `repeat_count`, `is_default`; and a per-type "default escalation policy" selector. Escalation-policy CRUD via `makeCrudRoute` at `/api/incidents/escalation-policies` (+ openApi), `incidents.settings.manage`.

**Correctness fix carried into v2:** the `acknowledge` route currently requires `incidents.incident.escalate` — change to `incidents.incident.manage` (ack is a respond action, not an escalation-config action).

### v2.2 CRM/sales impact + revenue-at-risk (the prioritized differentiator — best-in-class)

> Research: standalone tools (incident.io Catalog, ServiceNow CMDB) must **sync a shadow copy** of customer/service/revenue/contract data just to *approximate* impact features, and even then it's lagging, manually-tagged, and read-only. An embedded module inverts this — the customer graph, order ledger, contract tier, account ownership, portal, and messaging are **native, live, and writable**. The four highest-value, hardest-to-copy features are **(1) live affected-customer blast radius, (2) real revenue-at-risk, (3) contract-tier-driven priority/SLA suggestion, and (4) per-owner account-manager notification.** All via FK-id + snapshot + UMES enrichers + soft-optional DI — never cross-module ORM relations.

- **Impact links + panel (Phase 3).** `incident_impact` (entity exists) commands (`add`/`update_status`/`remove`) + war-room **Impact panel**: affected customers/accounts (link to CRM), affected orders/sales-docs, components with per-component status. Duplicate-target protected by the existing partial-unique (protects the rollup).
- **Revenue-at-risk rollup (snapshot + freshness, honest — not falsely "real-time").** The incident stores `revenue_amount_minor`/`revenue_currency` + `revenue_refreshed_at` per impact (snapshot metric, so list/rollup needs **no N+1 join**); the incident's **revenue-at-risk = Σ active impacts' metrics** (single-currency v1; multi-currency shown per-currency), surfaced with an "as of <refreshed_at>" stamp — **not** claimed as live. It is refreshed by three paths: (1) on `impact.add` (derive from `sales`/`customers` at link time, soft-optional); (2) the manual **`POST /api/incidents/[id]/impacts/recompute`** action; and (3) a **soft-optional order-change subscriber** (`subscribers/impact-refresh.ts` on `sales.order.updated`/`.cancelled`/`.completed` — **verify exact ids against `sales/events.ts` at implementation**) that recomputes the metric for any active impact whose `target_id` matches the changed order, so the rollup self-heals as orders move without a polling loop. Surfaced in list (`revenue_at_risk` column), detail, and the dashboards revenue-at-risk widget.
- **Contract-tier-driven severity/SLA *suggestion* (non-binding v1).** When an impact links a customer/account, the impact snapshot captures `tier` (from `customers`, soft-optional); the war-room surfaces "**Enterprise** customer affected — consider SEV1 / SLA tier" as a **hint** (not an auto-mutation). Auto-bump via `business_rules` stays P7/deferred (keeps OSS-lean + module-independent).
- **Per-owner account-manager notification.** When an incident links an affected account, resolve that account's owner/account-manager from `customers` account-team (soft-optional) and notify **only that owner** ("An incident affects your account **Acme Corp**") — the per-owner scoping a standalone tool can't do without a synced ownership map. Idempotent, `features`-gated.
- **UMES surfacing.** `data/enrichers.ts` `_incidents` (`enrichMany`, `features`-gated, `timeout`/`fallback`, no N+1) on `customers` (person/company/account) + `sales` order responses; **widget injection**: account detail "Incidents" tab/widget + order detail "affected by INC-123" banner. New spot ids `detail:incidents.incident:*` remain STABLE public contract.

### v2.3 Remaining phases (finish per the original plan, with v2 elevations folded in)

- **Postmortems + action items + merge/link + reopen (Phase 5)** — per original spec; postmortem required-fields-on-resolve gate is already implemented in P2; build the UI (postmortem section + action-items panel + centralized list), `merge`/`link` commands + endpoints (semantics already specced), and the `reopen` transition (the war-room already exposes the button — wire the missing endpoint).
- **Portal per-account view + bulk ops + perspectives + auto-incident + dashboards (Phase 6)** — per original spec. Portal (`frontend/[orgSlug]/portal/incidents`, `requireCustomerAuth`/`requireCustomerFeatures: ['portal.incidents.view']`) shows customer-facing updates only, account-scoped, live via portal event bridge (`customer_updated`). Bulk via `ProgressJob`. Auto-incident subscribers with **verified** trigger event ids (verify each against the source module's `events.ts` at implementation) + `source_event_ref` dedupe. Dashboards MTTA/MTTR/active + **revenue-at-risk-by-segment** widget (the ERP-unique metric).
- **Participants UI (Phase 2 tail)** — the sidebar `ParticipantsPanel` is a stub; render responders/subscribers/roles with add/remove (commands exist).

### v2.4 New/changed contract surfaces (additive; pre-release so still mutable, FROZEN on release)

| Surface | New value | Class |
|---|---|---|
| Entity/table | `incident_escalation_policy` (`incident_escalation_policies`), `E.incidents.incidentEscalationPolicy` | FROZEN on release |
| Incident columns | `escalation_policy_id`, `escalation_status`, `escalation_repeats_done`, `escalation_last_targets`; drop `incident_settings.escalation_chain`; add `incident_type.default_escalation_policy_id`, `incident_settings.default_escalation_policy_id` | FROZEN on release |
| Event IDs | `incidents.incident.escalation_started`, `incidents.incident.escalation_exhausted` (add); `escalated` reused | FROZEN on release |
| API routes | `GET /api/incidents/[id]/escalate/preview`, `POST /api/incidents/[id]/impacts/recompute`, `/api/incidents/escalation-policies` (CRUD) | STABLE |
| Notification type ids | `incidents.*` (escalation/assignment/impact/account-manager) | FROZEN on release |
| Enriched namespace | `_incidents` on customers/sales | STABLE |

### v2.5 Integration test coverage (v2 additions — ship with the change)

**API:** escalation-policy CRUD + `default` resolution; escalate advances exactly one step + returns rich body; **escalate past last step → 409 exhausted** (bounded, not unbounded); `escalate/preview` returns next-step recipients; **ack halts escalation** (`escalation_status='acknowledged'`, `next_escalation_at` cleared); sweep auto-advances after `delay_minutes` (fake-clock/seeded `next_escalation_at` in the past), **double-tick advances at most one level** (atomic conditional UPDATE), exhaustion sets `escalation_status='exhausted'` + emits event once, snooze suppresses then resumes, scope isolation; impact add/update_status/remove + duplicate-target 409; **revenue-at-risk rollup = Σ metrics**; `impacts/recompute` refreshes from live data (mock sales/customers); enricher `_incidents` (no N+1, fallback on timeout); per-owner account-manager notification fires to the owner only; portal own-account-only + customer-facing-only + cross-account 403; bulk 202 + per-id isolation; auto-incident create-once per `source_event_ref`. **UI:** declare→escalation starts (level 0 paged); Escalate-now preview dialog shows recipients; ack shows "Acknowledged by"; impact add + revenue rollup; CRM account Incidents widget; portal account view. Self-contained fixtures, policy-compliant passwords, workers=1 where round-trips asserted.

### v2.6 Design-review reconciliations (Codex + DeepSeek spec jury, 2026-07-01)

Shift-left blockers from the cross-model spec review, resolved before any code was grounded:

- **Single system-safe escalation-advance command (`incidents.incident.advance_escalation`, internal).** BOTH the manual `POST /escalate` route and the header-less sweep worker dispatch this one command through the command bus (preserving audit/events/undo). The advance is an **atomic conditional claim**: `UPDATE incidents SET escalation_level = :expected+1, next_escalation_at = :recomputed, escalation_last_targets = :snapshot, updated_at = now() WHERE id = :id AND escalation_level = :expected AND escalation_status = 'active' AND deleted_at IS NULL AND status NOT IN ('resolved','closed') RETURNING id` — the claim is the concurrency primitive for the worker (which has no HTTP `updatedAt` header), and it also makes manual double-clicks idempotent. The manual route additionally runs the normal command-level optimistic lock (HTTP header) + mutation guards; the worker path runs with a **system actor context** (`actorUserId='system'`, no HTTP header) and relies solely on the atomic claim. Target resolution (role/team→users, `planner` on-duty when present) happens inside the command before the claim; resolution failure degrades to paging owner+commander and never throws.
- **Default policy is always seeded (declare-must-escalate).** `setup.ts seedDefaults` idempotently seeds a **default `incident_escalation_policy`** (`key='default'`, `is_default=true`, `is_active=true`, one step: `{ delay_minutes: 30, targets: [{type:'role', id:<commander role id>}] }` — or owner target), points `incident_settings.default_escalation_policy_id` at it, and sets the default incident type's `default_escalation_policy_id`. On `create`, the incident resolves `escalation_policy_id` = type default → settings default. **No-crash guard:** if the resolved policy is missing/inactive/deleted/empty, escalation stays `escalation_status='inactive'` and the war-room shows "No escalation policy" — the runtime never indexes `steps[0]` on an empty policy.
- **Manual `POST /escalate` preconditions (explicit).** From `inactive` → **start** escalation at step 0 (activate + page). From `active` → **advance** one step. From `acknowledged` → **re-activate** and advance one step, appending a timeline entry `{ trigger:'manual_after_ack' }` (an operator explicitly choosing to re-escalate). From `exhausted` → **409 `[internal] escalation_exhausted`** (nothing left to page). Resolved/closed incidents → 409 (immutable).
- **Merge clears escalation state.** The `merge` command's source-close applies the full close cascade **including** `escalation_status='inactive'`, `next_escalation_at=null`, `snoozed_until=null` — so the sweep never touches a merged (closed) incident and the source is not left mid-escalation.
- **Per-owner account-manager notification — trigger + idempotency (explicit).** Fires from the `impact.add` command **only** when the impact target is a `customer_person`/`customer_company`/`customer_account`; it resolves that account's owner/account-manager from `customers` (soft-optional) and notifies **only that owner**, deduped by a deterministic key `incidents.account_manager_alert:<incidentId>:<ownerUserId>` (at-most-once per incident+owner, even under redelivery). No owner resolvable → no-op (logged).
- **Notification recipient idempotency for escalation.** The `escalated`/`escalation_started` events carry `recipientUserIds` (the `escalation_last_targets.recipients` resolved at emit-time) plus a dedupe key `incidents.escalation:<incidentId>:<level>:<repeatsDone>`, so the async notification handler pages exactly those users at-most-once per (incident, level, repeat) regardless of later team-membership changes.
- **Ack ACL:** verify the `acknowledge` route uses `requireFeatures: ['incidents.incident.manage']` (a respond action) — the staged code already appears to; correct it to `manage` if any route still gates it on `incidents.incident.escalate`.

## Changelog
### 2026-07-02 (v2 completion) — Settings/policy UI, postmortems/action-items/merge/link/reopen, portal, bulk, auto-incident, dashboards (Fable orchestrator; Codex implementer packets A–I)
Completes every remaining v2.3 item. New: `/backend/incidents/settings` (general settings, auto-incident trigger toggles, escalation-policy manager with ordered step editor, per-type default policy); postmortem draft/publish + action items + links + merge + reopen (commands, routes, war-room panels, central postmortems list at `/backend/incidents/postmortems` + `/api/incidents/postmortems`); customer portal `/{orgSlug}/portal/incidents` + `GET /api/incidents/portal` (customer-facing updates only, account-scoped, live via portal bridge with per-customer `recipientUserIds` resolution — emission skipped when no portal recipients resolve, preventing org-wide broadcast leakage); bulk acknowledge/close via ProgressJob (`POST /api/incidents/bulk`, queue `incidents-bulk-ops`, per-id error isolation); auto-incident subscribers for verified `data_sync.run.failed` + `integrations.state.updated` (reauth) with atomic `source_event_ref` dedupe through the create command; `impact-refresh` subscriber on `sales.order.updated` (revenue self-heal); dashboard widgets `incidents-active` / `incidents-revenue-at-risk` / `incidents-mtta-mttr`; perspectives + revenue-at-risk column + SLA badges + bulk actions on the list; module-local `UserSelect` replacing raw user-UUID inputs (degrades to UUID input without the auth users feature). Hardening from the test packet: merge re-locks the target (`PESSIMISTIC_WRITE` re-check inside the transaction); `postmortem`/`action_item` events now `clientBroadcast`. Grants: `portal.incidents.view` seeded to portal_admin/buyer/viewer.
**Deviations (deliberate):** `notifications.handlers.ts` not built — notification fan-out runs via persistent subscribers only; attachments/@-mentions in the war-room composer (soft-optional P2 items) not included; `team` escalation targets not selectable in the policy editor (no team lookup endpoint; existing team targets render read-only); dashboards widget titles are literal strings (platform resolver lacks `titleKey` support); `slaTargets` matrix not editable in the settings UI (needs a schema-specific editor).
**Test-coverage deltas (open):** enricher no-N+1/timeout-fallback, sweep tick-level double-tick/SLA set-once (design uses atomic conditional claims; TC-INC-005 covers escalate/ack/exhaustion), dashboards widget data, notification fan-out de-dup — unit/integration follow-ups.

### 2026-07-01 (v2 elevation) — Escalation policies + deepened CRM/sales (Opus orchestrator; Codex implementer; Claude/Codex/Kimi/DeepSeek jury)
Elevates the shipped P1–P2 per user feedback (unintuitive escalation; weak module integration) and finishes P3–P6. Escalation moves from a **bare unbounded counter** to a **named escalation-policy model** (steps + delays + user/team/role targets, ack-halts-escalation, bounded repeats→exhaustion, manual escalate-to-next with an incident.io-style *who-will-be-paged* preview, a real scheduler sweep worker, and a live war-room escalation card) — directly resolving "possibility of multiple escalations / unclear what happens." CRM/sales impact is deepened to best-in-class: **live revenue-at-risk rollup**, contract-tier severity/SLA **hint**, **per-owner account-manager notification**, `_incidents` enrichers + account/order widgets. Notifications trio built (escalation is meaningless without it). New surfaces: `incident_escalation_policy` entity, escalation-state incident columns, `escalation_started`/`escalation_exhausted` events, escalate-preview + impacts-recompute + escalation-policies routes. OSS/enterprise line kept strict (no status pages/rotations/paging/AIOps/advanced-SLA-calendars). Pre-release, so the P1–P2 escalation schema (`escalation_chain`) is revised, not bridged.

### 2026-07-01 — Cross-model spec-review reconciliation (Codex gpt-5.5 + Kimi K2.7 + DeepSeek V4 Pro)
Shift-left adversarial design review (three model families) before any code. Resolved blockers folded into the spec:
- **Merge/link storage + semantics** were undefined (all 3 voters): added `incident.merged_into_incident_id`, a new `incident_link` table, and full merge/link semantics (source closed + number retained + impacts/action-items moved + both timelines annotated + read-only; link non-destructive & idempotent).
- **Auto-incident idempotency** had no store (Kimi+DeepSeek): added `incident.source_event_ref` (partial-unique) + the deterministic `<eventId>:<sourceEntityId>` dedupe rule.
- **SLA "at-risk"** was untestable (Codex+DeepSeek): added `sla_at_risk` column, `at_risk_pct` in `sla_targets`, the compute rule, and a set-once test.
- **Escalation-sweep concurrency** (Kimi, sharp): optimistic-lock is a no-op in a header-less worker → specified `concurrency: 1` single-flight + atomic conditional UPDATE + set-once SLA guards.
- **`incident_impact` duplicate-target** (DeepSeek): added the partial-unique that protects the revenue rollup.
- **required-fields-on-resolve gate** and **close-vs-resolve cascade** ambiguity (Kimi): defined the postmortem-draft mechanism and the close cascade superset + reopen.
- **Over-engineering removed**: dropped `incident.workflow_instance_id` (P7-deferred) and `incident_settings.business_hours` (enterprise SLA) from the v1 frozen surface — added additively later.
- **Convention/BC fixes**: renamed event `customer_update` → `customer_updated` (past tense, pre-freeze); defined `escalation_chain`/`sla_targets` jsonb structures; encryption-scope decision (title/description operational & searchable, PII in encrypted fields, snapshot label non-PII); portal `customer_updated` recipient-resolution + minimal payload; corrected the `SchedulerService.register` signature (name/scopeType/scope); noted MikroORM **v7** (not 6.6); bulk endpoint contract added; sub-resource writes bump parent `updated_at`.
- Advisory notes not adopted as blockers logged for implementation-time verification (exact peer trigger-event ids, portal recipient-filter field, sales document target types).

### 2026-06-30
- Initial specification (OSS core v1). Scope, four gate decisions (scheduler-sweep timer; module-owned catalogs; lightweight components; customers+orders+portal impact), data model, API, UI, escalation design, BC surfaces, phasing, and integration test coverage. Enterprise features deferred to a separate spec.
