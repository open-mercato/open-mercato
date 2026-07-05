# Incident Management Module (OSS core)

## TLDR

**Key Points:**
- A new core module `incidents` (`packages/core/src/modules/incidents/`) for **internal incident management**: incidents with configurable severity, lifecycle states, internal owners/teams/roles, an append-only timeline, postmortems + tracked action items, reusable response runbooks that instantiate action items, **customer & order impact linkage with revenue rollup**, a **named escalation-policy model** with timeout-driven escalation, **user-configurable auto-incident triggers over any platform event**, a **human-in-the-loop AI layer**, and full **i18n**.
- Primary value: incidents embedded next to CRM/sales data — answering "which customers, orders, and revenue are affected" — which a standalone SRE tool structurally cannot. Reuses platform engines (events, notifications, scheduler, audit_logs, attachments, messages, planner, perspectives, dashboards, portal, search, ai-assistant) instead of rebuilding SRE tooling; cross-module links are FK-id + snapshot only.

**Scope (OSS core):**
- Incident lifecycle + states, severity & priority, internal owners/teams/per-incident roles, subscribers vs responders.
- Append-only timeline with internal vs customer-facing notes/updates, timeline filter tabs + day grouping + incremental realtime merge; attachments.
- Customer + sales-order + customer-account impact linkage with revenue-at-risk rollup; contract-tier severity/SLA hint; per-owner account-manager notification; lightweight service/component catalog with dependency context plus legacy freeform component impact; **portal-facing per-account incident visibility**.
- A named **escalation-policy model** (steps + delays + user/team/role targets, ack-halts-escalation, bounded repeats→exhaustion, manual escalate-to-next with a who-will-be-paged preview), a **scheduler-cron escalation/SLA/snooze/cadence sweep worker**, and an acknowledge action.
- Postmortems + action items + reusable response runbooks attached by type/severity + required-fields-on-resolve gate; merge/link; reopen; cascade-on-close.
- **User-configurable auto-incident triggers** (`incident_trigger` entity + one wildcard dispatch subscriber) so an operator can open an incident on any chosen platform event.
- **Customer-update cadence** ("next update due" timers per severity) driven on the same sweep.
- A **CRM-grade war-room detail page** (`DetailTabsLayout` main column + inline-edit sidebar), list (+bulk +perspectives), create form (with AI triage assist), settings; UMES enrichers + widget injection on CRM/sales; dashboards widgets.
- An **AI layer**: chat war-room assistant, triage, postmortem writer, one-shot draft routes (summary / customer-update / postmortem-draft), and similar-incidents retrieval over the platform search API — all soft-optional and never auto-mutating, with actionable error surfacing.

**Concerns:**
- Module independence: catalogs are **module-owned** (no `dictionaries` dependency); all peer modules are **soft-optional** (`allowUnregistered`/events) so `incidents` works enabled or disabled.
- Escalation/SLA/cadence timing depends on the scheduler sweep cadence (poll latency, bounded).
- Inbound auto-incident trigger event IDs are a contract dependency — must be verified against each source module's `events.ts` at implementation.
- The wildcard trigger subscriber runs on every platform event — mitigated exactly the way `webhooks` already does (fast early-exit + per-tenant match) plus a self-module loop guard.
- AI features depend on a configured ai-assistant provider — every AI surface is soft-optional, hidden when unavailable, and never auto-mutates.

> **Reference module:** `customers` (ARCHITECTURE §29). **Enterprise deferral:** public status pages, advanced SLA engine (business-hours calendars/pause), complex on-call rotations, multi-channel paging, AIOps alert ingestion, priority matrix (impact × urgency), config-as-code, SSO/SCIM, MSP analytics → separate spec under `.ai/specs/enterprise/`.

---

## Overview

`incidents` lets internal teams declare, triage, own, escalate, communicate, and learn from operational incidents — and ties every incident to the customers, orders, and revenue it affects. The audience is internal operators/support/engineering (backoffice) plus, read-only, the affected customer (portal). It mirrors the `customers` module's full-stack pattern: MikroORM 7 entities, `makeCrudRoute` + command pattern with undo, query-index coverage, search config, custom fields, typed events, notifications, widget injection, and a CrudForm-based create flow — with a purpose-built CRM-grade war-room detail page for the live-incident experience.

> **Market reference:** Studied PagerDuty, Atlassian Opsgenie, incident.io, FireHydrant, Rootly, Jira Service Management (ITIL), ServiceNow ITSM, Freshservice/Zendesk, and Atlassian Statuspage.
> **Adopted:** configurable severity + lifecycle states; per-incident roles (Commander/Comms Lead/Scribe); responders-vs-subscribers; append-only timeline; internal-vs-customer-facing updates; postmortems + tracked action items; reusable response runbooks; required-fields-on-resolve; reopen; merge/link; drill flag; types as schema drivers; ACK + escalation; **named escalation policies with a who-will-be-paged preview**; visual escalation-path preview; **similar-incident retrieval**; **AI living summary + drafted updates + postmortem draft + triage**; **customer-update cadence**.
> **Rejected for OSS core (→ enterprise):** public/branded status pages, alert-ingestion/AIOps pipelines, multi-channel paging (SMS/voice/push), complex layered on-call rotations, advanced SLA calendars, priority matrix (impact × urgency), runbook automation against external systems. **Rejected outright:** rebuilding an on-call rotation engine (read availability from `planner`), a state-machine engine (delegate automation to `workflows`), or a catalog service (own the catalogs; do not depend on `dictionaries`).

## Problem Statement

Open Mercato has no structured place to record an incident, assign an owner, track a timeline, declare severity, escalate when unacknowledged, communicate customer impact, or capture a postmortem. Most importantly, there is no way to connect an incident to the CRM/sales records it affects, so the platform cannot answer the question that matters most inside an ERP/CRM — *which customers, orders, and revenue are impacted right now*. Adopting an external SRE tool cannot close this gap: it has no access to the customer/sales datastore and can only reason about abstract "services," and must sync a lagging, manually-tagged shadow copy of customer/service/revenue/contract data just to approximate impact features. Best-in-class expectations for a 2026 incident tool also include configurable auto-incident triggers on arbitrary platform signals, AI summaries/drafted updates/triage/similar-incident retrieval, an intuitive escalation-path preview, and trustworthy multilingual UX — none of which exist without this module.

## Proposed Solution

A single, self-contained core module `incidents` built on the canonical primitives. Core domain entities (`incident`, `incident_timeline_entry`, `incident_participant`, `incident_impact`, `incident_service_component`, `incident_service_dependency`, `incident_action_item`, `incident_postmortem`, `incident_link`, `incident_runbook`, `incident_runbook_step`, `incident_trigger`) plus module-owned config catalogs (`incident_severity`, `incident_type`, `incident_role`, `incident_escalation_policy`, `incident_settings`) and a concurrency-safe `incident_number_sequence`. CRUD via `makeCrudRoute`; high-contention state changes (transition, ACK, assign, add-note, impact/participant/action edits, escalation advance, runbook instantiation) as **command-style action endpoints** that enforce **command-level optimistic locking against the parent incident aggregate**. Timeout-driven behavior (escalation, SLA at-risk/breach, snooze expiry, customer-update cadence, overdue-action reminders) runs on a **scheduler-cron sweep worker**, because the event bus is reactive only. Cross-module value (revenue blast-radius, account-record widgets, portal visibility, service dependency context, contract-tier-driven escalation hint, per-owner account-manager notification, AI, similar incidents) is delivered through **events, FK-id + snapshot, UMES enrichers/injection, and soft-optional DI resolves** — never ORM relations or imports, so the module degrades gracefully when a peer is disabled. Auto-incident creation is driven by a **user-configurable `incident_trigger` entity** matched by **one persistent wildcard (`event: '*'`) dispatch subscriber** (the `webhooks` outbound-dispatch precedent).

### Design Decisions

| Decision | Rationale |
|---|---|
| Module-owned config catalogs (`incident_severity`/`type`/`role`/`escalation_policy`/`settings`) seeded in `setup.ts` | Keeps `incidents` self-contained — no hard `requires: ['dictionaries']` (which would break the "works enabled or disabled" rule). |
| Lifecycle states are a fixed, documented enum (open → investigating → identified → mitigated → resolved → closed) | Avoids shipping a state-machine config engine; labels are i18n'd; configurable states deferred. Transitions validated server-side. |
| Scheduler-cron sweep as the single timer substrate | Events are reactive only; `SchedulerService.register()` (cron/interval) + a queue worker is the canonical, durable mechanism (used by `communication_channels`). One mechanism covers ack-timeout, escalation chain, SLA, snooze, overdue-action reminders, and customer-update cadence. |
| Named escalation-policy model targeting users/teams/roles directly (no rotation engine) | Delivers ~90% of escalation clarity (levels, timers, ack-stops-timer, manual escalate, who-will-be-paged preview) without an on-call scheduler; PagerDuty/incident.io both accept plain user targets. A `role`/`team` target optionally resolves to a currently-available person via `planner` (soft-optional); absent planner, it notifies all members. |
| Command-level optimistic locking on the **parent incident aggregate** for all sub-resource writes | Multiple responders mutate one live incident concurrently; guarding the aggregate's `updated_at` (document-aggregate pattern) yields correct 409s on timeline/participant/impact/action writes, not just CrudForm. |
| Module-owned `IncidentNumberGenerator` mirroring `SalesDocumentNumberGenerator` (atomic `INSERT … ON CONFLICT DO UPDATE … RETURNING`) | Lock-free, concurrency-safe per-(org,tenant) sequence; avoids the soft-delete/partial-unique-index flakes; format-token templating reused. |
| CRM-grade war-room composite detail page (not a generic CrudForm) | A live incident is a high-density operations view; the main column uses `DetailTabsLayout` (Timeline / Impacts / Action items / Postmortem) with the escalation/status rail permanently visible, and the sidebar uses the CRM inline-edit field pattern; CrudForm is used only for the create flow. |
| Impact `snapshot` holds display + metric fields only (label, amount, currency, tier, status); PII re-fetched live via enricher | Sidesteps the jsonb-encryption footgun and stale-PII; revenue rollup uses stored numeric metrics; names/emails are never persisted in the snapshot. |
| Portal visibility | Reuses portal auth + portal event bridge for an account-scoped read-only view — the OSS substitute for a public status page. |
| One wildcard `incident_trigger` dispatch subscriber + DB-configured triggers (vs N generated subscribers) | Mirrors `webhooks` `outbound-dispatch` exactly; subscriber files are static, so per-event subscribers cannot cover a user-chosen event set. Early-exit on non-matching events keeps cost ~0. The entity gives list UI, per-row optimistic locking, and per-trigger severity/type/policy/conditions. |
| AI = drafts + approval, never auto-writes | `prepareMutation` is mandatory for agent writes (framework fails closed); one-shot routes return JSON the UI puts into forms/composers the human submits through existing guarded mutations, keeping audit, undo, and optimistic locking intact. |
| Similar incidents via the platform search API (vector when configured, fulltext fallback), not an LLM call | Works for every deployment (no provider needed), instant, and `search.ts` already indexes incident title/description. |

### Alternatives Considered

| Alternative | Why Rejected |
|---|---|
| Reuse `dictionaries` for catalogs | Hard dependency; breaks module independence. |
| Per-incident queue delayed-jobs for escalation timing | More precise but adds cancel/reschedule complexity on every transition; scheduler sweep is simpler and durable. Hybrid deferred. |
| Reuse `resources` as the service/component catalog | Couples to `resources` and assumes every tenant models services there; the incident-owned service/component catalog with optional `source_type`/`source_id` soft links gives dependency context without cross-module ORM relations. |
| Generic `audit_logs` as the timeline | Audit is append-only governance, not a curated operational timeline with internal/customer-facing visibility and composer UX; keep a domain timeline and still get audit for free via the command bus. |
| Build an on-call rotation engine | Over-scoping; read current availability from `planner` (soft-optional); layered rotations are enterprise. |
| Store auto-incident triggers as `incident_settings` JSONB | An entity gives a list UI, per-row optimistic locking, per-trigger config, and mirrors how `webhooks` stores per-subscription state. |
| Round-robin / rotation escalation notify strategy | Rotation-adjacent (needs a cursor); out of OSS-lean scope. Steps notify all targets. |

