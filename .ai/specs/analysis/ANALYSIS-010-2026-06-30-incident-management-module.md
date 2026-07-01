# Pre-Implementation Analysis: Incident Management Module (greenfield)

> **Type:** Greenfield module scoping + readiness analysis (no spec exists yet).
> **Date:** 2026-06-30
> **Scope requested:** Internal incidents — severity, owners, timelines, postmortems, customer impact, and workflow escalation.
> **This document precedes a spec.** Its purpose is to (1) confirm nothing like this exists, (2) define the required feature set from competitive analysis, (3) decide how the module fits the Open Mercato architecture, and (4) hand a de-risked scope + gap list to `om-spec-writing`. It does **not** write code or a spec.

---

## Executive Summary

There is **no existing incident-management capability** in Open Mercato — confirmed by scanning all 47 core modules and every spec under `.ai/specs/`. This is genuinely greenfield, with no backward-compatibility breakage risk (all surfaces it introduces are *additive*).

The right shape is a **single core module `incidents`** in `packages/core/src/modules/incidents/`, built on the `customers` reference pattern, that **reuses** the platform's existing engines (events, notifications, workflows, business_rules, audit_logs, attachments, search, dashboards, perspectives, planner, communication_channels) rather than rebuilding SRE tooling. The differentiated value — what a standalone tool (PagerDuty/incident.io) **cannot** do — is embedding incidents next to the CRM and sales data: **revenue/ARR blast-radius rollups, account-record incident widgets, customer-tier-driven escalation, and per-account portal visibility.**

Heavy SRE/commercial features (public status pages, advanced SLA engine, AI postmortem drafting, complex on-call rotations, multi-channel paging, AIOps alert ingestion) belong in **`packages/enterprise`** behind `OM_ENABLE_ENTERPRISE_MODULES`, with a separate spec under `.ai/specs/enterprise/`.

**Recommendation: proceed to spec-writing**, but the spec MUST close the 12 gaps the completeness critic found before implementation — the load-bearing ones are: a **timer/scheduler substrate** for timeout-driven escalation/SLA/snooze (events are reactive only), an explicit **ACK action + `acknowledged_at`** (without it MTTA and "escalate if not acknowledged" are undeliverable), a concurrency-safe **incident-number sequence**, **command-level optimistic locking** on the action endpoints (ACK/transition/assign/note — not just CrudForm), and a purpose-built **war-room detail page** (not a generic CrudForm).

---

## 1. Existing-Functionality Check (de-dup)

| Check | Result |
|---|---|
| Module named `*incident*` under `packages/`, `apps/` | **None** |
| `incident` / `postmortem` / `escalation` / `on-call` / `severity` references in code | Only incidental support/i18n strings (customers, sales, resources, staff) — no incident domain |
| Specs in `.ai/specs/` for incident/postmortem/escalation | **None** (the "escalation"/"severity" grep hits are unrelated: workflows, breadcrumbs, calendar specs) |
| Nearest neighbors | `inbox_ops` (AI mail triage — different domain), `workflows` (generic automation — reusable), `audit_logs` (history — reusable), `staff`/`planner` (people/availability — reusable) |

**Conclusion:** No overlap, no duplication risk. The closest functional adjacency is `inbox_ops`, but it is email-extraction triage, not operational incident tracking. Build new; reuse engines.

---

## 2. Competitive Feature Analysis

Researched 8 products (PagerDuty, Opsgenie, incident.io, FireHydrant, Rootly, Jira Service Management/ITIL, ServiceNow ITSM, Atlassian Statuspage) and synthesized a canonical matrix, **re-weighted for an ERP/CRM context** (customer impact + internal ownership + workflow escalation rank above pure alerting).

### 2.1 Must-have (OSS core v1)

The complete, lean core. Grouped by capability:

- **Lifecycle:** incident entity (tenant/org-scoped) with number, title, description, lifecycle timestamps + `updated_at` (optimistic lock); configurable states (Open → Investigating → Identified → Mitigated → Resolved → Closed) with every transition timestamped to the timeline; reopen preserving context; incident **types/categories** carrying default roles/severity/required-fields; **required-fields-on-resolve** gate; **merge/link** duplicate or related incidents; **test/drill flag**.
- **Severity & priority:** configurable severity scale (per-tenant names/order) as a first-class field; optional priority independent of severity.
- **Ownership (internal teams):** internal owner/assignee from existing auth identities; owning team/department; reporter/opened-by + reassignment; configurable per-incident **roles** (Commander, Comms Lead, Scribe); **subscribers/stakeholders** distinct from responders.
- **Customer & order impact (the ERP/CRM differentiator):** link affected customers/accounts; link affected orders/sales-documents; affected services/components with per-component impact status (operational/degraded/partial/major); customer-impact summary + customer-communication notes.
- **Timeline & updates:** automatic append-only timeline (actor + timestamp); notes/status updates with **internal vs customer-facing** distinction; attachments (reuse `attachments`).
- **Workflow & escalation:** severity/status-driven **basic escalation** (notify owner/team, escalate to manager on timeout) via events + notifications + a timer; typed domain events; in-app notifications on key transitions.
- **Learning:** postmortem record linked to incident with structured sections; **follow-up action items** assignable + tracked to completion.
- **Operability & governance:** filterable list/board (status/severity/owner/team/customer/date); **search indexing** (`search.ts`); RBAC feature gating via `acl.ts`; audit trail (immutable timeline + `audit_logs`); internal-vs-restricted **visibility** control; **custom fields** via the entities DSL (`ce.ts`); REST API + creation via cross-module events.

### 2.2 Should-have (core, post-v1 or v1.x)

Severity matrix auto-suggesting severity from impacted services/customers; auto-derive owning team/responders from account/service ownership; **major-incident** designation; **workflow automation** triggered by incident events (delegate to `workflows`); **business-rules** conditions gating automations (delegate to `business_rules`); stakeholder broadcast updates separate from working notes; templated status updates; internal status dashboard; operational metrics (MTTA/MTTR/time-in-status sliced by severity/team/service/customer) via `dashboards`; action-item/postmortem completion tracking; postmortem templates + centralized list; **snooze**; ChatOps lifecycle posting via `communication_channels`; export report + sync action items to a tracker; maintenance-window type; **per-account impact rollup on the CRM record**; team-level current-owner-on-duty lookup (read from `planner`); saved views (reuse `perspectives`); subscriber notification preferences; lightweight **SLA-style at-risk/breached** indicator per severity.

### 2.3 Nice-to-have

AI incident summaries / catch-up; call transcription into timeline; pin chat messages into timeline; contributing-factors as structured data; round-robin auto-assignment; overdue-postmortem/action reminders; trend dashboards clustering recurring incidents; heartbeat/dead-man's-switch detection; game-day/drill mode; customizable terminology; portal-facing per-account incident visibility.

### 2.4 Enterprise candidates (→ `packages/enterprise`, `.ai/specs/enterprise/`)

Public/audience-specific **status pages** (branding, uptime history, subscriber signup); **advanced SLA engine** (business-hours calendars, pause conditions, breach states); **AI-drafted postmortems**; AI triage/classification; **complex on-call scheduling** (layered rotations, overrides, multi-level escalation policies); **multi-channel paging** (SMS/voice/push, stepped per-user rules); **alert ingestion/AIOps** (dedup, ML grouping, alert→incident promotion); predictive/proactive remediation; config-as-code; advanced governance (SSO/SCIM, field-level/team RBAC, exportable compliance audit); continual-improvement/problem-management loop + known-error KB; cross-tenant/MSP benchmarking; runbook automation against external systems.

> **Edition guardrail:** keep all enterprise logic out of `packages/core`. There is no runtime license check (§25) — separation is by package + env flag only, so review must catch any enterprise feature leaking into OSS.

---

## 3. ERP/CRM Differentiation (why this belongs in Open Mercato)

These are the capabilities a standalone SRE tool **structurally cannot** offer because it has no CRM/sales datastore. They are the reason to build this *inside* Open Mercato and should anchor the spec's value story:

1. **Revenue / ARR blast-radius rollup** — because incidents link to customers and orders in the same datastore, compute *money at risk* (sum of affected open orders, affected customers' tier/ARR) directly on the incident, and feed it into auto-severity and exec escalation.
2. **Account-record incident widget** (UMES) — surface a customer/account's live incident status + history on the existing CRM customer detail page, and an "affected by INC-123" banner on the order detail page — via **response enrichers (`_incidents`) + widget injection**, no new datastore.
3. **Customer-tier / segment-driven automation** — gate escalation breadth, notification reach, and severity suggestion on real CRM attributes (tier, contract value, strategic flag) through `business_rules`.
4. **Auto-derive owning team / responders** from the account's existing account-team relationship (`customers`) + team membership (`staff`/`directory`) — reuse the people graph, no separate responder directory.
5. **Promote inbound customer signals into incidents** — an `inbox_ops` conversation, a `messages` thread, or a `communication_channels` thread reporting an outage can become/attach to an incident in one step, with the originating thread linked.
6. **Customer-facing comms through the real contact stack** — send customer updates via the account's actual contact records/channels (`messages`/`notifications`, portal) and log them against the account, instead of a bolt-on status-page mailing list.
7. **Compliance/SLA-credit evidence for free** — the immutable timeline + `audit_logs` already tie an incident to the exact customers, orders, and money affected — usable for SLA credits, breach evidence, dispute resolution.
8. **Remediation as real tracked work** — action items become `planner`/`resources` tasks or `workflows` instances assigned to staff with existing availability data, not a siloed checklist.
9. **Metrics sliced by customer/order-value/account-tier** via the `dashboards` analyticsRegistry — answering "which customers are most impacted" and "incident cost by segment."
10. **Portal-scoped per-account visibility** via existing portal auth + portal event bridge — a private, account-scoped status view that reuses tenant scoping instead of a public status page.

---

## 4. Architecture Fit (how it lives in Open Mercato)

### 4.1 Placement & module shape

- **Module:** `packages/core/src/modules/incidents/` (plural, snake_case id `incidents`). Core business module; mirror `customers` (the canonical reference, ARCHITECTURE §29).
- **Enterprise overlay:** advanced features in `packages/enterprise` behind `OM_ENABLE_ENTERPRISE_MODULES`.
- Standard discovery files (ARCHITECTURE §4): `index.ts`, `di.ts`, `acl.ts`, `setup.ts`, `ce.ts`, `events.ts`, `search.ts`, `notifications.ts`/`.client.ts`/`.handlers.ts`, `translations.ts`, `data/{entities,validators,extensions,enrichers}.ts`, `commands/*`, `api/**/route.ts` + `api/openapi.ts`, `backend/**/page.tsx` + `page.meta.ts`, `subscribers/*`, `workers/*`, `widgets/{injection,injection-table.ts,components.ts}`, `migrations/`, `i18n/{en,de,es,pl}.json`. Run `yarn generate` after adding discovery files.

### 4.2 Data model (proposed entities)

All tenant/org-scoped, UUID PKs, `created_at`/`updated_at`/`deleted_at`, **`updated_at` returned in API responses** for optimistic locking. Mirror the exact decorator/import style of `customers/data/entities.ts` (the repo is **MikroORM 6.6**, ARCHITECTURE §2 — verify imports against the reference module; do not assume v7).

| Entity (table) | Purpose | Key fields |
|---|---|---|
| `incidents` (incident) | The incident record | `number` (per-tenant seq), `title`, `description`, `type_id`, `severity`, `priority`, `status`, `owner_user_id`, `owning_team_id`, `reporter_user_id`, `visibility` (internal/restricted), `is_drill`, `is_major`, `detected_at`, `acknowledged_at`, `started_at`, `resolved_at`, `closed_at`, `parent_incident_id` (merge/link), `workflow_instance_id` (FK-id), `customer_impact_summary` |
| `incident_timeline_entries` (incident_timeline_entry) | Append-only timeline | `incident_id`, `kind` (status_change/severity_change/assignment/note/update/action/ack), `actor_user_id`, `body`, `visibility` (internal/customer_facing), `created_at` |
| `incident_participants` (incident_participant) | Responders, roles, subscribers | `incident_id`, `user_id`, `kind` (responder/subscriber), `role` (commander/comms/scribe/...) |
| `incident_impacts` (incident_impact) | Polymorphic impact links + snapshot | `incident_id`, `target_type` (customer/order/sales_doc/component/service), `target_id`, `snapshot` (jsonb), `impact_status` (operational/degraded/partial/major) |
| `incident_action_items` (incident_action_item) | Follow-up remediation | `incident_id`, `title`, `assignee_user_id`, `status`, `due_at`, `completed_at` |
| `incident_postmortems` (incident_postmortem) | Retrospective | `incident_id`, `summary`, `root_cause`, `impact`, `contributing_factors`, `lessons`, `published_at` |
| `incident_settings` (config row) | Per-tenant config | escalation timeout, SLA targets per severity, auto-incident trigger toggles |

- **Catalogs (severity scale, types, role names):** prefer the `dictionaries` module for tenant-configurable catalogs (the critic's recommendation — avoids a bespoke admin UI) plus a settings config row; tenant schema extension via `ce.ts` custom fields.
- **Cross-module references** use **FK-id columns + jsonb snapshot** (never ORM relations across modules, ARCHITECTURE §4/§21). Declare links in `data/extensions.ts`.
- **No cross-module ORM relation, no importing another module's entity classes.**

### 4.3 Read/write paths & CRUD

- CRUD via `makeCrudRoute({ entity, idField, orgField, tenantField, softDeleteField, indexer: { entityType: E.incidents.incident }, list: { entityId, fields, buildFilters, ... }, actions: { create/update/delete → commandId } })`. **`indexer.entityType` + `list.entityId` are mandatory** or the `query_index` goes stale (§5/§7). Use generated `E.incidents.*` ids, never string literals.
- Writes go through **commands** (`commands/*` with `@registerCommand('incidents.incident.<action>')`, `isUndoable` + `undo`), emitting CRUD side effects after flush. Reads through `QueryEngine`.
- **State transitions, ACK, assignment, add-note, role changes** are command-style action endpoints (not CrudForm). They MUST: map to `create`/`update`/`delete` in the mutation-guard registry and run `runMutationGuards`/`validateCrudMutationGuard`; and enforce **command-level optimistic locking** (`enforceCommandOptimisticLock` / `createCommandOptimisticLockGuardService`) — see §6 gaps.
- **`incident_impacts` is polymorphic** → its optimistic-lock reader needs a per-kind override (see `customers/di.ts` polymorphic-table override precedent).

### 4.4 Events (this module owns; `module.entity.action`, past tense)

Declare in `events.ts` via `createModuleEvents` (with `as const`): `incidents.incident.created` / `.updated` / `.assigned` / `.acknowledged` / `.severity_changed` / `.status_changed` / `.escalated` / `.resolved` / `.closed` / `.reopened` / `.merged`; `incidents.action_item.created`/`.completed`; `incidents.postmortem.created`/`.published`. Set `clientBroadcast: true` on events the war-room UI must react to in real time (audience-filtered to tenant + owner/team/subscribers). Once shipped, event IDs are **FROZEN** (§27).

### 4.5 Cross-module coupling (verify exact event IDs against each module's `events.ts` during spec)

**Subscribe-to (auto-create / auto-escalate incidents, all behind config toggles):**

| Candidate trigger event | Source module | Use |
|---|---|---|
| `data_sync.run.failed` | data_sync | auto-incident on repeated sync failure |
| `payment_gateways.payment.failed`, `payment_gateways.webhook.failed` | payment_gateways | payment processing breakdown |
| `sales.payment.failed`, sales shipment errors | sales | order-impacting failures |
| `communication_channels.message.delivery_failed`, `*.channel.disconnected` | communication_channels | comms outage |
| `integrations.state.updated` (unhealthy) | integrations | integration health |
| `workflows` instance/activity failed | workflows | automation failure |
| `messages.message.email_failed` | messages | email delivery breakdown |
| `customers.deal.lost`, `customers.interaction.canceled` | customers | configurable business escalation |

> Exclude noisy/internal events (`progress.job.failed` unless flagged critical, `query_index.*`, `search.*`, `cache.*`, and any event marked `excludeFromTriggers`).

**Couple-to (reuse, don't rebuild):**

| Module | Relationship |
|---|---|
| `workflows` | Escalation/automation as workflow definitions; store `workflow_instance_id` FK-id; resolve `workflowExecutor` via DI. Don't reimplement a state machine. |
| `notifications` | Emit notifications to owner/team/subscribers/mentions; renderers in `incidents/notifications.client.ts`; reactive handlers idempotent + `features`-gated. |
| `business_rules` | Gate severity/escalation on CRM facts (tier, ARR). |
| `audit_logs` | Auto-written via command bus; query for history. |
| `attachments` | Evidence on incidents/notes. |
| `messages` | **Internal threaded collaboration + @-mentions** (distinct from flat notes and external ChatOps) — the critic flagged this as missing. |
| `communication_channels` | ChatOps lifecycle posting (Slack/Discord) — emit events, let the channel module post; no channel-specific code in incidents. |
| `staff`/`directory` | Owner/team identities; team membership for routing. |
| `planner` | Read current availability/owner-on-duty (availability rule-sets) — **do not build a rotation engine** (over-scoping). |
| `customers`/`sales` | FK-id + snapshot for affected customers/orders; revenue rollup; account-record widget via enricher + injection. |
| `perspectives` | Saved/filtered incident views — reuse, don't reimplement. |
| `dashboards` | Register MTTA/MTTR/active-incident widgets with analyticsRegistry; no custom reporting page. |
| `progress` | Bulk incident operations (bulk close/assign) → `ProgressJob` + worker. |
| `scheduler` + `queue` | **Timer substrate** for timeout escalation, SLA at-risk, snooze expiry, overdue-action reminders — events are reactive only (critical gap, §6). |

**Anti-patterns to avoid:** cross-module ORM relations; importing other modules' entity classes; subscribing to workflow internals (only lifecycle events); direct payment/integration API calls (subscribe + snapshot); emitting incident events from other modules.

### 4.6 RBAC / ACL

`acl.ts` features (`<module>.<entity>.<action>`, immutable IDs): `incidents.incident.view`/`.create`/`.manage`/`.assign`/`.close`, `incidents.postmortem.view`/`.manage`, `incidents.escalation.manage`, `incidents.settings.manage`. Declare grants in `setup.ts` `defaultRoleFeatures` (admin: `incidents.*`; employee: view/create/manage subset), run `yarn mercato auth sync-role-acls`. Guards via `requireAuth`/`requireFeatures` (never `requireRoles`); raw feature arrays checked with `hasFeature`/`hasAllFeatures` (wildcard-aware). Super-admin via immutable `isSuperAdmin`, never role name. Portal pages (if portal visibility ships) use `requireCustomerAuth`/`requireCustomerFeatures`.

### 4.7 Encryption / GDPR

`customer_impact_summary`, customer-communication notes, timeline note bodies, postmortem free-text, and any snapshot containing PII (customer name/email) are **GDPR-relevant free text about people** → declare them in `incidents/encryption.ts` (`defaultEncryptionMaps`), read via `findWithDecryption`/`findOneWithDecryption`. Any equality-lookup column needs a sibling `*_hash`. No hand-rolled crypto.

### 4.8 Search

`search.ts`: index `title`, `description`, `number`, status/severity; PII (impact notes) `hashOnly`; secrets `excluded`; tokens entity has `formatResult` (→ `/backend/incidents/<id>`); vector `buildSource` paired with `checksumSource`.

---

## 5. UI/UX Design

> Design system is mandatory (ARCHITECTURE §22, `.ai/ds-rules.md`, `.ai/ui-components.md`): semantic status tokens only (no `text-red-*`/`bg-green-*`), DS spacing/text scale (no arbitrary values), `StatusBadge`/`Alert`/`FormField`/`SectionHeader`/`EmptyState`/`LoadingMessage`, lucide-react icons with `aria-label`, all strings via `useT()`/`resolveTranslations()` in all four locales. Map severity→semantic status: critical→`error`, high→`warning`, medium→`info`, low→neutral; resolved/closed→`success`.

1. **Incidents list** `/backend/incidents` — `DataTable` (`pageSize ≤ 100`): number, title, severity badge, status, owner, team, affected-customers count, age, updated. Filters: status/severity/owner/team/customer/type/date, "active only", "exclude drills". **Bulk actions** (close/assign/severity/subscribe) via DataTable bulk actions + **`ProgressJob`**. Saved views via **`perspectives`**. Stable `entityId` + `extensionTableId`.

2. **Incident detail** `/backend/incidents/[id]` — the **war-room** composite page (the critic's key insight: this is NOT a plain CrudForm). Compose its own tabs/sections directly (no self-injection), and expose UMES injection spots for other modules:
   - **Status header:** number + title, severity badge, status pill, owner, age + SLA/escalation timers, primary actions: **Acknowledge**, Change status / Resolve / Close, Escalate, Declare major, Reopen.
   - **Main column — timeline:** chronological entries (state/severity changes, assignments, notes, updates, ACK). Composer with **internal-note vs customer-facing-update** toggle, @-mentions (via `messages`), attachments.
   - **Sidebar:** responders & roles (Commander/Comms/Scribe), subscribers, severity/priority, type/category, owning team, custom fields.
   - **Impact panel:** affected customers (link to CRM) with **revenue/ARR rollup**, affected orders/sales docs, affected components with per-component impact status.
   - **Action items panel:** follow-ups with assignee + status.
   - **Postmortem section/tab** (post-resolution): structured sections + **required-fields-on-resolve gate**.
   - Distinct loading / not-found / error states (`LoadingMessage` / `RecordNotFoundState` / `ErrorMessage`) — not-found is a dedicated page state (lessons.md).
   - Real-time updates via DOM Event Bridge (`useAppEvent('incidents.*', …)`).
3. **Create incident** `/backend/incidents/create` — `CrudForm`: title, type, severity, description, owner, team, affected customers/orders (async selects, hydrated as value+options), customer-impact summary. `Cmd/Ctrl+Enter` submit, `Escape` cancel. Conflict handling via `surfaceRecordConflict`.
4. **Settings** `/backend/incidents/settings` — severity scale, types, role catalog (dictionaries), SLA targets, escalation timeout, auto-incident triggers. `incidents.settings.manage` gated.
5. **Cross-module UMES injections** — CRM customer detail "Incidents" tab/widget (enricher `_incidents` + injection); order/sales-doc "affected by incident" banner; dashboards active-incidents + MTTA/MTTR widgets; in-app notifications. **Every injected DataTable column/field needs a paired enricher** supplying its data.

---

## 6. Gap Analysis (from the completeness critic — fold into the spec)

### Critical (must resolve in the spec before implementation)

1. **Timer/scheduler substrate missing.** Events+notifications are reactive only — nothing fires after N minutes of silence. Name the mechanism (the **`scheduler` cron jobs** or a **`queue` delayed job**) that polls for un-acknowledged/stale incidents, SLA at-risk thresholds, snooze expiry, and overdue-action reminders. **Without it, every timeout/at-risk/snooze/reminder feature is undeliverable.**
2. **Acknowledge as a distinct timestamped action.** Add `acknowledged_at` + an ACK command separate from assignment/status. MTTA can't be computed and "escalate if not acknowledged" has nothing to test against otherwise.
3. **Incident-number sequence is unspecified and concurrency-risky.** Define a per-tenant monotonic sequence (reuse the platform sequence mechanism `setup.ts` uses for order numbers) with collision-safe allocation. Note the repo's documented **soft-delete + unique-constraint flakes** and that **PostgreSQL partial unique indexes are not constraints** (lessons.md) — design allocation under concurrent creation deliberately.
4. **Command-level optimistic locking on action endpoints.** The highest-contention writes (state transition, ACK, add-note, assign) are command-style, hit by multiple responders simultaneously. Require `enforceCommandOptimisticLock` / `createCommandOptimisticLockGuardService` + `surfaceRecordConflict` — not just CrudForm coverage. Add a polymorphic-table override for `incident_impacts` (precedent: `customers/di.ts`).
5. **War-room detail page is under-specified.** Spec the composite layout (§5.2) explicitly; "CRUD detail built on CrudForm" mis-frames the module's most important screen.

### Important (should address in the spec)

6. **Internal threaded collaboration / @-mentions** — back with the `messages` module (threads, mentions, notify-on-mention), distinct from flat notes and external ChatOps.
7. **Saved views** — name **`perspectives`** explicitly (don't reimplement); per-team default views on top.
8. **Bulk operations** — bulk close/assign/reassign/severity/subscribe via DataTable bulk actions + `progress`.
9. **Time-zone / business-hours** for any duration metric or SLA at-risk indicator — define 24/7 vs business-hours; the repo has documented **time-bomb risks in duration assertions** (lessons.md).
10. **Notification de-dup / digest + self-notification suppression** — a single transition fans out to owner/team/subscribers/role-holders/mentions; coalesce/digest and "don't notify the actor."
11. **Record-scoped participant access** — a responder added to a sensitive (e.g. security) incident should gain scoped access to *that* record; visibility is currently a tenant-wide boolean, not record-scoped.
12. **Reverse/cascade semantics on close** — resolving an incident must clear per-component impact statuses, cancel active escalations/snooze timers, and close open subscriptions (the point of the status rollup).

### Nice-to-have (note as out-of-v1)

Broaden in-platform incident links (workflow instance, inbox_ops conversation, webhook delivery failure, data_sync run, business_rules outcome); contributing-factors as structured trend data.

---

## 7. Backward Compatibility (new contract surfaces — additive, but frozen on release)

No existing surface is broken (greenfield). However, everything this module introduces becomes a **FROZEN/STABLE contract surface** the moment it ships (ARCHITECTURE §27), so design it right the first time:

| # | Surface | New value | Note |
|---|---|---|---|
| 1 | Module id | `incidents` | FROZEN once shipped |
| 5 | Event IDs | `incidents.incident.*`, `incidents.action_item.*`, `incidents.postmortem.*` | FROZEN — choose names carefully |
| 6 | Widget spot IDs | `detail:incidents.incident:tabs`/`:sidebar`, `crud-form:incidents.incident:fields` | Public contract for outside consumers |
| 7 | API routes | `/api/incidents/*` | STABLE |
| 8 | DB schema | `incidents`, `incident_*` tables, `E.incidents.*` ids | FROZEN columns/ids |
| 9 | DI keys | optimistic-lock readers, services | STABLE |
| 10 | ACL feature IDs | `incidents.*` (stored in DB) | FROZEN |
| 11 | Notification type IDs | `incidents.*` | FROZEN |
| — | Enriched field namespace | `_incidents` on CRM/sales responses | Contract surface (§11) |
| — | Custom-entity id | `incidents:incident` (ce.ts) | Stable |

**The real BC dependency is inbound:** subscribing to other modules' events relies on those event IDs being exactly correct — a wrong ID is a silent no-op subscriber. The spec MUST verify each candidate trigger event (§4.5) against the source module's `events.ts`.

---

## 8. Risk Assessment

| Risk | Sev | Mitigation |
|---|---|---|
| Timeout escalation/SLA undeliverable without a timer | **High** | Resolve gap #1 in spec; pick scheduler/queue delayed-job substrate up front |
| Concurrent ACK/transition/assign by multiple responders → lost updates | **High** | Command-level optimistic locking on all action endpoints (gap #4) |
| Incident-number collisions under concurrent creation | **High** | Concurrency-safe sequence; heed soft-delete/partial-unique-index lessons (gap #3) |
| Scope creep into a standalone SRE tool (on-call rotations, paging, AIOps, status pages) | **High** | Hard OSS/enterprise line (§2.4); v1 reuses planner/workflows/notifications, builds no rotation/paging engine |
| Cross-module coupling violating module independence | **Med** | FK-id + snapshot + UMES only; no ORM relations/imports; fail-closed interceptors; `enrichMany` (no N+1) with `timeout`/`fallback` |
| Wrong inbound event IDs → dead subscribers | **Med** | Verify every trigger event against source `events.ts` in the spec |
| Notification fan-out storms | **Med** | De-dup/digest + actor suppression (gap #10) |
| Time-bomb duration assertions in metrics/SLA | **Med** | Define TZ/business-hours; avoid hardcoded dates in tests (gap #9, lessons.md) |
| PII exposure in snapshots/free text | **Med** | `encryption.ts` maps + `findWithDecryption` (§4.7) |
| Polymorphic `incident_impacts` lock/index complexity | **Low** | Per-kind reader override (customers/di.ts precedent) |

---

## 9. Remediation Plan

### Before spec-writing (decide these first)
1. **Confirm v1 boundary:** the must-have set (§2.1) + the critical gap fixes (§6) = OSS core v1. Everything in §2.4 → enterprise spec.
2. **Pick the timer substrate** (scheduler cron vs queue delayed job) — gates escalation/SLA/snooze.
3. **Pick the incident-number sequence mechanism** (reuse platform sequences).
4. **Decide catalog storage:** dictionaries (severity/types/roles) + settings row + ce.ts custom fields.

### During spec-writing (`om-spec-writing`) — the spec MUST include
1. Data Models for all entities in §4.2 (with the gap-#2/#3 additions: `acknowledged_at`, sequence design).
2. API Contracts for CRUD + every **action endpoint** (ACK/transition/assign/note/escalate/merge/resolve/close), each with command id, guard wiring, and command-level optimistic locking.
3. UI/UX for the **war-room detail page** (§5.2) plus list/create/settings + UMES injection spots.
4. Events declaration + the **verified** inbound-trigger event list (§4.5).
5. Cross-module coupling decisions (§4.5) stated as "reuse X via Y," with the module-decoupling test in mind.
6. Encryption map (§4.7), search config (§4.8), ACL + setup grants (§4.6).
7. Resolution of all 12 gaps (§6) — explicitly, not implicitly.
8. **Migration & Backward Compatibility** section listing the new frozen surfaces (§7).
9. **Integration Test Coverage** for all API paths (CRUD + actions, optimistic-lock 409s, RBAC 403s, tenant isolation, auto-incident-from-event) and key UI paths (create, ACK, transition, resolve-with-required-fields, bulk action, CRM account widget). Self-contained fixtures.
10. Phasing: **P1** core entity+CRUD+timeline+RBAC+search; **P2** ownership/roles/subscribers + impact links + notifications; **P3** escalation timer + ACK + SLA-at-risk; **P4** postmortems + action items + required-on-resolve; **P5** workflow/business-rules automation + dashboards + CRM widget; **P6** bulk ops + perspectives + ChatOps. (Enterprise overlay separate.)

### Post-implementation (follow-up)
- Enterprise spec (`.ai/specs/enterprise/`) for status pages, advanced SLA, AI postmortems, complex on-call, paging, AIOps.
- Portal-facing per-account incident view.
- Per-provider export/tracker-sync integration packages.

---

## 10. Recommendation

**Proceed to `om-spec-writing`** for an OSS core `incidents` module, scoped to §2.1 (must-have) + the §6 critical gap fixes, reusing the platform engines per §4.5, and deferring §2.4 to a separate enterprise spec. The architecture fit is clean (no BC breakage; standard module pattern; strong CRM/sales differentiation). The only blockers are design decisions, not unknowns: the **timer substrate**, **ACK/`acknowledged_at`**, **incident-number sequence**, **command-level optimistic locking**, and the **war-room detail page** must be specified before implementation. Resolve those in the spec and this is a high-value, well-bounded build.

---

### Appendix — sources
- De-dup scan: all `packages/core/src/modules/*`, `.ai/specs/`.
- Scaffold conventions: `customers` reference module, `.ai/docs/module-development.md`, `packages/core/AGENTS.md`, ARCHITECTURE §4/§5/§7/§29.
- Adjacent-module coupling + candidate trigger events: per-module `AGENTS.md` + `events.ts` scan.
- Competitive matrix + completeness critique: 8-product research workflow (PagerDuty, Opsgenie, incident.io, FireHydrant, Rootly, Jira SM, ServiceNow, Statuspage).
- Conventions/compliance: ARCHITECTURE §31 checklist, `.ai/lessons.md`, `BACKWARD_COMPATIBILITY.md` §27.