## User Stories / Use Cases

- An **operator** wants to **declare an incident, set severity/type, and assign an owner** so that responsibility is clear immediately.
- A **responder** wants to **post timeline updates (internal) and customer-facing updates separately** so that internal coordination never leaks to customers.
- An **incident commander** wants to **see affected customers, orders, and total revenue at risk** so that severity and exec escalation reflect business impact.
- A **manager** wants an **unacknowledged incident to escalate automatically after a timeout**, along **a named, previewable escalation path** so that nothing is dropped and it is clear who will be paged next.
- A **support lead** wants **postmortems with tracked action items and a required root-cause before close** so that the team actually learns.
- An **affected customer** wants to **see incidents scoped to their own account in the portal** so that they stay informed without internal access.
- A **CRM user** wants to **see an account's live incident status on the customer record** so that they have context before contacting the customer.
- An **admin** wants to **open an incident automatically when any chosen platform event fires** so that operational signals become tracked incidents without code changes.
- A **responder** wants **AI to draft the customer update, summarize the timeline, and suggest severity/type on create** so that comms and triage are faster — while staying in control of every write.

## Architecture

### Module shape & independence

- Location: `packages/core/src/modules/incidents/`. Standard discovery files. `index.ts` declares **no hard `requires`** for business peers — `customers`, `sales`, `customer_accounts`, `portal`, `workflows`, `business_rules`, `communication_channels`, `messages`, `planner`, `staff`, `dashboards`, `notifications`, `attachments`, `ai_assistant`, `search` are all **soft-optional**, resolved via `container.resolve(key, { allowUnregistered: true })` or reached only through the event bus. The module's core (CRUD + timeline + escalation sweep) works with every peer disabled.
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
  W->>CB: incidents.incident.advance_escalation (advance one step, set next_escalation_at)
  W->>W: evaluate SLA + customer-update cadence; clear expired snoozes
  CB-->>N: emit incidents.incident.escalated → notify next step targets
```

**Concurrency safety (critical — the worker has no HTTP request, so `enforceCommandOptimisticLock` does NOT apply here).** The sweep must be safe against overlapping ticks by construction, not by optimistic-lock headers:
- The escalation-sweep worker is registered **single-flight** (`concurrency: 1` in its worker metadata, mirroring the `communication_channels` poll-tick worker) so two ticks for the same queue never run concurrently.
- Each escalation is advanced with an **atomic conditional UPDATE** that both selects and claims the work in one statement, keyed on the expected current step: `UPDATE incidents SET escalation_level = :expected+1, next_escalation_at = :recomputed, escalation_last_targets = :snapshot, updated_at = now() WHERE id = :id AND escalation_level = :expected AND escalation_status = 'active' AND deleted_at IS NULL AND status NOT IN ('resolved','closed') RETURNING id` — so a double-tick advances a given incident at most once per due window (the second tick's predicate no longer matches).
- SLA flags are **set-once** via guarded updates: `... SET sla_at_risk = true ... WHERE sla_at_risk = false AND ...` and likewise for `sla_breached`. Snooze expiry clears `snoozed_until` only `WHERE snoozed_until <= now()`. The customer-update overdue notification fires via an atomic conditional UPDATE `WHERE next_update_due_at <= now() AND (update_overdue_notified_at IS NULL OR update_overdue_notified_at < next_update_due_at)`.
- **SLA at-risk vs breach** are computed from `sla_targets[severity_key]`: `sla_response_due_at`/`sla_resolution_due_at` are set on create/severity-change from `response_minutes`/`resolution_minutes`; the sweep sets `sla_at_risk` when `now() >= due - (due - started_at) * (1 - at_risk_pct/100)` and not yet breached, and `sla_breached` when `now() > due`. Both are surfaced in list/detail responses and covered by an integration test.

The sweep is thus **idempotent** (re-running a tick produces no duplicate escalations and no double-set flags). Registered once per (org,tenant) in `setup.ts seedDefaults` via `SchedulerService.register({ id: <deterministic uuid from a stable key>, name, scopeType:'tenant', organizationId, tenantId, scheduleType:'interval', scheduleValue:'60s', timezone:'UTC', targetType:'queue', targetQueue:'incidents-escalation-sweep', targetPayload:{ scope:{ tenantId, organizationId } }, sourceType:'module', sourceModule:'incidents', isEnabled: true })` (resolved only when `schedulerService` is registered — soft-optional). Target resolution (role/team → users) reads `planner` availability when present (soft-optional), else all members; resolution failures degrade to "notify owner + commander" and never crash the tick.

### Escalation policy model

Policies target **users/teams/roles** directly (no rotation engine). The universal *ack halts escalation* mechanic applies. Concepts are research-grounded (PagerDuty "escalation policy → rules/levels + escalates-after-N-min"; incident.io "escalation path → levels + wait + who-will-be-paged preview"; Grafana/Rootly step+delay).

**Lifecycle of escalation (the "what happens when escalated" answer, explicit):**
1. **Start.** On `create` (declare), if a policy resolves and the incident is not auto-acknowledged: set `escalation_status='active'`, `escalation_level=0`, page step-0 targets immediately (emit `escalation_started` + notifications), snapshot `escalation_last_targets`, set `next_escalation_at = now + steps[0].delay_minutes`. Append an `escalation` timeline entry `{ trigger:'auto', to_level:0, targets, policy_key }`.
2. **Auto-advance (sweep).** While `escalation_status='active'` and `acknowledged_at IS NULL` and not snoozed and `status NOT IN (resolved,closed)`, when `next_escalation_at <= now`: advance to the next step (notify **additive** — prior responders stay, next step's targets are also paged), snapshot targets, append timeline, emit `escalated`, set `next_escalation_at` for the following step. If no next step: if repeats remain, loop to step 0 and increment `escalation_repeats_done`; else set `escalation_status='exhausted'`, clear `next_escalation_at`, emit `incidents.incident.escalation_exhausted` (notify owner/commander "escalation exhausted, still unacknowledged").
3. **Ack halts.** `acknowledge` sets `acknowledged_at` **and** `escalation_status='acknowledged'` + `next_escalation_at=null`. The war-room shows "Acknowledged by <user>". Escalation does not auto-resume (re-trigger deferred).
4. **Resolve/close** cascade clears `next_escalation_at`/`snoozed_until` and sets `escalation_status='inactive'`.
5. **Snooze** clears `next_escalation_at` and pauses. **Resume rule (no new column):** on snooze expiry the sweep sets `next_escalation_at = snoozed_until + steps[escalation_level].delay_minutes` — the current pending step's timer restarts fresh from snooze-expiry.
6. **Policy changed mid-flight.** If `escalation_policy_id` changes while `escalation_status='active'`: **reset** — `escalation_level=0`, `escalation_repeats_done=0`, re-page the new policy's step 0, re-snapshot, recompute `next_escalation_at`, append an `escalation` timeline entry `{ trigger:'policy_changed', policy_key }`. If the incident is `acknowledged`/`exhausted`/`inactive`, changing the policy only swaps the id and does not re-activate escalation. Clearing the policy to null sets `escalation_status='inactive'` and `next_escalation_at=null`.

**Manual escalate (PagerDuty "escalate to next level" + incident.io preview):**
- `POST /api/incidents/[id]/escalate` — advances **one step now** (same code path as one sweep tick for this incident), keeping the automation running. Preconditions: from `inactive` → **start** at step 0; from `active` → **advance** one step; from `acknowledged` → **re-activate** and advance one step, appending `{ trigger:'manual_after_ack' }`; from `exhausted` → **409 `[internal] escalation_exhausted`**; resolved/closed → 409 (immutable). Returns a **rich body** `{ ok, incidentId, escalationLevel, escalationStepCount, escalationStatus, nextEscalationAt, pagedTargets:[{type,id,label}], updatedAt }` so the UI updates without a refetch.
- `GET /api/incidents/[id]/escalate/preview` — **the who-will-be-paged preview**: resolves the *next* step's targets to concrete recipients + the notification message, returns `{ nextLevel, stepCount, targets:[{type,id,label}], recipients:[{userId,label}], willExhaust:boolean }`. The war-room confirm dialog renders "You're about to page **Engineering Managers** (Alice, Bob) — this is level 2 of 3."
- **Idempotency / double-click safety:** the advance is an atomic conditional UPDATE keyed on the expected current `escalation_level`, so a rapid double-submit advances at most one level per confirmed intent; the client also disables the button while pending.

**Single system-safe escalation-advance command (`incidents.incident.advance_escalation`, internal).** BOTH the manual `POST /escalate` route and the header-less sweep worker dispatch this one command through the command bus (preserving audit/events/undo). The manual route additionally runs the command-level optimistic lock (HTTP header) + mutation guards; the worker path runs with a **system actor context** (`actorUserId='system'`, no HTTP header) and relies solely on the atomic claim. Target resolution (role/team→users, `planner` on-duty when present) happens inside the command before the claim; resolution failure degrades to paging owner+commander and never throws. `merge` clears escalation state as part of the source-close cascade so the sweep never touches a merged incident.

### Trigger dispatch (the "any event" auto-incident path)

```
peer module emits any event
        │
        ▼
subscribers/auto-incident-dispatch.ts   (metadata: { event: '*', persistent: true, id: 'incidents:auto-incident-dispatch' })
  1. resolve eventId exactly like webhooks outbound-dispatch:
     ctx.eventId ?? ctx.eventName ?? payload.eventId ?? payload.type — none ⇒ return
     (same accepted limitation as webhooks: events that carry no id in ctx/payload are not trigger-able)
  2. eventId starts with 'incidents.' / 'application.' / 'query_index.' / 'webhooks.'
                                                            → return (loop guard + the
     webhooks skip-list precedent for infrastructure noise)
  3. declared event has excludeFromTriggers === true        → return
     (via getDeclaredEvents() from @open-mercato/shared/modules/events — the exact
     shouldSkipOutboundDispatch mechanism webhooks uses)
  4. tenantId := payload.tenantId, organizationId := payload.organizationId — BOTH required
     (read from the payload, as webhooks does); either missing ⇒ return.
     Tenant-only events are therefore not trigger-able — documented limitation.
  5. load enabled incident_trigger rows for (organizationId, tenantId, eventId) —
     a direct indexed DB lookup per event, NO cache (the webhooks precedent queries per
     event too; the composite partial index makes this a single cheap probe)
  6. none                                                   → return (the ~always path)
  7. per trigger: evaluate `conditions` (AND of scalar equality predicates over
     dot-paths into the payload, e.g. [{ path: 'reauthRequired', equals: true }]);
     any predicate false/unresolvable ⇒ skip this trigger
  8. dispatch the create command (`incidents.incident.create`, commands/incident.ts)
     with severity/type/policy from the trigger row (fallback to catalog defaults;
     escalationPolicyId omitted when the trigger has none so type/settings defaults
     resolve) and source_event_ref computed deterministically:
       (a) first stable id string among payload.id, payload.recordId, payload.entityId
       (b) else sha256 over the sorted top-level scalar entries of the payload,
           excluding volatile keys (/(^|_)(at|time|timestamp|date)s?$/i)
       (c) neither (empty scalar projection) ⇒ create WITHOUT dedupe + warn log
     → the source_event_ref partial-unique dedupes redelivery for (a)/(b)
  9. failures logged, never rethrown to the bus (subscriber isolation); a setup-phase
     try/catch ensures resolver/query failures never reject the subscriber
```

### Commands & Events

- **Commands** (undoable unless noted; ids `incidents.<entity>.<action>`): `incident.create/update/delete`, `incident.acknowledge`, `incident.transition_status` (covers resolve/close/reopen with the required-fields gate), `incident.change_severity`, `incident.assign`, `incident.advance_escalation` (internal; both the escalate route and the sweep dispatch it), `incident.snooze`, `incident.merge`, `incident.link`; `timeline_entry.add` (append-only, **not undoable**); `participant.add/update_role/remove`; `impact.add/update_status/remove`; `action_item.create/update/complete/delete`; `postmortem.create/update/publish`; config `severity.*`, `type.*`, `role.*`, `escalation_policy.*`, `trigger.*`, `settings.update`.
- **Events** (declared in `events.ts` via `createModuleEvents`, `as const`; `module.entity.action`, **past tense**): `incidents.incident.created/updated/deleted/acknowledged/status_changed/severity_changed/assigned/escalation_started/escalated/escalation_exhausted/snoozed/resolved/closed/reopened/merged/linked/update_overdue`; `incidents.timeline_entry.added`; `incidents.action_item.created/completed`; `incidents.postmortem.created/published`; `incidents.trigger.created/updated/deleted`; `incidents.incident.customer_updated` (customer-facing). `clientBroadcast: true` on created/updated/status_changed/severity_changed/assigned/acknowledged/escalation_started/escalated/escalation_exhausted/resolved/timeline_entry.added/postmortem/action_item (audience: tenant + owner/team/subscribers). `portalBroadcast: true` on `customer_updated`.
- **Aggregate consistency:** every sub-resource write (timeline/participant/impact/action-item/postmortem command) MUST bump the **parent incident's `updated_at`** in the same transaction — so the command-level aggregate optimistic lock and `clientBroadcast` realtime both reflect the change, and a concurrent editor of the parent gets a correct 409.
- **Portal audience resolution:** the portal event bridge (`customer_accounts/api/portal/events/stream.ts` `matchesAudience`) filters by `tenantId` → optional `organizationId(s)` → optional `recipientUserId(s)` — there is **no account/customer filter**. So `customer_updated` MUST be emitted with `tenantId` + `recipientUserIds: string[]`, resolved from the impacted company/person: query `CustomerUser` (table `customer_users`) by `customerEntityId`/`personEntityId` (tenant-scoped, `deletedAt: null`) → their `.id`s. Payload is **minimal** (incident number, current status, customer-facing message only — never internal notes/PII). Emission is skipped when no portal recipients resolve — omitting `recipientUserIds` would broadcast to every portal user on the tenant/org, a data-leak.
- **Notification recipient idempotency for escalation.** The `escalated`/`escalation_started` events carry `recipientUserIds` (the `escalation_last_targets.recipients` resolved at emit-time) plus a dedupe key `incidents.escalation:<incidentId>:<level>:<repeatsDone>`, so the async handler pages exactly those users at-most-once per (incident, level, repeat) regardless of later team-membership changes. The per-owner account-manager alert dedupes by `incidents.account_manager_alert:<incidentId>:<ownerUserId>`.

### Cross-module coupling (verify inbound event IDs at implementation)

| Peer | Mechanism |
|---|---|
| `notifications` | Emit notification events to owner/team/subscribers/mentions and to escalation step's resolved targets; renderers in `notifications.client.ts`; reactive `notifications.handlers.ts` (idempotent, `features`-gated). Soft. |
| `attachments` | Evidence on incidents/notes. Soft. |
| `messages` | Internal threaded collaboration + @-mentions (distinct from notes/ChatOps); mention → notify. Soft. |
| `customers`/`sales`/`customer_accounts` | Impact links via FK-id + snapshot; revenue rollup; live PII re-fetch via enricher; contract-tier hint; per-owner account-manager notification; `RecordSelect` impact pickers over their list APIs. Soft. |
| `customers`/`sales` (their pages) | UMES: `_incidents` enricher (`enrichMany`, `features`-gated, `timeout`/`fallback`) + widget injection (account "Incidents" tab/widget; order "affected by incident" banner). |
| `resources`/`catalog` (future optional source records) | `incident_service_component.source_type/source_id` stores FK-id style soft links and snapshot metadata only. No peer entity imports, no ORM relations, and incidents still works when those modules are disabled. |
| `staff` | Team escalation targets + team labels in previews via `GET /api/staff/teams` (feature `staff.view`; `?search=&ids=&isActive=`) — absent/403 ⇒ team option hidden, existing targets render as id chip. Soft. |
| `scheduler` + `queue` | Escalation/SLA/snooze/cadence sweep. |
| `portal` | `frontend/[orgSlug]/portal/incidents` (account-scoped, read-only) + portal event bridge. Soft. |
| `perspectives` | Saved/filtered incident views (DataTable-native). |
| `dashboards` | Register MTTA/MTTR/active-incident/revenue-at-risk widgets with `analyticsRegistry`; widget titles resolve via the platform's existing id-derived i18n key convention. |
| `search` | Similar-incident retrieval via `GET /api/search/search` (feature `search.view`; entity-filtered to incidents); works with fulltext when vector is off. |
| `ai_assistant` | Agents, tools, one-shot routes, `<AiChat>` via direct import of exported `runAiAgentObject` (no DI seam; core already depends on the package) + error-mapped availability probe. Soft. |
| all modules (via events) | user-configurable auto-incident triggers: one wildcard `event:'*'` subscriber matching `incident_trigger` rows + the platform `EventSelect`/`GET /api/events` catalog. |
| `workflows` / `business_rules` | Follow-up: incident events trigger workflow definitions; rules gate severity/escalation. Soft. |
| `planner` / `staff` | Read availability / team membership for owner-on-duty; `allowUnregistered`. |
| `communication_channels` | ChatOps lifecycle posting; emit events, channel module subscribes. |

**Anti-patterns (forbidden):** cross-module ORM relations; importing peer entity classes; subscribing to workflow internals; direct payment/integration/AI-provider API calls (AI goes through ai-assistant); emitting incident events from other modules; raw `fetch`.

## Data Models

All tenant/org-scoped, UUID PKs (`gen_random_uuid()`), `created_at`/`updated_at`/`deleted_at`; **`updated_at` returned in list/detail responses** for optimistic locking on editable entities. Mirror `customers/data/entities.ts` decorator/import style — the repo runs **MikroORM version 7**: decorators from `@mikro-orm/decorators/legacy`, `Collection`/`OptionalProps` from `@mikro-orm/core`. `bigint` columns map to `string` in TS (`BigIntType('string')`). Money as BigInt minor units. Entity ids `E.incidents.<entity>`.

### incident (`incidents`)
- `id`, `organization_id`, `tenant_id`
- `number` (string, unique per org+tenant), `title`, `description` (text)
- `incident_type_id` (uuid, FK-id → incident_type, nullable), `severity_id` (uuid, FK-id → incident_severity), `priority` (string nullable)
- `status` (string enum: open/investigating/identified/mitigated/resolved/closed)
- `visibility` (string: internal/restricted)
- `is_drill` (bool, default false), `is_major` (bool, default false)
- `owner_user_id` (uuid nullable), `owning_team_id` (uuid nullable, FK-id), `reporter_user_id` (uuid)
- `detected_at`, `acknowledged_at`, `started_at`, `resolved_at`, `closed_at` (Date nullable)
- `escalation_policy_id` (uuid nullable, FK-id → incident_escalation_policy) — the active policy (resolved on create from type default → settings default)
- `escalation_status` (string enum: `inactive`/`active`/`acknowledged`/`exhausted`, default `inactive`) — the single field the UI and the set-once sweep guards key off
- `escalation_level` (int, default 0) — current 0-based step index within the policy (bounded by `steps.length` × `(repeat_count+1)`)
- `escalation_repeats_done` (int, default 0)
- `next_escalation_at` (Date nullable), `snoozed_until` (Date nullable)
- `escalation_last_targets` (jsonb nullable) — snapshot of the current step's paging, resolved at page-time: `{ targets:[{ type, id, label }], recipients:[{ userId, label }], resolvedAt }` (`targets` = abstract policy targets; `recipients` = the concrete users actually paged)
- `sla_response_due_at`, `sla_resolution_due_at` (Date nullable), `sla_at_risk` (bool default false), `sla_breached` (bool default false)
- `next_update_due_at` (Date nullable) — customer-update cadence due; set on create/severity-change and after each customer-facing timeline entry when a cadence is configured for the severity and the incident is active; cleared on resolve/close
- `update_overdue_notified_at` (Date nullable) — the sweep's set-once claim for a cadence due window (the war-room chip derives "overdue" from it; posting a customer-facing update recomputes `next_update_due_at` and clears this)
- `merged_into_incident_id` (uuid nullable, FK-id → incident; the surviving target when this incident is merged)
- `source_event_ref` (string nullable; idempotency key for auto-created incidents — **partial-unique per (org,tenant) where not null**; format `<eventId>:<sourceEntityId>` or hashed scalar projection)
- `customer_impact_summary` (text, **encrypted**)
- `created_at`, `updated_at`, `deleted_at`

### incident_timeline_entry (`incident_timeline_entries`) — append-only/immutable (no `updated_at`/`deleted_at`)
- `id`, `organization_id`, `tenant_id`, `incident_id`
- `kind` (string, 15-kind inventory): `status_change`/`severity_change`/`assignment`/`role_change`/`note`/`update`/`action`/`ack`/`escalation`/`impact_change`/`reopened`/`merged_into`/`merged_from`/`linked`/`unlinked`/`postmortem_published`/`postmortem_updated`/`system` (the timeline filter presets group these; the zod `kinds` enum enumerates the full set)
- `actor_user_id` (uuid nullable; null = system)
- `body` (text, **encrypted**), `visibility` (string: internal/customer_facing)
- `metadata` (jsonb nullable: from/to values), `created_at`

### incident_participant (`incident_participants`)
- `id`, `organization_id`, `tenant_id`, `incident_id`, `user_id`
- `kind` (string: responder/subscriber), `role_id` (uuid nullable, FK-id → incident_role)
- `created_at`, `updated_at`, `deleted_at` — partial-unique `(incident_id, user_id, kind)` where `deleted_at is null`

### incident_impact (`incident_impacts`) — polymorphic (per-kind optimistic-lock reader override; see `customers/di.ts` precedent)
- `id`, `organization_id`, `tenant_id`, `incident_id`
- `target_type` (string: `customer_person`/`customer_company`/`customer_account`/`sales_order`/`sales_quote`/`sales_invoice`/`sales_credit_memo`/`component`/`service_component`) — there is no unified `sales_document` entity (`SalesDocumentKind` is a TS union of per-kind tables); link the specific kind
- `target_id` (uuid nullable; required except legacy freeform `component`), `component_label` (string nullable; for legacy freeform `component`)
- `impact_status` (string: operational/degraded/partial_outage/major_outage)
- `snapshot` (jsonb — display + metrics only: `{ label, status?, tier? }`; **no PII** — `label` MUST be a non-PII display value: order number, account/company **business** name, service/component name; never a person's name/email; `customer_person` rows never persist `label` and are display-hydrated client-side; `service_component` rows snapshot component key/name/type/criticality/tier/source; live PII re-fetched via enricher)
- `revenue_amount_minor` (bigint nullable, `BigIntType('string')`), `revenue_currency` (string nullable), `revenue_refreshed_at` (Date nullable)
- `created_at`, `updated_at`, `deleted_at`
- **Partial-unique** `(incident_id, target_type, coalesce(target_id::text, component_label))` where `deleted_at is null` — prevents duplicate impact rows for the same target (which would double-count the revenue rollup)

### incident_service_component (`incident_service_components`) — incident-owned service/component catalog
- `id`, `organization_id`, `tenant_id`
- `key` (string, partial-unique per org+tenant where active), `name`, `description`
- `component_type` (string enum: `service`/`component`, default `service`)
- `owner_team_id` (uuid nullable), `owner_user_id` (uuid nullable) — FK-id only; no staff ORM relation
- `criticality` (string: low/medium/high/critical, default `medium`), `tier` (string nullable), `slo_target_basis_points` (int nullable, 0..10000)
- `source_type`/`source_id` (string nullable) — optional soft link to a resources/catalog/source record; no dependency on that module
- `snapshot` (jsonb nullable — external/source metadata safe for display), `is_active`, `created_at`, `updated_at`, `deleted_at`
- Indexes: `(organization_id, tenant_id)`, partial unique `(organization_id, tenant_id, key)`, partial source lookup `(organization_id, tenant_id, source_type, source_id)` where source fields are present

### incident_service_dependency (`incident_service_dependencies`) — lightweight dependency graph
- `id`, `organization_id`, `tenant_id`
- `source_component_id`, `target_component_id` (uuid FK-id values to `incident_service_component`; no ORM relation), `dependency_kind` (string, default `depends_on`)
- `snapshot` (jsonb nullable), `is_active`, `created_at`, `updated_at`, `deleted_at`
- Partial unique `(organization_id, tenant_id, source_component_id, target_component_id, dependency_kind)` where active; source/target indexes for graph expansion

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
- **required-fields-on-resolve gate** reads/writes here: the type's `required_fields_on_resolve` keys (e.g. `root_cause`) are validated against this row on resolve/close; the resolve action auto-creates a `draft` postmortem (if absent) from its `fields` payload, then blocks (400) when any required field is still empty

### incident_link (`incident_links`) — non-destructive related/duplicate associations (distinct from merge, which uses `incident.merged_into_incident_id`)
- `id`, `organization_id`, `tenant_id`, `incident_id`, `linked_incident_id`
- `kind` (string: related/duplicate/caused_by)
- `created_at`, `deleted_at` — partial-unique `(incident_id, linked_incident_id, kind)` where `deleted_at is null`; both incidents scoped to the same (org,tenant)

### incident_trigger (`incident_triggers`) — user-configurable auto-incident triggers
- `id`, `organization_id` (**NOT NULL**), `tenant_id`
- `event_id` (string — platform event id, e.g. `data_sync.run.failed`)
- `is_enabled` (bool, default true)
- `severity_key` (string nullable → default severity when null), `type_key` (string nullable), `escalation_policy_id` (uuid nullable, FK-id → incident_escalation_policy)
- `conditions` (jsonb nullable — `Array<{ path: string, equals: string | number | boolean }>`, AND'd scalar-equality predicates over payload dot-paths; null/empty = always fire)
- `created_at`, `updated_at`, `deleted_at` — **partial-unique** `(organization_id, tenant_id, event_id)` where `deleted_at is null`; **composite index** `(organization_id, tenant_id, event_id, is_enabled)` where `deleted_at is null` (the dispatch hot path); `updated_at` returned by list/detail (optimistic locking default-ON)

### Config catalogs (module-owned; seeded idempotently in `setup.ts`)
- **incident_severity** (`incident_severities`): `key`, `label`, `rank` (int), `color_token` (DS status token name, e.g. `error`/`warning`/`info`), `default_runbook_id` (uuid nullable, FK-id → runbook), `is_default`, `is_active`. Seed: sev1/critical→error, sev2/high→warning, sev3/medium→info, sev4/low→neutral.
- **incident_type** (`incident_types`): `key`, `label`, `default_severity_id` (nullable), `default_role_ids` (jsonb nullable), `default_escalation_policy_id` (uuid nullable, FK-id → policy), `default_runbook_id` (uuid nullable, FK-id → runbook), `required_fields_on_resolve` (jsonb, e.g. `["root_cause"]`), `is_default`, `is_active`. Seed: operational, customer_impacting, security, maintenance.
- **incident_role** (`incident_roles`): `key`, `label`, `is_active`. Seed: commander, comms_lead, scribe, responder.
- **incident_escalation_policy** (`incident_escalation_policies`): `key`, `name`, `is_default`, `is_active`, `steps` (jsonb: `[{ delay_minutes:number (REQUIRED, runtime-authoritative), targets:Array<{ type:'user'|'team'|'role', id:string }>, notify_strategy:'all' }]` — ordered; the array index is the authoritative step number, no separate `level` field), `repeat_count` (int, default 0 — loop from step 0 up to `repeat_count` times before exhaustion). Validation (400): `steps.length >= 1`, every step `delay_minutes >= 0` and `targets.length >= 1`; an `is_active`, non-deleted default policy must exist. Partial-unique `(organization_id, tenant_id, key)` where `deleted_at is null`. `setup.ts` idempotently seeds a default policy (`key='default'`, `is_default=true`, one step `{ delay_minutes: 30, targets:[{type:'role', id:<commander role id>}] }`) so declare-must-escalate holds; if the resolved policy is missing/inactive/empty, escalation stays `inactive` and the war-room shows "No escalation policy" (the runtime never indexes `steps[0]` on an empty policy).
- **incident_runbook** (`incident_runbooks`): reusable response playbook; `key`, `name`, `description`, `is_active`; partial-unique `(organization_id, tenant_id, key)` where `deleted_at is null`.
- **incident_runbook_step** (`incident_runbook_steps`): ordered action-item template; `runbook_id`, `position`, `title`, `description`, `assignee_user_id`, `due_offset_minutes`, `is_active`; partial-unique `(runbook_id, position)` where `deleted_at is null`.
- **incident_settings** (`incident_settings`, one row per org+tenant): `number_format` (default `INC-{yyyy}{mm}{dd}-{seq:4}`), `ack_timeout_minutes`, `escalation_timeout_minutes` (**UI default only** — the value pre-filled for a new step's `delay_minutes` in the policy editor; never a runtime fallback), `default_escalation_policy_id` (uuid nullable), `sla_targets` (jsonb — `{ [severity_key]: { response_minutes:number, resolution_minutes:number, at_risk_pct:number /* default 80 */ } }`), `update_cadence` (jsonb nullable — `{ [severity_key]: { update_minutes:number } }`; absent key ⇒ no cadence for that severity).
- **incident_number_sequence** (`incident_number_sequences`): `current_value` (bigint), unique `(organization_id, tenant_id)`.

## API Contracts

All routes export per-method `metadata` (`requireAuth` + `requireFeatures`) and `openApi`; inputs Zod-validated (`z.infer`, no `any`); writes dispatch registered commands; reads via QueryEngine; HTTP via the route layer. Custom (non-factory) mutating routes run the mutation-guard registry and enforce command-level optimistic locking. Read JSON defensively via `readJsonSafe`.

### CRUD (`makeCrudRoute`) — `incident`
- `GET /api/incidents` — list (filters: status, severity, owner, team, customer, type, date range, `active`, `exclude_drills`, `escalationStatus` [`escalated`/`active`/`acknowledged`/`exhausted`]; `?ids=`; pagination ≤100). Returns `updated_at`, `escalation_status`, `revenue_at_risk`, SLA flags.
- `POST /api/incidents` → `incidents.incident.create` (allocates `number` via `IncidentNumberGenerator`; resolves escalation policy + starts escalation; sets cadence/SLA dues).
- `GET /api/incidents/[id]` — detail (includes participants, impacts, action items, postmortem ref, escalation state, `next_update_due_at`, `updated_at`).
- `PUT /api/incidents/[id]` → `incidents.incident.update` (optimistic-locked; accepts partial `incidentUpdateSchema` for inline type/priority edits).
- `DELETE /api/incidents/[id]` → `incidents.incident.delete` (soft delete).

### Action endpoints (command-style; **command-level optimistic lock on the parent incident aggregate**)
- `POST /api/incidents/[id]/acknowledge` → `acknowledge` (sets `acknowledged_at`, `escalation_status='acknowledged'`, clears `next_escalation_at`; feature `incidents.incident.manage`).
- `POST /api/incidents/[id]/transition` `{ status, fields? }` → `transition_status`. Validates the allowed transition graph server-side. **Required-fields-on-resolve gate:** on `resolved`/`closed`, reads the incident type's `required_fields_on_resolve`; the `fields` payload supplies those values, written into a `draft` `incident_postmortem` (auto-created if absent); rejected 400 (`createCrudFormError` with per-field errors) if any required field is empty. Sets `resolved_at`/`closed_at`.
  - **Resolve cascade:** clear per-component impact statuses to `operational`, cancel escalation (`next_escalation_at=null`, `escalation_status='inactive'`), snooze (`snoozed_until=null`), and cadence (`next_update_due_at=null`).
  - **Close cascade (superset of resolve):** everything resolve does, **plus** mark responder/subscriber participations closed and stop all timers; a closed incident is immutable except via `reopen` (which clears `resolved_at`/`closed_at`, restores `open`/`investigating`, and appends a `reopened` timeline entry preserving prior context).
- `POST /api/incidents/[id]/severity` `{ severityId }` → `change_severity` (recomputes SLA + cadence dues; returns `{ ok, updatedAt }`).
- `POST /api/incidents/[id]/assign` `{ ownerUserId?, owningTeamId? }` → `assign` (returns `{ ok, updatedAt }`).
- `POST /api/incidents/[id]/escalate` → `advance_escalation` (manual; rich body; preconditions/exhaustion per Architecture). `GET /api/incidents/[id]/escalate/preview` → who-will-be-paged preview.
- `POST /api/incidents/[id]/snooze` `{ until }` → `snooze`.
- `POST /api/incidents/[id]/runbook/instantiate` `{ runbookId? }` → `incidents.runbook.instantiate` (resolves explicit runbook, then incident type default, then severity default; creates idempotent action items from active steps).
- `POST /api/incidents/[id]/merge` `{ targetId }` → `merge`. **Semantics:** merging source `[id]` into `targetId` sets `source.merged_into_incident_id = targetId` and `source.status='closed'` (the source **retains its own number**); copies the source's still-active `incident_impact` and open `incident_action_item` rows onto the target (de-duplicated by the impact partial-unique); appends a `merged_into`/`merged_from` timeline entry to both incidents; the source becomes read-only (further writes rejected 409/`[internal] merged`); the source-close cascade clears escalation/snooze; the target is re-locked (`PESSIMISTIC_WRITE` re-check inside the transaction). Guarded by command-level optimistic lock on **both** aggregates.
- `POST /api/incidents/[id]/link` `{ targetId, kind }` → `link` (non-destructive) — inserts an `incident_link` row (`kind` ∈ related/duplicate/caused_by), idempotent on the partial-unique; appends a `linked` timeline entry.
- `POST /api/incidents/bulk` `{ action:'close'|'acknowledge'|'assign'|'change_severity'|'subscribe', ids:string[], params }` → **202** + `{ progressJobId }`. Enqueues a `ProgressJob` + worker (queue `incidents-bulk-ops`) that applies the per-id command with per-id error isolation; `requireFeatures` matches the underlying action.
- `POST /api/incidents/[id]/timeline` `{ kind, body, visibility }` → `timeline_entry.add`.
- `GET /api/incidents/[id]/timeline` — list entries (visibility-filtered by feature; additive `kinds` [csv enum] + `visibility` [`internal`/`customer_facing`] filters; `page`/`pageSize`; `total` reflects the filter — find + count share the where clause). Invalid `kind` → 400.
- `POST|PUT|DELETE /api/incidents/[id]/participants[/[pid]]` → participant commands.
- `POST|PUT|DELETE /api/incidents/[id]/impacts[/[iid]]` → impact commands (PUT sets `impact_status`; the `impact.add` command takes `snapshot`/`revenueAmountMinor`/`revenueCurrency` from the client, populated by `RecordSelect` from the picked record's list-API result). `service_component` targets must resolve to an active `incident_service_component` in the same scope and are snapshotted server-side. `POST /api/incidents/[id]/impacts/recompute` → refreshes revenue metrics from live `sales`/`customers` (soft-optional).
- `GET /api/incidents/[id]/service-context` → impacted service components, legacy freeform component labels, and first-hop dependency edges for the incident (read-only, `incidents.incident.view`).
- `POST|PUT|DELETE /api/incidents/[id]/action-items[/[aid]]`; `POST .../action-items/[aid]/complete`.
- `POST|PUT /api/incidents/[id]/postmortem`; `POST .../postmortem/publish`.

### Config (`makeCrudRoute`)
- `/api/incidents/severities`, `/api/incidents/types`, `/api/incidents/roles`, `/api/incidents/escalation-policies`, `/api/incidents/runbooks`, `/api/incidents/runbook-steps`, `/api/incidents/settings` (`incidents.settings.manage`).
- `/api/incidents/service-components`, `/api/incidents/service-dependencies` — GET is `incidents.incident.view` so impact pickers/context panels can read them; POST/PUT/DELETE are `incidents.settings.manage`. Components support search/key/type/criticality/source filters; dependencies support source/target/component filters.
- `/api/incidents/triggers` — CRUD (`incidents.settings.manage`; `list.entityId`/`indexer.entityType` `E.incidents.incident_trigger`). Zod: `event_id` non-empty, must not start with `incidents.`, and must not be marked `excludeFromTriggers` in the declared-event registry (ids absent from the registry are allowed — the source module may be temporarily disabled — but flagged in the UI); `conditions` validated against the predicate schema; `severity_key`/`type_key` validated against catalogs; `escalation_policy_id` must resolve when present.

### AI (all `requireAuth` + `requireFeatures: ['incidents.incident.view','incidents.ai.use']`, POST, zod-validated, `openApi`; call `runAiAgentObject` inside try/catch; graceful structured 503 when AI absent; no persistence)
- `GET /api/incidents/ai/availability` → `{ available:boolean, reason?:'no_provider'|'runtime_missing' }` — view-gated cheap model-factory probe (classifies `AiModelFactoryError` `no_provider_configured` and `api_key_missing` as unavailable). The client derives a `forbidden` reason locally when the request 403s.
- `POST /api/incidents/[id]/ai/summary` → `{ summary, keyEvents[] }` (from timeline; rendered in an AI card; optional "Post as internal note" submits through the guarded timeline mutation).
- `POST /api/incidents/[id]/ai/customer-update` → `{ draft }` (pre-fills the customer-facing composer).
- `POST /api/incidents/[id]/ai/postmortem-draft` → postmortem fields + suggested action items (pre-fills the form).
- `POST /api/incidents/ai/triage` `{ title, description? }` → `{ severityKey, typeKey, priorityKey?, rationale, possibleDuplicateIds[] }` (create-form "Suggest with AI"). Its unavailable path returns the typed 503 (the create page keeps AI-independent duplicate hints via the similar-incidents search). AI error routes map the runtime's `AiModelFactoryError.code` (`no_provider_configured`, `api_key_missing`) into the response `code`; `ai_failed` is the generic fallback for non-factory errors; the full error is logged server-side, never returned as raw text.

### Portal
- `GET /api/incidents/portal` — incidents affecting the authenticated customer's account (server-derived scope from `customer_accounts`; `requireCustomerFeatures: ['portal.incidents.view']`). Returns only customer-facing fields/updates.

## Access Control & Setup

`acl.ts` features (`<module>.<entity>.<action>`, immutable): `incidents.incident.view/create/manage/assign/close/escalate`, `incidents.postmortem.view/manage`, `incidents.settings.manage`, `incidents.ai.use`; portal: `portal.incidents.view`. `setup.ts`:
- `defaultRoleFeatures`: `admin: ['incidents.*']`; `employee: ['incidents.incident.view','...create','...manage','...assign','...escalate','incidents.postmortem.view','incidents.postmortem.manage','incidents.ai.use']`; customer/portal roles (portal_admin/buyer/viewer) grant `portal.incidents.view`.
- `seedDefaults` (idempotent, check-before-insert): severity/type/role catalogs, a default `incident_escalation_policy`, `incident_settings` row, two default `incident_trigger` rows for new tenants only (`data_sync.run.failed` enabled; `integrations.state.updated` enabled with `conditions:[{ path:'reauthRequired', equals:true }]`) — respecting soft-deleted default triggers (no resurrection), and register the escalation-sweep schedule via `SchedulerService.register()`. Catalog-label keys need no seeding (render-time i18n resolution).
- After implementation: `yarn mercato auth sync-role-acls` (the ops remedy for upgraded tenants missing new grants; the `forbidden` AI affordance improves discoverability).

## Encryption & GDPR

`incidents/encryption.ts` exports `defaultEncryptionMaps` for: `incident.customer_impact_summary`; `incident_timeline_entry.body`; `incident_postmortem.summary/root_cause/impact/contributing_factors/lessons`. All reads via `findWithDecryption`/`findOneWithDecryption` (5-arg) with `{ tenantId, organizationId }`. No equality lookups on encrypted columns (no hash fields needed). Impact `snapshot` deliberately excludes PII (person names/emails re-fetched live). No hand-rolled crypto. AI drafts are not persisted by AI routes — generated drafts live in form state until the human saves through the existing encrypted fields; prompt content stays within this encryption-scope decision.

> **Encryption-scope decision (explicit).** `incident.title`/`incident.description` and `incident_action_item.title/description` are **operational, internal-only text** (systems/services/remediation, RBAC-gated to `incidents.*`) and are **deliberately NOT encrypted** so they remain fulltext/vector **searchable** (`search.ts` indexes `title`/`description`). Encrypting them would defeat search and they are not the PII surface. **All customer/person PII belongs in the encrypted fields** (`customer_impact_summary`, timeline `body`, postmortem free-text). The impact `snapshot.label` MUST be a non-PII display value (order number / business account name / component name), enforced by review + a test asserting the snapshot never persists an email/person-name; `customer_person` impact snapshots strip `label` server-side (PII defense-in-depth).

## Search

`incidents/search.ts`: tokens + fulltext + vector over `incident` — index `number`, `title`, `description`, status, severity label; impact/customer notes `hashOnly`; no secrets. Tokens entity has `formatResult` (→ `/backend/incidents/<id>`); vector `buildSource` paired with `checksumSource`. Similar-incident retrieval reads this index via the platform `GET /api/search/search` (no new route), working with fulltext when vector is off.

## AI

The AI layer is human-in-the-loop and soft-optional (hidden when ai-assistant/provider is absent, never auto-mutating). It uses `defineAiAgent`, `defineAiTool`, and `<AiChat>`, calling the exported `runAiAgentObject` from `@open-mercato/ai-assistant` (no DI seam exists; core already depends on the package; precedent `customers/ai-tools/deals-pack.ts`).

**Agents** (`ai-agents.ts`; ids FROZEN on release): five agents so each output has a registered zod schema —
- **`incidents.assistant`** — `executionMode:'chat'`, embedded via `<AiChat agent="incidents.assistant" />` in a war-room side sheet; `resolvePageContext` injects the current incident id; `requiredFeatures:['incidents.incident.view','incidents.ai.use']`; `mutationPolicy:'confirm-required'`.
- **`incidents.triage`** — `executionMode:'object'`, `output: z.object({ severityKey, typeKey, priorityKey: z.string().optional(), rationale, possibleDuplicateIds: z.array(z.string()) })`; `readOnly`.
- **`incidents.postmortem_writer`** — `executionMode:'object'`, `output`: the postmortem field set + suggested action items; `readOnly`.
- **`incidents.summarizer`** and **`incidents.customer_update_writer`** — `executionMode:'object'`, backing the summary and customer-update routes.

**Tools** (`ai-tools.ts`; ids FROZEN on release), each with explicit per-tool `requiredFeatures`: `incidents.list_incidents`, `incidents.get_incident` (detail + timeline + impacts), `incidents.find_similar_incidents` (search API) — all `['incidents.incident.view','incidents.ai.use']`; `incidents.add_timeline_note` (**the only mutation tool**; routes through `prepareMutation`; `['incidents.incident.manage','incidents.ai.use']`).

**Never auto-mutate:** no AI path writes without an explicit user submit (or a `prepareMutation` approval in chat). The client maps error `code` → i18n message (distinct texts for `no_provider_configured`, `api_key_missing`, permission/HTTP 403, not-found, generic) via a shared `lib/aiErrors.ts`, rendering cause-specific guidance rather than a blanket flash. A bare-host `ANTHROPIC_BASE_URL` is normalized in the Anthropic adapter (`packages/ai-assistant/src/modules/ai_assistant/lib/llm-adapters/anthropic.ts`): it resolves `options.baseURL ?? process.env.ANTHROPIC_BASE_URL`, appends the Anthropic API version path segment (the SDK's default versioned path prefix) only when the URL path is empty or `/` (path-ful relay/gateway URLs untouched), with a one-line warn on normalization — an additive behavior fix with no signature change.

## Internationalization (i18n)

All strings via `useT()` / `resolveTranslations()` in en/de/es/pl. Namespace `incidents.*`: `nav.*`, `incident.{form,fields,status,severity,actions}.*`, `timeline.*`, `participants.*`, `impact.*`, `postmortem.*`, `escalation.*`, `settings.*`, `notifications.*`, `catalog.*`, `ai.*`, `errors.*`, `portal.*`. Internal-only `throw`/`toast` messages prefixed `[internal]`. Requirements:
1. **Real translations, not key parity:** every `pl.json`/`de.json`/`es.json` value is a genuine translation in the repo's existing voice (see `customers`/`sales` locales), except an explicit allowlist of legitimately-identical technical terms (`MTTA`, `MTTR`, `SLA`, `OK`, product-name-like strings).
2. **Catalog labels** resolve at render time through `resolveCatalogLabel(t, kind: 'severity'|'type'|'role', key, storedLabel)` (`backend/incidents/lib/catalogLabels.ts`, client-safe) → `t(\`incidents.catalog.${kind}.${key}\`)` when the key exists, else the stored label. Applied via one shared helper so list/detail/selects/settings/portal/notification renderers agree; seeded keys (`sev1..sev4`, `operational`, `customer_impacting`, `security`, `maintenance`, `commander`, `comms_lead`, `scribe`, `responder`) get entries in all 4 locales. User-created custom entries keep their typed label. Participant roles resolve via a `RoleSelect`/`useRoleLabel` pairing; timeline actors resolve via `useUserLabels`.
3. **Dashboard widgets:** add the platform's existing id-derived convention keys for `incidents-active`, `incidents-mtta-mttr`, `incidents-revenue-at-risk` (title/description) in all 4 locales — no shared-type change (the dashboard render site already resolves id-derived keys with a `metadata.title` fallback).
4. **Nav/meta audit:** every incidents `page.meta.ts` (list, create, detail, settings, postmortems) and the portal page carry `pageTitleKey`/`pageGroupKey`/breadcrumb `labelKey`s, verified against how sibling modules name shared groups.
5. **Regression guard:** `__tests__/i18n-locale-coverage.test.ts` flattens `en` vs each locale and **fails** the build when a non-allowlisted value is byte-identical to English or a key is missing — the coverage key-sync cannot catch.
6. `yarn i18n:check-sync` and module-scoped `yarn i18n:check-hardcoded` stay green.

## UI/UX

> DS mandatory (`.ai/ds-rules.md`, `.ai/ui-components.md`): semantic status tokens only (severity→status: critical→`error`, high→`warning`, medium→`info`, low→neutral; resolved/closed→`success`) — no `text-red-*`/`bg-green-*`, no arbitrary sizes, no inline `<svg>` (lucide-react with `aria-label`), shared primitives (`StatusBadge`, `Alert`, `FormField`, `SectionHeader`, `EmptyState`, `LoadingMessage`/`Spinner`, `RecordNotFoundState`, `ErrorMessage`, `DetailTabsLayout`, `DetailFieldsSection`/`DetailFieldConfig`). Dialogs: `Cmd/Ctrl+Enter` submit, `Escape` cancel. `pageSize ≤ 100`. Buttons never truncate (labels size the button, `whitespace-nowrap`; toolbars wrap instead of clipping); data values may truncate but carry a `title` tooltip; a Polish-mode audit verifies every page (with before/after evidence). AI guidance notices use `Alert` (info for "not configured", warning for permission). Day headers are muted uppercase micro-headers per the DS type scale.

1. **List** `/backend/incidents` — `DataTable` (`tableId/entityId` `incidents.list`, `extensionTableId`): number, title, severity badge, status, owner, team, affected-customers count, revenue-at-risk, **escalation** (per-row status badge — escalating/acknowledged/exhausted, or muted "not set"), SLA badges, age, updated. Filters as above incl. an **Escalation** filter (`?escalationStatus=…`); saved views via `perspectives`; **bulk actions** (close/acknowledge/assign/severity/subscribe) via DataTable bulk + `ProgressJob`. Stable `RowActions` ids (`open`/`edit`/`delete`).
2. **War-room detail** `/backend/incidents/[id]` — CRM-grade composite page (not a CrudForm). Distinct loading / not-found (`RecordNotFoundState`) / error states. Real-time via `useAppEvent('incidents.*', …)`; background refreshes never unmount the page or flash the loader (full-page loader only on first load, via a `hasLoadedOnceRef` guard).
   - **Status/escalation header (permanently visible rail):** number + title, severity badge, status pill, owner, age + SLA/escalation/cadence timers; a dedicated **Escalation card** with a live state line (`Escalating — Level 2 of 3` / `Acknowledged by Jane` / `Not escalated` / `Escalation exhausted — unacknowledged`), a "Notified: **Platform Team** (Alice, Bob)" line from `escalation_last_targets` (role labels via the catalog, team labels via staff lookup — no raw UUIDs), a countdown to the next step, and a "View policy" popover rendering the shared `EscalationPathPreview`. Actions: **Acknowledge** (stops escalation; hidden on resolved/closed), **Change status / Resolve / Close**, **Escalate now** (opens the who-will-be-paged preview dialog; gated on a non-terminal `canEscalate` flag), **Declare major**, **Snooze**, **Reopen**, and a consolidated **More** popover (Link / Merge) with complete labels. Writes via `useGuardedMutation` + `surfaceRecordConflict`.
   - **Main column** — `DetailTabsLayout` with tabs **Timeline | Impacts | Action items | Postmortem** (badge counts where cheap). Description joins the Timeline tab above the feed.
     - **Timeline:** chronological chat-oriented feed (oldest → newest flowing down toward a permanently-visible bottom composer); day-grouped headers (Today / Yesterday / localized date); composer with **internal-note vs customer-facing-update** toggle, @-mentions (`messages`), attachments; **filter tabs** (All | Updates & notes | Status | Escalations | System) as presets over the kind inventory that refetch page 1 with the preset's `kinds`; a "Load older entries (N)" control above the feed that fetches and prepends the next page (de-duplicated by entry id), loading the 20 most recent initially; on `incidents.timeline_entry.added` it refetches page 1 with the active filter and merges/dedupes by id **without** resetting loaded pages or toggling the loader.
    - **Impacts:** affected customers/accounts (link to CRM) with **revenue-at-risk rollup** (Σ active impacts' metrics, single-currency; multi-currency shown per-currency; "as of <refreshed_at>" stamp, not claimed live), affected orders/sales-docs, legacy freeform components, and cataloged `service_component` impacts with dependency context. The add-impact flow uses `RecordSelect` async pickers over peer list APIs and `/api/incidents/service-components` (auto-capturing the picked record's label + amount/currency into the snapshot, except `customer_person` which is display-hydrated client-side and never stored); legacy `component` targets use a "Component name" text field with datalist suggestions from labels already on the incident; `customer_account` is absent from the type dropdown (no guarded admin list route — the validator still accepts it for BC); rows without a stored label resolve lazily client-side (batched per type via the same source endpoints, `?ids=`), unresolved ids keep the shortened-UUID fallback. A contract-tier hint ("**Enterprise** customer affected — consider SEV1 / SLA tier") is surfaced as a non-binding suggestion.
     - **Action items** panel + **Postmortem** section (post-resolution; required-fields gate; "Draft from timeline" fills the form via the AI route).
   - **Sidebar** — CRM inline-edit fields (`DetailFieldsSection`/`DetailFieldConfig` with select editors fed by the loaded catalogs): severity → `POST …/severity`; owner/team → `POST …/assign`; type/priority → `PUT /api/incidents` (partial schema). Each save sends the optimistic-lock header and refreshes the tracked `updatedAt` from the response before the next edit; conflicts surface via `surfaceRecordConflict`. Status transitions keep explicit action buttons (guarded state machine — not an inline dropdown). Also: responders & roles (`RoleSelect` resolving role labels), subscribers, custom fields, an **AI summary** card (Summarize → summary + key events, "Post as internal note"; availability-gated with cause-specific guidance), and a **Similar incidents** card (top 5 with severity/status badges linking to incidents; search-API backed, no AI dependency).
   - Injection spots exposed: `detail:incidents.incident:header|tabs|sidebar|timeline-actions`, `crud-form:incidents.incident:fields`.
3. **Create** `/backend/incidents/create` — `CrudForm`: title, type, severity, description, owner, team, affected customers/orders (async `RecordSelect` selects hydrated as value+options), customer-impact summary. A **"Suggest with AI"** action (when available + title non-empty) calls the triage route and proposes severity/type/priority with a one-line rationale and duplicate-warnings above submit (fields stay editable); a Similar-incidents card (debounced on title) surfaces history without AI. `createCrud`/`createCrudFormError`; conflict via `surfaceRecordConflict`.
4. **Settings** `/backend/incidents/settings` — severity scale, types, roles, an **Escalation Policies** manager (ordered step editor: delay + user/team/role targets via staff lookup + strategy; `repeat_count`; `is_default`; per-type default policy selector; a live `EscalationPathPreview`), an **SLA-targets matrix editor** (per-severity response/resolution/at-risk %), an **update-cadence matrix** next to SLA targets, and an **Auto-incident triggers** manager (table + add/edit dialog with the platform `EventSelect` [`excludeModules:['incidents']`, `excludeFromTriggers` honored], severity/type/policy selects, enable toggle). `incidents.settings.manage`.
5. **Postmortems** `/backend/incidents/postmortems` — centralized postmortem list (`/api/incidents/postmortems`).
6. **Cross-module injections** — CRM customer detail "Incidents" tab/widget (enricher `_incidents` + injection); order/sales-doc "affected by incident" banner; dashboards active-incidents + MTTA/MTTR + revenue-at-risk widgets; in-app notifications.
7. **Portal** `frontend/[orgSlug]/portal/incidents` — `requireCustomerAuth` + `requireCustomerFeatures: ['portal.incidents.view']`; account-scoped read-only list/detail showing customer-facing updates only; live via portal event bridge.

Shared UI: `EventSelect` (packages/ui) gains an optional `excludeModules?: string[]` prop (ADDITIVE-ONLY; default unchanged) so a module's own events can be hidden from its trigger picker; server zod remains the hard guard. `DetailTabsLayout` is promoted from `customers/components/detail/` into `@open-mercato/ui/backend/detail/` (additive new export; in-repo customers imports updated to the new path) so incidents can reuse it without a cross-module import; `DetailFieldsSection`/`DetailFieldConfig` already live there.

## Configuration

- No new env vars required. Optimistic locking honors `OM_OPTIMISTIC_LOCK`. Search honors `OM_SEARCH_ENABLED`. AI honors the ai-assistant provider config. Sweep cadence is a module constant (default 60s) overridable per-tenant via `incident_settings`.

## Migration & Backward Compatibility

Greenfield — **no existing surface is broken** (all additive). Everything introduced becomes a FROZEN/STABLE contract surface on release, so it must be right the first time:

| Surface | New value | Class |
|---|---|---|
| Module id | `incidents` | FROZEN |
| Event IDs | `incidents.*` (incl. `escalation_started`/`escalated`/`escalation_exhausted`, `update_overdue`, `customer_updated`, `trigger.*`) | FROZEN |
| Widget spot IDs | `detail:incidents.incident:*`, `crud-form:incidents.incident:fields` | STABLE (public) |
| API routes | `/api/incidents/*` (incl. escalate/preview, impacts/recompute, service-context, service-components, service-dependencies, escalation-policies, triggers, ai/*, portal) | STABLE |
| DB schema / entity ids | `incident*` tables, `E.incidents.*` (incl. `E.incidents.incidentEscalationPolicy`, `E.incidents.incident_runbook`, `E.incidents.incident_runbook_step`, `E.incidents.incident_service_component`, `E.incidents.incident_service_dependency`, `E.incidents.incident_trigger`) | FROZEN |
| ACL feature ids | `incidents.*` (incl. `incidents.ai.use`), `portal.incidents.view` | FROZEN (DB-stored) |
| Notification type ids | `incidents.*` (escalation/assignment/impact/account-manager/update_overdue) | FROZEN |
| AI agent / tool ids | `incidents.{assistant,triage,summarizer,customer_update_writer,postmortem_writer}`; `incidents.{list_incidents,get_incident,find_similar_incidents,add_timeline_note}` | FROZEN |
| DI keys | `incidentNumberGenerator`, optimistic-lock readers | STABLE |
| Enriched field namespace | `_incidents` on customers/sales responses | STABLE (contract) |
| Custom-entity id | `incidents:incident` (`ce.ts`) | STABLE |
| Shared UI prop | `EventSelect.excludeModules?: string[]`; `DetailTabsLayout` moved to `@open-mercato/ui/backend/detail` | ADDITIVE-ONLY / additive export |
| ai-assistant | Anthropic adapter bare-host `ANTHROPIC_BASE_URL` normalization | additive behavior fix (no signature change) |

**Inbound dependency:** auto-incident triggers rely on peer event IDs being exactly correct (a wrong id means the trigger never fires). Implementation MUST verify each seeded/default trigger event against the source module's `events.ts`. Migrations via `yarn db:generate` (review SQL + snapshot, commit both; delete unrelated generator output per repo rule). Deployable without downtime; new tables only; no backfill.

## Implementation Plan

> One lean commit per step; run `yarn generate` after discovery-file changes; `yarn db:generate` after entity changes. Each phase ends green (typecheck/lint/test + its integration tests).

### Phase 1 — Foundation (entity + CRUD + catalogs + numbering)
- Scaffold module (`index.ts`, `di.ts`, `acl.ts`, `setup.ts`, `ce.ts`, `events.ts`, `search.ts`, `translations.ts`, `encryption.ts`, i18n en/de/es/pl).
- Entities: `incident` + config catalogs (`incident_severity/type/role/escalation_policy/runbook/runbook_step/settings`, `incident_number_sequence`). `yarn db:generate` (+snapshot).
- `IncidentNumberGenerator` service (atomic upsert) + DI registration + optimistic-lock reader for `incident`.
- Zod validators; `commands/incident.ts` (create/update/delete, undoable); `makeCrudRoute` for `/api/incidents` (+`openApi`); config CRUD routes.
- `setup.ts` seeds catalogs + default policy + settings (idempotent); `defaultRoleFeatures`; `search.ts`.
- List page (`DataTable`) + create form (`CrudForm`) + minimal detail + `page.meta.ts`.
- **Tests:** CRUD happy/validation, RBAC 403, tenant isolation, optimistic-lock 409, number-sequence concurrency (parallel creates → unique numbers), settings/catalog CRUD.

### Phase 2 — Timeline, participants, roles, notifications, escalation lifecycle
- `incident_timeline_entry` (immutable) + `incident_participant`; commands (`timeline_entry.add`, participant add/update_role/remove); action endpoints with command-level optimistic lock on the incident aggregate.
- Acknowledge + transition_status + change_severity + assign + `advance_escalation` (internal) commands/endpoints (transitions validated; escalation lifecycle; escalate rich body + preview).
- CRM-grade war-room detail composition (status/escalation rail + `DetailTabsLayout` main column + inline-edit sidebar); internal/customer-facing composer; timeline filter tabs + day grouping + realtime merge; attachments + @-mentions (soft-optional).
- `notifications.ts`/`.client.ts`/`.handlers.ts`: notify owner/team/subscribers/mentions and escalation targets on key transitions (idempotent, `features`-gated, de-dup + actor-suppression + recipient dedupe keys).
- **Tests:** ACK sets `acknowledged_at` + halts escalation; transition gate; concurrent timeline/assign → 409; escalation advance/exhaustion + preview; notification fan-out de-dup; visibility filtering.

### Phase 3 — Customer/order impact + revenue rollup + CRM/sales surfacing
- `incident_impact` (polymorphic) + per-kind optimistic-lock override; commands (add/update_status/remove); revenue-at-risk rollup from stored metrics; `impacts/recompute` action + `impact-refresh` subscriber on order-change events (self-heal).
- `incident_service_component` + `incident_service_dependency` (incident-owned service catalog + first-hop dependency context); `service_component` impact target; `GET /api/incidents/[id]/service-context`.
- `RecordSelect` pickers (auto-label capture, `?ids=` hydration, service-component picker, component-name field, `customer_account` dropped from dropdown, lazy label resolution); contract-tier hint; per-owner account-manager notification.
- `data/enrichers.ts` `_incidents` (enrichMany, `features`-gated, timeout/fallback) on customers (person/company/account) + sales order responses; widget injection (account tab; order banner).
- **Tests:** impact add/link; revenue rollup = Σ metrics; recompute from live data; duplicate-target 409; enricher (no N+1, fallback on timeout); injection renders; cascade clears on resolve; account-manager notification to owner only.

### Phase 4 — Escalation sweep, ACK timeout, SLA, snooze, customer-update cadence
- `workers/escalation-sweep.ts` (queue `incidents-escalation-sweep`, `concurrency:1`); register schedule in `setup.ts`.
- Escalation auto-advance via atomic conditional claim; SLA dues + at-risk/breach set-once; snooze + expiry resume; overdue-action reminders; customer-update cadence (`next_update_due_at` set/reset in create/severity/transition/timeline; sweep due-check emits `update_overdue` + notification).
- List/detail SLA + escalation + cadence indicators.
- **Tests:** sweep idempotency (double-tick no dup), ack-timeout escalation fires, snooze suppresses then expires, SLA breach set-once, cadence emits once per due window + resets on customer-facing update + clears on resolve, scope isolation (one tenant's sweep never touches another).

### Phase 5 — Postmortems, action items, merge/link, reopen, required-on-resolve
- `incident_postmortem` + `incident_action_item`; commands; required-fields-on-resolve gate; merge/link + reopen; postmortem section + action-items panel + centralized postmortems list.
- **Tests:** required-fields blocks resolve; action item lifecycle; merge sets relation + timeline + closes/clears escalation + source read-only; reopen preserves context.

### Phase 6 — Portal, bulk ops, perspectives, auto-incident triggers, dashboards
- Portal `frontend/[orgSlug]/portal/incidents` + `portalBroadcast` `customer_updated`; `GET /api/incidents/portal`.
- Bulk actions via `ProgressJob` + worker (`incidents-bulk-ops`); perspectives saved views.
- `incident_trigger` entity + migration + validators + CRUD route + events + `subscribers/auto-incident-dispatch.ts` (wildcard, loop-guard, `source_event_ref` dedupe, per-trigger severity/type/policy/conditions); settings trigger manager driven by `EventSelect`.
- `dashboards` widgets (active/MTTA/MTTR/revenue-at-risk via analyticsRegistry).
- **Tests:** portal scope (customer sees only own-account, customer-facing fields only, cross-account 403); bulk progress + per-id isolation; trigger CRUD (validation incl. `incidents.*` rejection, RBAC, tenant isolation, optimistic lock); dispatch creates once per `source_event_ref` under redelivery, respects disabled, loop-guard, applies severity/type/policy; dashboard widget data.

### Phase 7 — AI layer, i18n completeness, UX polish
- `ai-agents.ts` (5 agents) + `ai-tools.ts` (4 tools; `add_timeline_note` via `prepareMutation`) + `incidents.ai.use` ACL + grants + `yarn generate`.
- AI routes (`availability`, `triage`, `summary`, `customer-update`, `postmortem-draft`) with `runAiAgentObject`, zod, `openApi`, graceful 503 + typed error codes + `lib/aiErrors.ts` client mapping; Anthropic base-URL normalization.
- War-room AI card + composer draft button + `<AiChat>` side sheet; create-form triage suggest; postmortem draft button; similar-incidents card.
- i18n completeness: translate all EN-identical `pl/de/es` values (allowlist file), `catalogLabels.ts` + `incidents.catalog.*` keys, dashboard-widget locale keys, nav/meta audit, `__tests__/i18n-locale-coverage.test.ts` guard.
- Escalation-path preview shared component; SLA matrix + update-cadence editors; Polish-mode truncation pass (button rules; screenshots as evidence).
- **Tests:** availability=false hides surfaces + routes 503 i18n'd; triage validation; tool RBAC (mutation tool needs `manage`; agents need `incidents.ai.use`); similar-incidents renders from search; locale-coverage guard; catalog-label resolver fallback; base-URL normalization; `EscalationPathPreview` label resolution.

### File Manifest (abridged)
| File | Action | Purpose |
|---|---|---|
| `packages/core/src/modules/incidents/{index,di,acl,setup,ce,events,search,encryption,translations,ai-agents,ai-tools}.ts` | Create | Module wiring + AI |
| `…/data/{entities,validators,extensions,enrichers}.ts` | Create | Entities, Zod, links, `_incidents` enricher |
| `…/services/incidentNumberGenerator.ts` | Create | Atomic per-tenant numbering |
| `…/commands/*.ts` (+`index.ts` barrel) | Create | Undoable mutations |
| `…/api/**/route.ts` + `api/openapi.ts` | Create | CRUD + action + trigger + AI + portal routes |
| `…/backend/incidents/{page.tsx,page.meta.ts,create/page.tsx,[id]/page.tsx,settings/page.tsx,postmortems/page.tsx}` + `lib/{catalogLabels,aiErrors}.ts` + `components/*` | Create | Backoffice UI |
| `…/frontend/[orgSlug]/portal/incidents/{page.tsx,page.meta.ts}` | Create | Portal view |
| `…/workers/escalation-sweep.ts`, `…/subscribers/{auto-incident-dispatch,impact-refresh}.ts` | Create | Sweep + auto-incident + revenue self-heal |
| `…/widgets/{injection,injection-table}.ts` | Create | CRM/sales injection |
| `…/notifications{,.client,.handlers}.ts`, `…/i18n/{en,de,es,pl}.json` | Create | Notifications + i18n |
| `…/migrations/*` + `.snapshot-open-mercato.json` | Create | Schema |
| `packages/ui/src/backend/detail/DetailTabsLayout.tsx`; `packages/ui/.../EventSelect.tsx`; `packages/ai-assistant/.../anthropic.ts` | Create/Edit | Promoted layout, additive prop, base-URL fix |

## Integration Test Coverage

Self-contained (API fixtures created in setup, cleaned in teardown; no seeded-data reliance; policy-compliant passwords; randomized unique codes). Workers=1 where undo/round-trip is asserted.

**API paths:** incidents CRUD (happy/validation/RBAC/tenant-isolation/optimistic-lock 409/`?ids=`); number-sequence concurrency (parallel creates → unique numbers); every action endpoint (acknowledge → halts escalation, transition incl. required-fields-on-resolve 400 gate + resolve cascade + close cascade + reopen-preserves-context, severity, assign, snooze, merge [source closed, number retained, impacts/action-items moved, both timelines annotated, source read-only 409, escalation cleared] and link [idempotent]); escalation-policy CRUD + default resolution; escalate advances exactly one step + rich body, escalate past last step → 409 exhausted, `escalate/preview` returns next-step recipients, sweep auto-advances after `delay_minutes` (seeded past `next_escalation_at`), double-tick advances at most one step, exhaustion sets status + emits event once, snooze suppresses then resumes; timeline add + visibility filtering + `kinds`/`visibility` filter matrix (invalid kind → 400, `total` reflects filter) + aggregate 409 (sub-resource write bumps parent `updated_at`); participants/impacts (duplicate-target rejected)/action-items/postmortem CRUD; service-component/dependency CRUD (duplicate 409, self-loop 400, cascade soft-delete, RBAC view-vs-manage, optimistic-lock 409) + service-context tenant isolation; runbook instantiate (idempotent re-run, 404 for out-of-scope incident, RBAC `incidents.incident.manage`); revenue-at-risk rollup = Σ metrics + `impacts/recompute`; enricher `_incidents` (no N+1, fallback on timeout); per-owner account-manager notification to owner only; config CRUD; escalation sweep + SLA at-risk/breach set-once + customer-update cadence (due set on create per settings, sweep emits `update_overdue` once, customer-facing entry resets, resolve clears) + scope isolation; trigger CRUD (validation incl. `incidents.*` rejection, RBAC, tenant isolation, optimistic-lock 409, `?ids=`); wildcard dispatch (enabled trigger + synthetic peer event → incident created with trigger's severity/type/policy, redelivery creates exactly one via `source_event_ref`, disabled trigger → none, `incidents.*` event → never, absent scope → no-op); AI routes (availability false ⇒ 503 with i18n'd body + probe false/`reason`, user without `incidents.ai.use` → availability 403 mapped to `forbidden`, triage input validation 400, tool RBAC, postmortem-draft typed `code`); portal API (own-account-only, customer-facing-only, cross-account 403); bulk endpoint (202 + progress, per-id error isolation).

**UI paths (Playwright):** create incident (+ triage suggest fills severity/type/priority, hidden when AI unavailable); war-room ACK + transition + resolve-with-required-fields; add internal vs customer-facing update; timeline filter tabs + day grouping + append-without-reload; add impact via `RecordSelect` (row shows record label not UUID; service-component impact via service picker; legacy component impact via name field; `customer_account` absent from dropdown) + revenue rollup; detail-page tabs render with correct panels + two sequential inline edits (severity then priority) both persist without a spurious 409 (updatedAt refreshed) + stale-`updatedAt` → conflict bar; bulk action (progress); settings add trigger via `EventSelect` and see it dispatch; policy editor shows path preview incl. team target + SLA matrix persists; CRM account incidents widget; portal account view; Polish-mode smoke (translated nav + list headers); war-room AI card hidden without provider.

**Test case ledger (TC-INC-001..022):**
- TC-INC-001 — incidents CRUD (happy/validation/RBAC/tenant-isolation/optimistic-lock 409/`?ids=`).
- TC-INC-002 — number-sequence concurrency (parallel creates → unique numbers).
- TC-INC-003 — transition gate (required-fields-on-resolve 400 + resolve/close cascade + reopen).
- TC-INC-004 — timeline add + visibility filtering + aggregate 409 (parent `updated_at` bump).
- TC-INC-005 — escalation: escalate/ack/exhaustion + preview + rich body.
- TC-INC-006 — merge (source closed/number retained/impacts+action-items moved/both timelines/read-only/escalation cleared) + link idempotency.
- TC-INC-007 — impact add/update_status/remove + duplicate-target 409 + revenue rollup = Σ metrics.
- TC-INC-008 — enricher `_incidents` (no N+1, fallback on timeout) + injection renders.
- TC-INC-009 — config/catalog + escalation-policy CRUD + default resolution.
- TC-INC-010 — trigger CRUD (validation incl. `incidents.*` rejection/RBAC/tenant isolation/optimistic-lock 409/`?ids=`).
- TC-INC-011 — wildcard dispatch (create-once under redelivery, disabled → none, `incidents.*` → never, absent scope → no-op, applies severity/type/policy).
- TC-INC-012 — AI routes (availability false ⇒ 503 + `reason`, triage validation, tool RBAC).
- TC-INC-013 — SLA at-risk/breach set-once + settings-mutating flows (annotate tenant-singleton settings contention; retry-tolerant).
- TC-INC-014 — sweep idempotency (double-tick), ack-timeout escalation, snooze suppress→resume, scope isolation.
- TC-INC-015 — customer-update cadence (due on create, `update_overdue` once, customer-facing reset, resolve clears).
- TC-INC-016 — `GET …/timeline?kinds=…`/`?visibility=…` (only matching kinds/visibility, `total` reflects filter, invalid kind → 400).
- TC-INC-017 — impacts UI (add via picker → row shows label not UUID; service-component impact via picker; component impact via name field; `customer_account` absent from dropdown).
- TC-INC-018 — AI availability + draft (no-provider `{available:false, reason:'no_provider'}`; missing `incidents.ai.use` → availability 403 → `forbidden` guidance; postmortem-draft typed `code`; LLM-gated live-draft skip).
- TC-INC-019 — detail page (tabs render; two sequential inline edits both persist without spurious 409; stale `updatedAt` → conflict bar).
- TC-INC-020 — create page (triage fills severity/type/priority; hidden when AI unavailable).
- TC-INC-021 — service catalog context (service-component/dependency CRUD incl. duplicate 409 + self-loop 400 + cascade soft-delete; incident service-context returns impacted component + first-hop dependencies; freeform component fallback; RBAC view-vs-manage; tenant isolation; optimistic-lock 409).
- TC-INC-022 — runbook instantiation (creates one action item per active step; idempotent re-run creates none + skips existing; 404 for out-of-scope incident; requires `incidents.incident.manage`).

Unit coverage: i18n locale-coverage guard; catalog-label resolver fallback; dispatch matcher (loop-guard, redelivery-dedupe, per-trigger isolation); `EscalationPathPreview` label resolution; timeline filter matrix; `aiErrors` code mapping (every branch incl. `api_key_missing`); Anthropic base-URL normalization; `RecordSelect` hydration + auto-label capture (jsdom); availability reason serialization.

## Risks & Impact Review

### Data Integrity Failures
- Concurrent responder writes on one incident → resolved by command-level optimistic locking on the aggregate; multi-field writes wrapped in `withAtomicFlush`. Parent-deleted-mid-write guarded by soft-delete + scoped `findOneOrFail`. Escalation advance is a single atomic conditional claim (worker + manual share the command).

### Cascading Failures & Side Effects
- Subscriber failures are isolated (persistent, retried, idempotent); a failed notification never blocks the incident write. Auto-incident dispatch dedupes by `source_event_ref` and guards against loops (`incidents.*`/infra skip-list) and setup-phase resolver failures. Enrichers set `timeout`/`fallback` so a slow incidents lookup never breaks a customer/order page. AI failures return structured 503 and never block core flows.

### Tenant & Data Isolation Risks
- Every query/row/event/index/cache key carries `tenant_id`(+`organization_id`); the sweep payload carries explicit scope and processes one (org,tenant) per tick. The number sequence is keyed per (org,tenant). Portal scope is server-derived from `customer_accounts`, never client-supplied. Dispatch requires payload tenant+org; trigger rows are org-scoped.

### Migration & Deployment Risks
- New tables only; no backfill; deployable without downtime; migration re-runnable. No breaking API changes (greenfield).

### Operational Risks
- Sweep cadence bounds escalation/SLA/cadence latency (≤ poll interval) — documented. Blast radius is module-isolated (peers soft-optional). Bulk ops run through `ProgressJob` (no event storms). Encrypted free-text columns bound PII exposure.

### Risk Register

#### Lost updates from concurrent responders
- **Scenario:** Two responders change status/owner/notes on the same live incident simultaneously.
- **Severity:** High. **Affected area:** incident aggregate + sub-resources.
- **Mitigation:** command-level optimistic lock on the parent incident's `updated_at`; UI surfaces 409 via `surfaceRecordConflict`.
- **Residual:** A conflicting writer must retry; acceptable.

#### Duplicate incident numbers under concurrent creation
- **Scenario:** Parallel `create` calls race the sequence.
- **Severity:** High. **Affected area:** `incident.number` uniqueness.
- **Mitigation:** atomic `INSERT … ON CONFLICT DO UPDATE … RETURNING` (lock-free); unique constraint per (org,tenant).
- **Residual:** None material.

#### Escalation/SLA/cadence never fires (no timer)
- **Scenario:** Reactive events alone leave unacked incidents un-escalated / updates overdue.
- **Severity:** High. **Affected area:** escalation, SLA, snooze, reminders, cadence.
- **Mitigation:** scheduler-cron sweep worker; idempotent; per-tenant scope; covered by sweep integration tests.
- **Residual:** Latency bounded by cadence.

#### Unbounded / meaningless escalation
- **Scenario:** Manual/auto escalation increments a bare counter forever with no target or cap.
- **Severity:** High. **Affected area:** escalation clarity.
- **Mitigation:** named policy with ordered steps, bounded repeats→exhaustion, ack-halts, who-will-be-paged preview, and a 409 at exhaustion.
- **Residual:** None if a default policy is seeded (it is).

#### Wrong inbound trigger event id → dead auto-incident trigger
- **Scenario:** A seeded/default trigger references a misspelled/renamed peer event id and never fires.
- **Severity:** Medium. **Affected area:** auto-incident creation.
- **Mitigation:** verify every trigger id against source `events.ts`; triggers are per-row enable-toggled and tested for create-once.
- **Residual:** Peer may later rename its event (separate BC concern on the peer).

#### Wildcard subscriber overhead / event storm / loops
- **Scenario:** Every platform event probes triggers; a chatty event floods incidents.
- **Severity:** Medium. **Affected area:** runtime cost + incident volume.
- **Mitigation:** `webhooks` ships the identical pattern in production; fast early-exit + indexed per-tenant probe; `incidents.*`/infra hard-excluded; `excludeFromTriggers` honored; `source_event_ref` dedupe; one-click per-trigger disable.
- **Residual:** An operator can still pick a noisy event — visible and reversible in settings.

#### Scope creep into a standalone SRE tool
- **Scenario:** On-call rotations / paging / status pages / AIOps / advanced-SLA calendars / priority matrix creep into OSS core.
- **Severity:** High (architectural). **Affected area:** module boundary + edition split.
- **Mitigation:** hard OSS/enterprise line (this spec); reads availability from `planner`, delegates automation to `workflows`; builds no rotation/paging/status-page engine.
- **Residual:** None if review enforces the line.

#### AI unavailability / failure / bad output
- **Scenario:** Provider down/unconfigured, or a wrong severity suggestion / bad draft.
- **Severity:** Low. **Affected area:** AI affordances.
- **Mitigation:** availability probe (with `reason`) hides UI; routes return structured typed 503; human-in-the-loop everywhere (drafts fill forms; `prepareMutation` for the one write tool); rationale surfaced; no AI path persists server-side.
- **Residual:** Acceptable.

#### PII leakage via impact snapshots or free text
- **Scenario:** Customer names/emails persisted unencrypted in snapshots or timeline.
- **Severity:** Medium. **Affected area:** GDPR.
- **Mitigation:** snapshots store non-PII display/metrics only (`customer_person` label stripped server-side; PII re-fetched live); free-text columns declared in `encryption.ts` and read via `findWithDecryption`.
- **Residual:** None material.

## Final Compliance Report

### Files Reviewed
- `AGENTS.md` (root), `ARCHITECTURE.md` (§4/§5/§7/§9/§11/§13/§14/§15/§16/§17/§20/§25/§27/§29/§31)
- `packages/core/AGENTS.md`, `packages/ui/AGENTS.md`, `packages/ui/src/backend/AGENTS.md`, `packages/ai-assistant/AGENTS.md`
- `packages/shared/AGENTS.md`, `packages/events/AGENTS.md`, `packages/queue/AGENTS.md`, `packages/search/AGENTS.md`, `packages/scheduler` (services), `packages/core/src/modules/{customers,sales,staff,planner,customer_accounts,portal,progress}/AGENTS.md`
- `BACKWARD_COMPATIBILITY.md`, `.ai/ds-rules.md`, `.ai/ui-components.md`, `.ai/lessons.md`, the `webhooks` wildcard-subscriber precedent, the `om-create-ai-agent` skill.

### Compliance Matrix
| Rule Source | Rule | Status | Notes |
|---|---|---|---|
| root AGENTS.md | No cross-module ORM relations / peer entity imports | Compliant | FK-id + snapshot + `data/extensions.ts`; pickers use peer HTTP APIs; AI via exported runtime |
| root AGENTS.md | Filter by `organization_id`/`tenant_id` everywhere incl. dispatch | Compliant | All entities/queries/sweep/dispatch scoped |
| root AGENTS.md | Optimistic locking default-ON (new editable entities) | Compliant | `updated_at` on editable entities incl. triggers; command-level lock on aggregate for action endpoints |
| ARCHITECTURE §4 | Module works enabled or disabled | Compliant | No hard business `requires`; peers soft-optional |
| ARCHITECTURE §7 | CRUD via `makeCrudRoute` + `indexer.entityType` + `list.entityId`; zod; openApi | Compliant | Incidents + config + triggers |
| ARCHITECTURE §9 | Non-factory writes run mutation guards + commands undoable; subscriber isolation | Compliant | Action endpoints use guard registry; timeline append-only documented; dispatch failures logged not rethrown |
| ARCHITECTURE §11 | Cross-module via UMES; compose own UI directly; new spot ids = contract | Compliant | Enrichers/injection; war-room composed directly; spot ids in BC; only dashboards resolver additive |
| ARCHITECTURE §13 | `clientBroadcast`/`portalBroadcast`; durable/bulk = `ProgressJob` | Compliant | Declared; bulk via progress |
| ARCHITECTURE §16 | Encrypted PII via `encryption.ts` + `findWithDecryption` | Compliant | Free-text maps; snapshots PII-free; AI drafts not persisted by AI routes |
| ARCHITECTURE §25 | Enterprise scope isolated + flagged | Compliant | No status pages/rotations/paging/AIOps/advanced-SLA/priority-matrix in core |
| packages/ai-assistant | AI mutation approval (`prepareMutation`), feature-gated, soft-optional | Compliant | Single mutation tool; `incidents.ai.use`; availability probe |
| packages/ui AGENTS.md | `CrudForm`/`DataTable`/`apiCall`/`useGuardedMutation`; no raw fetch/form | Compliant | Create uses CrudForm; war-room writes guarded |
| DS rules | Semantic tokens, scale, primitives, lucide icons; dialog keys; `aria-label` | Compliant | Severity→status mapping; no raw colors/sizes; Boy-Scout on touched lines |
| i18n | No hardcoded user-facing strings; `[internal]` prefix; locale coverage | Compliant | Translations + catalog resolution + coverage guard |
| packages/scheduler | Module schedules via `SchedulerService.register` in setup | Compliant | Sweep registered idempotently |

### Verdict
- **Fully compliant** — approved for implementation. Implementation-time verifications: exact `SchedulerService.register`/`IncidentNumberGenerator` shapes against `communication_channels/setup.ts` and `sales/services/salesDocumentNumberGenerator.ts`; every inbound trigger event id against the source module's `events.ts`; exact `staff` teams and `customers`/`sales` list route paths for `RecordSelect`; portal feature-guard wiring against `customer_accounts`/`portal`; the ai-assistant object-execution helper name and dashboards title render site.

## Changelog

### 2026-07-03 — Follow-up implementation: service component catalog and dependency context
Closed the service/catalog gap from the vendor-signal analysis. Added incident-owned `incident_service_component` and `incident_service_dependency` entities with settings-managed CRUD APIs, optional source soft links (`source_type`/`source_id`), SLO/criticality metadata, and first-hop dependency expansion through `GET /api/incidents/[id]/service-context`. `incident_impact.target_type` now accepts `service_component`, validates the target in-scope, and stores a non-PII component snapshot; the war-room impact dialog exposes service components through the existing `RecordSelect` pattern while preserving legacy freeform `component` labels. No resources/catalog ORM relation or direct peer import was introduced. Validation: `yarn generate`, `yarn db:generate`, `yarn workspace @open-mercato/core test packages/core/src/modules/incidents/__tests__ --runInBand`, `yarn typecheck`, `yarn build:packages`, `yarn build:app`.

### 2026-07-03 — Follow-up implementation: team resolution and runbooks
Closed the two initial implementation gaps from the vendor-signal analysis. Escalation team targets now resolve through the soft-optional staff `staffTeamMemberResolver` DI service; incidents still falls back to owner/user/role recipients when staff is absent or a team has no user-linked members, and unit coverage exercises user, role, team, and absent-staff cases. Added reusable runbooks via `incident_runbook` and `incident_runbook_step`, nullable type/severity default runbook links, settings-managed CRUD APIs, a default major-incident response runbook seeded in setup, and `incidents.runbook.instantiate` / `POST /api/incidents/[id]/runbook/instantiate` to create idempotent action items from active steps. Workflow integrations should listen to `incidents.runbook.instantiated`; no direct workflows import was introduced. Validation: `yarn generate`, `yarn db:generate`, `yarn workspace @open-mercato/core test packages/core/src/modules/incidents/__tests__ --runInBand`, `yarn typecheck`, `yarn build:packages`.

### 2026-07-02 — Initial implementation
Shipped the `incidents` core module end-to-end: incident lifecycle with severity/type/role catalogs and a concurrency-safe number sequence; append-only timeline (filter tabs, day grouping, incremental realtime merge) with internal vs customer-facing composers; a named escalation-policy model (steps + delays + user/team/role targets, ack-halts, bounded repeats→exhaustion, manual escalate-to-next with a who-will-be-paged preview) driven by a single-flight scheduler sweep that also handles SLA at-risk/breach, snooze, overdue-action reminders, and customer-update cadence. Delivered the CRM/sales differentiator (live revenue-at-risk rollup, contract-tier hint, per-owner account-manager notification, `_incidents` enrichers + account/order widgets, portal per-account view), user-configurable auto-incident triggers (`incident_trigger` entity + one wildcard dispatch subscriber with loop-guard and `source_event_ref` dedupe), a CRM-grade war-room detail page (`DetailTabsLayout` main column + inline-edit sidebar), postmortems/action-items/merge/link/reopen, bulk ops + perspectives + dashboards, a human-in-the-loop AI layer (chat assistant, triage, postmortem writer, one-shot summary/customer-update/postmortem-draft routes, similar-incidents retrieval, actionable typed errors), and complete en/de/es/pl i18n with a locale-coverage regression guard. Integration coverage TC-INC-001..020 plus the listed unit suites ship with the change; the OSS/enterprise line stays strict (no status pages, rotations, paging, AIOps, advanced-SLA calendars, or priority matrix in core).
