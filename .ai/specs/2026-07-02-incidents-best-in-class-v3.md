# Incidents v3 — Best-in-Class Completion: i18n, Escalation Clarity, Deep Platform Integration, AI

> **Delta spec.** Builds on [2026-06-30-incident-management-module.md](2026-06-30-incident-management-module.md) (v1 + v2 Elevation, implemented on `feat/incidents`). Everything in that spec remains authoritative unless explicitly superseded here. Branch base: `feat/incidents` (pre-release — v1/v2 surfaces are still mutable; they FREEZE together with v3 on release).

## TLDR

**Key Points:**
- v3 closes the gap between "functional" and **best in class**, driven by direct user feedback on the shipped v1+v2: (1) **English strings leak into Polish mode** (nav links, forms, lists) even though all 4 locale files pass key-sync; (2) the module **can't subscribe to arbitrary Open Mercato events or link arbitrary OM records** — auto-incident triggers are 2 hardcoded subscribers and impact targets are raw UUID inputs; (3) **button labels truncate to "…"**; (4) escalation is structurally right (v2 policies) but its **settings/editor UX is unfinished** (no team targets, no SLA matrix editor, no visual path preview); (5) **zero AI**.
- Four workstreams, all on canonical primitives: **W1 i18n completeness** (translate the 262 English `pl.json` values + de/es, i18n-resolve seeded catalog labels, dashboard-widget locale keys via the platform's existing id-derived convention, a locale-coverage regression test); **W2 escalation & UI polish** (visual policy-path preview, staff-team targets, SLA matrix editor, truncation fixes verified in Polish mode); **W3 deep integration** (new `incident_trigger` entity + `EventSelect`-driven trigger manager + ONE wildcard dispatch subscriber mirroring `webhooks`, and a module-local `RecordSelect` so impacts pick real customers/orders by search); **W4 AI sprinkle** (three `defineAiAgent` agents — war-room assistant, triage, postmortem writer — plus module-local one-shot AI routes for summary / customer-update draft / postmortem draft, similar-incidents retrieval via the platform search API, all soft-optional and human-in-the-loop).
- Plus one small research-grounded differentiator: **customer-update cadence** ("next update due" timers per severity on the existing sweep) — the comms-SLA feature incident.io/PagerDuty treat as core, delivered on infrastructure v2 already built.

**Research basis (2026-07-02 sweep):** incident.io (escalation-path preview, AI summaries/postmortems, update nudges), PagerDuty (escalation canon, Related Incidents, AI drafted updates), Jira SM (AI triage, similar incidents), Freshservice/Zendesk (SLA/priority), FireHydrant/Rootly (timeline/runbooks). Adopted: visual path preview, similar-incident retrieval, AI living summary + drafted updates + postmortem draft, AI triage, update cadence. Skipped (edition line unchanged): paging/SMS/voice, on-call rotations, round-robin, AIOps ingestion, autonomous remediation, public status pages.

**Concerns:**
- The wildcard (`event: '*'`) trigger subscriber runs on every platform event — mitigated exactly the way `webhooks` already does (fast early-exit + per-tenant match), plus a self-module guard so incidents events can never trigger incidents (loop protection).
- AI features depend on a configured ai-assistant provider — every AI surface is soft-optional, hidden when unavailable, and **never auto-mutates** (drafts fill forms/composers; agent-initiated writes go through `prepareMutation` approval).
- `incident_settings.auto_incident_triggers` (v2, pre-release) is dropped in favor of the `incident_trigger` entity — a data migration converts existing rows; no released surface breaks.

## Gate decisions (Open Questions resolved from repo context — recorded, not blocking)

| Q | Decision | Why |
|---|---|---|
| Trigger config: keep `incident_settings.auto_incident_triggers` JSONB vs new entity? | **New `incident_trigger` entity** + CRUD + data-migrate the JSONB, then drop it | Entity gives list UI, per-row optimistic locking, per-trigger severity/type/policy, and mirrors how `webhooks` stores per-subscription state. Pre-release, so no BC break. |
| How to subscribe to arbitrary events? | **One persistent `event: '*'` subscriber** matching DB-configured triggers | Exact `webhooks/subscribers/outbound-dispatch.ts` precedent (`metadata.event: '*'` + per-record event matching). No dynamic subscriber registration exists; this is the canonical mechanism. |
| AI one-shot generation mechanism? | `defineAiAgent` **`executionMode: 'object'` + `output` Zod schema**, executed server-side by module-local `/api/incidents/**/ai/*` routes that **import `runAiAgentObject` from `@open-mercato/ai-assistant`** (exported at `agent-runtime.ts`; `@open-mercato/core` already depends on the package — precedent `customers/ai-tools/deals-pack.ts`) and map `AiModelFactoryError('no_provider_configured')` → structured 503 | Verified by the pre-implement audit: there is **no DI seam** for the runtime (`ai_assistant/di.ts` registers only `mcpToolRegistry`); direct import is the platform-legal path. Module-local routes keep RBAC/feature-gating and graceful degradation in the incidents module. |
| Dashboard widget title i18n? | **No shared-type change.** `DashboardScreen.tsx:183-198` + `WidgetVisibilityEditor.tsx:59-96` already resolve widget titles via **id-derived i18n keys** with `metadata.title` fallback — v3 just adds the convention keys for the three incidents widgets to all 4 locales | Verified by the pre-implement audit; the v2 "platform lacks titleKey" deviation note was stale. Zero cross-package edit needed. |
| Team escalation targets? | Wire to **staff module teams** (`StaffTeam`, list API), soft-optional | Staff owns teams; the policy target type `'team'` already exists in v2 schema — only the editor lookup was missing. Staff absent → option hidden, existing targets render read-only. |
| Priority matrix (impact × urgency)? | **Not in v3** — severity-driven SLA stays | v1 gate already chose severity-first; the matrix duplicates severity for this domain and belongs with the enterprise advanced-SLA engine. Noted as enterprise follow-up. |
| Reverse flows ("Declare incident" row-action on orders/customers lists)? | **Not in v3** — follow-up | The user's ask is picking events/objects *from incidents*; order/account pages already surface incidents via v2 enrichers/widgets. Keeps the diff bounded. |

## Problem Statement

The shipped module passes `yarn i18n:check-sync` yet shows English in Polish mode because **262 of 565 `pl.json` values are verbatim English** (e.g. `incidents.nav.incidents = "Incidents"`, `incidents.nav.group = "Operations"`) and **seeded catalog labels are English data strings** (`'Critical'`, `'Customer impacting'`, `'Commander'`) rendered as-is in badges, selects, lists, and the portal. Integration stops at two hardcoded auto-incident subscribers and UUID text inputs for impact targets — an operator cannot say "open an incident when *any* chosen platform event fires" nor "this incident affects *that* order" without pasting IDs. The v2 escalation model is sound but its configuration UX is unfinished (no team targets, no SLA matrix editor, no path visualization), and several buttons ellipsize. There is no AI anywhere in the module while every 2026 competitor ships summaries, drafted updates, triage, and similar-incident retrieval as table stakes.

## Proposed Solution

Finish the module to best-in-class on the platform's own primitives — no new frameworks, no edition-line changes:

1. **W1 — i18n you can trust:** real translations (not key parity), i18n-resolved catalog labels with stored-label fallback, dashboard-widget locale keys (platform convention), and a **locale-coverage unit test** that fails the build if `pl.json` regresses to English outside an explicit allowlist.
2. **W2 — escalation & UI polish:** the incident.io-style **visual escalation-path preview** (shared by the policy editor and a war-room "view policy" popover), staff-team targets, an SLA-targets matrix editor, and an empirical Polish-mode truncation pass with hard rules (action buttons never truncate).
3. **W3 — deep integration:** `incident_trigger` entity + settings manager driven by the platform `EventSelect` (full event catalog, `excludeFromTriggers` honored) + one wildcard dispatch subscriber (webhooks pattern) with loop-guard and the existing `source_event_ref` dedupe; `RecordSelect` async pickers so impacts and the create form link real customers/companies/orders/quotes/invoices/credit-memos by search (`customer_account` targets keep the plain-id input in v3 — no cleanly-guarded admin list route exists), soft-optional per peer module.
4. **W4 — AI sprinkle (human-in-the-loop):** agents `incidents.assistant` (chat, war-room `<AiChat>`), `incidents.triage` (object), `incidents.postmortem_writer` (object); read tools + ONE `prepareMutation`-gated write tool; module-local one-shot routes for living summary, customer-update draft (fills the composer), postmortem draft (fills the form), and create-form triage suggestions; similar-incidents card on search API (works without AI). Everything hidden when ai-assistant/provider is absent.
5. **W5 — customer-update cadence:** per-severity update timers on the existing sweep; "update overdue" chip + notification; posting a customer-facing update resets the clock.

### Design Decisions

| Decision | Rationale |
|---|---|
| One wildcard subscriber + DB-configured triggers (vs N generated subscribers) | Mirrors `webhooks` `outbound-dispatch` exactly; subscriber files are static, so per-event subscribers cannot cover a user-chosen event set. Early-exit on non-matching events keeps cost ~0. |
| Self-module guard: events with `eventId` starting `incidents.` never match triggers; `excludeFromTriggers` events filtered in both UI and runtime | Prevents incident-creates-incident loops and honors the platform's own trigger-exclusion contract. |
| Catalog labels: translate at **render time** via `incidents.catalog.<kind>.<key>` with stored-label fallback | Zero schema change; seeded keys get translations in all 4 locales; user-created custom entries keep their typed label. Applied via one shared helper so list/detail/selects/settings/portal/notifications agree. |
| AI = drafts + approval, never auto-writes | `prepareMutation` is mandatory for agent writes (framework fails closed); one-shot routes return JSON the UI puts into forms/composers the human submits through existing guarded mutations. Keeps audit, undo, optimistic locking intact. |
| Similar incidents via platform search API (vector when configured, fulltext fallback), not an LLM call | Works for every deployment (no provider needed), instant, and `search.ts` already indexes incident title/description. |
| Update-cadence on the existing sweep worker | v2 already runs a 60s idempotent sweep with set-once guards; one more due-check reuses the whole concurrency design instead of new timers. |

## Architecture

### W3 runtime — trigger dispatch (the "any event" path)

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
     Tenant-only events are therefore not trigger-able in v3 — documented limitation,
     identical to the v2 hardcoded subscribers' behavior.
  5. load enabled incident_trigger rows for (organizationId, tenantId, eventId) —
     a direct indexed DB lookup per event, NO cache (the webhooks precedent queries per
     event too; the composite partial index makes this a single cheap probe; a cache is
     a future optimization, deliberately out of v3 to avoid staleness/invalidation)
  6. none                                                   → return (the ~always path)
  7. per trigger: evaluate `conditions` (AND of scalar equality predicates over
     dot-paths into the payload, e.g. [{ path: 'reauthRequired', equals: true }]);
     any predicate false/unresolvable ⇒ skip this trigger
  8. dispatch the existing create command (as-built id: `incidents.incidents.create`,
     `commands/incident.ts` — keep the shipped id; renames are out of scope) with
     severity/type/policy from the trigger row (fallback to catalog defaults) and
     source_event_ref computed deterministically:
       (a) first stable id string among payload.id, payload.recordId, payload.entityId
       (b) else sha256 over the sorted top-level scalar entries of the payload,
           excluding volatile keys (/(^|_)(at|time|timestamp|date)s?$/i)
       (c) neither (empty scalar projection) ⇒ create WITHOUT dedupe + warn log
     → the existing source_event_ref partial-unique dedupes redelivery for (a)/(b)
  9. failures logged, never rethrown to the bus (subscriber isolation, v1 rule)
```

The two v2 subscribers (`auto-incident-data-sync.ts`, `auto-incident-integrations.ts`) are **removed**; the migration seeds equivalent `incident_trigger` rows so behavior is preserved (see Migration).

### W4 — AI surfaces

- `ai-agents.ts` declares five agents (ids FROZEN on release; the summary and customer-update routes are backed by dedicated object agents `incidents.summarizer` and `incidents.customer_update_writer` so each output has a registered zod schema):
  - **`incidents.assistant`** — `executionMode: 'chat'`, embedded via `<AiChat agent="incidents.assistant" />` in a war-room side sheet; `resolvePageContext` injects the current incident id; `requiredFeatures: ['incidents.incident.view', 'incidents.ai.use']`; `mutationPolicy: 'confirm-required'`.
  - **`incidents.triage`** — `executionMode: 'object'`, `output: z.object({ severityKey, typeKey, rationale, possibleDuplicateIds: z.array(z.string()) })`; `readOnly`.
  - **`incidents.postmortem_writer`** — `executionMode: 'object'`, `output`: the postmortem field set + suggested action items; `readOnly`.
- `ai-tools.ts` (ids FROZEN on release), each with **explicit per-tool `requiredFeatures`** (not only the agent-level gate): `incidents.list_incidents` + `incidents.get_incident` (detail + timeline + impacts) + `incidents.find_similar_incidents` (search API) — all `['incidents.incident.view']`; `incidents.add_timeline_note` (**the only mutation tool**; routes through `prepareMutation`; `['incidents.incident.manage']`).
- Module-local one-shot routes (all `requireAuth` + `requireFeatures: ['incidents.incident.view','incidents.ai.use']`, POST, zod-validated, `openApi`): they call `runAiAgentObject` (direct import from `@open-mercato/ai-assistant` — verified export; no DI seam exists) inside try/catch, mapping `AiModelFactoryError` with code `no_provider_configured` (see `model-factory.ts`) — and any runtime-unavailable failure — to a structured 503 with an i18n'd client message. The UI hides the buttons up-front via an availability probe (`GET /api/incidents/ai/availability` → `{ available: boolean }`, implemented by the same error-mapped cheap model-factory resolution — NOT `/api/ai_assistant/health`, which probes OpenCode/MCP and is the wrong signal).
  - `POST /api/incidents/[id]/ai/summary` → `{ summary, keyEvents[] }` (from timeline; rendered in an AI card; optional "Post as internal note" button submits through the existing guarded timeline mutation).
  - `POST /api/incidents/[id]/ai/customer-update` → `{ draft }` (pre-fills the customer-facing composer; human edits and posts).
  - `POST /api/incidents/[id]/ai/postmortem-draft` → postmortem fields + suggested action items (pre-fills the postmortem form; human saves).
  - `POST /api/incidents/ai/triage` `{ title, description }` → triage suggestion (create form "Suggest" button; duplicates list falls back to pure search when AI is absent).
- **Never auto-mutate:** no AI path writes without an explicit user submit (or a `prepareMutation` approval in chat). PII: prompts send incident text already covered by the v1 encryption-scope decision; no new persisted AI columns in v3 (generated drafts live in the form state until the human saves through existing encrypted fields).

### W1 — catalog label resolution

`backend/incidents/lib/catalogLabels.ts` (client-safe): `resolveCatalogLabel(t, kind: 'severity' | 'type' | 'role', key: string, storedLabel: string)` → returns `t(\`incidents.catalog.${kind}.${key}\`)` when the key exists, else `storedLabel`. Used by the list severity badge, detail sidebar, all selects, settings tables, portal list, and notification renderers. Seeded keys (`sev1..sev4`, `operational`, `customer_impacting`, `security`, `maintenance`, `commander`, `comms_lead`, `scribe`, `responder`) get entries in en/de/es/pl.

### Cross-module coupling delta (all soft-optional, unchanged mechanisms)

| Peer | v3 use | Mechanism |
|---|---|---|
| **all modules** | user-chosen trigger events | wildcard subscriber + `EventSelect`/`GET /api/events` catalog (platform-owned). `EventSelect` gains an **additive optional `excludeModules?: string[]` prop** (it currently cannot exclude a module, so `incidents.*` events would appear in their own trigger picker) — used with `['incidents']`; server zod remains the hard guard |
| `staff` | team escalation targets + team labels in previews | `GET /api/staff/teams` (verified; feature `staff.view`; `?search=&ids=&isActive=`) — absent/403 ⇒ team option hidden, existing targets render as id chip |
| `customers` / `sales` | `RecordSelect` impact pickers | verified routes: `GET /api/customers/people` / `GET /api/customers/companies` (`?search=`, features `customers.people.view`/`customers.companies.view`); `GET /api/sales/orders|quotes|invoices|credit-memos` (`?search=`). **`customer_account` targets keep the plain-id input in v3** (no cleanly-guarded admin list route exists — verified); fetch failure/absence ⇒ degrade to plain id input (v2 `UserSelect` precedent) |
| `ai_assistant` | agents, tools, one-shot routes, `<AiChat>` | direct import of exported `runAiAgentObject` (verified: no DI seam; core already depends on the package; precedent `customers/ai-tools/deals-pack.ts`) + error-mapped availability probe |
| `search` | similar incidents | `GET /api/search/search` (verified; feature `search.view`; entity-filtered to incidents); works with fulltext when vector is off |
| `dashboards` | widget title i18n | **additive** `titleKey?`/`descriptionKey?` on `DashboardWidgetMetadata`; resolution happens **client-side at the render site** (the component that displays `metadata.title`) via `useT` with fallback to the literal `title` — API routes returning raw metadata are untouched |

**Anti-patterns (unchanged, forbidden):** cross-module ORM relations/imports of peer entities; emitting incidents events from peers; direct provider API calls bypassing ai-assistant; raw `fetch`.

## Data Models (v3 delta only)

### incident_trigger (`incident_triggers`) — NEW
- `id`, `organization_id` (**NOT NULL**, like every incidents entity), `tenant_id`
- `event_id` (string — platform event id, e.g. `data_sync.run.failed`)
- `is_enabled` (bool, default true)
- `severity_key` (string nullable → default severity when null), `type_key` (string nullable), `escalation_policy_id` (uuid nullable, FK-id → incident_escalation_policy)
- `conditions` (jsonb nullable — `Array<{ path: string, equals: string | number | boolean }>`, AND'd scalar-equality predicates over payload dot-paths; null/empty = always fire). This preserves the legacy predicate semantics (the v2 integrations subscriber fired only on `reauthRequired === true`).
- `created_at`, `updated_at`, `deleted_at` — **partial-unique** `(organization_id, tenant_id, event_id)` where `deleted_at is null`; **composite index** `(organization_id, tenant_id, event_id, is_enabled)` where `deleted_at is null` (the dispatch hot path)
- `updated_at` returned by list/detail (optimistic locking default-ON)

### incident (additive)
- `next_update_due_at` (Date nullable) — customer-update cadence due; set on create/severity-change and after each customer-facing timeline entry when a cadence is configured for the severity and the incident is active; cleared on resolve/close.
- `update_overdue_notified_at` (Date nullable) — the sweep's set-once claim for a due window: the overdue notification fires via an atomic conditional UPDATE `WHERE next_update_due_at <= now() AND (update_overdue_notified_at IS NULL OR update_overdue_notified_at < next_update_due_at)`, so a double tick never double-notifies and `next_update_due_at` stays in the past (the war-room chip derives "overdue" from it). Posting a customer-facing update recomputes `next_update_due_at` and clears `update_overdue_notified_at`.

### incident_settings (changed — pre-release surface)
- **Add** `update_cadence` (jsonb nullable — `{ [severity_key]: { update_minutes: number } }`; absent key ⇒ no cadence for that severity).
- **Drop** `auto_incident_triggers` (jsonb) — superseded by `incident_trigger` rows; migration converts existing entries.

### Shared (additive)
- `EventSelect` (packages/ui) gains an optional `excludeModules?: string[]` prop (ADDITIVE-ONLY; default behavior unchanged).
- ~~`DashboardWidgetMetadata.titleKey`~~ — **not needed** (verified: `DashboardScreen.tsx:183-198` already resolves widget titles via id-derived i18n keys with `metadata.title` fallback); v3 only adds the convention locale keys for the three incidents widgets.

## API Contracts (v3 delta)

- `GET/POST/PUT/DELETE /api/incidents/triggers` — `makeCrudRoute` CRUD (+`openApi`, `list.entityId`/`indexer.entityType` `E.incidents.incident_trigger`), feature `incidents.settings.manage`. Zod: `event_id` non-empty, must not start with `incidents.`, and must not be marked `excludeFromTriggers` in the declared-event registry (ids absent from the registry are allowed — the source module may be temporarily disabled — but flagged in the UI); `conditions` validated against the predicate schema; `severity_key`/`type_key` validated against catalogs; `escalation_policy_id` must resolve when present.
- `GET /api/incidents/ai/availability` → `{ available }` — view-gated, cheap DI probe.
- `POST /api/incidents/ai/triage`, `POST /api/incidents/[id]/ai/summary`, `POST /api/incidents/[id]/ai/customer-update`, `POST /api/incidents/[id]/ai/postmortem-draft` — as in Architecture §W4 (all zod-validated, `openApi`, graceful 503 when AI absent; no persistence).
- Existing routes unchanged. (Similar incidents uses the platform `GET /api/search/search` — no new route.)

## Internationalization (W1 — the headline fix)

1. **Translate the backlog:** every `pl.json` value currently identical to `en.json` gets a real Polish translation (same for `de.json`/`es.json`), except an explicit allowlist of legitimately-identical terms (`MTTA`, `MTTR`, `SLA`, `OK`, product-name-like strings). Translations follow the repo's existing Polish voice (see `customers`/`sales` pl locales for register).
2. **Catalog labels** resolve through `resolveCatalogLabel` (§Architecture) — new keys `incidents.catalog.{severity|type|role}.<key>` in all 4 locales.
3. **Dashboard widgets**: add the id-derived convention keys the platform already resolves (`DashboardScreen.tsx:183-198` / `WidgetVisibilityEditor.tsx:59-96` — implementer copies the exact key convention from there) for `incidents-active`, `incidents-mtta-mttr`, `incidents-revenue-at-risk` titles/descriptions in all 4 locales. No shared-type change.
4. **Nav/meta audit:** every incidents `page.meta.ts` (list, create, detail, settings, postmortems) and the portal page carry `pageTitleKey`/`pageGroupKey`/breadcrumb `labelKey`s; group key values verified against how sibling modules name shared groups.
5. **Regression guard (new unit test):** `__tests__/i18n-locale-coverage.test.ts` flattens `en` vs each other locale and **fails** when a non-allowlisted value is byte-identical to English or a key is missing. This is what key-sync could not catch.
6. `yarn i18n:check-sync` and module-scoped `yarn i18n:check-hardcoded` stay green; internal-only messages keep the `[internal]` prefix.

## UI/UX (DS rules apply verbatim; Boy-Scout on touched lines)

1. **Truncation pass (W2, empirical):** run the preview in **Polish**, audit every incidents page. Rules: **buttons never truncate** — labels size the button (`whitespace-nowrap`), toolbars wrap (`flex-wrap`) instead of clipping; data values may truncate but must carry a `title` tooltip; DataTable `maxWidth`s re-checked against Polish strings. Evidence: before/after screenshots in the PR.
2. **Escalation path preview (W2):** one shared component `EscalationPathPreview` renders a vertical path — "Natychmiast → powiadom **Zespół платform** (Alice, Bob) · po 15 min → poziom 2 …" — with resolved target labels (users/roles/teams), repeat count, and the exhaustion terminus. Used live in the policy editor (updates as steps change) and as a "View policy" popover on the war-room escalation card. Recipients resolved via the existing `escalate/preview` endpoint semantics.
3. **Policy editor completion (W2):** team targets via staff lookup (soft-optional); target chips show labels, never raw UUIDs.
4. **SLA matrix editor (W2):** per-severity grid (response min / resolution min / at-risk %) editing `incident_settings.sla_targets` with int validation — closes the v2 deviation.
5. **War-room AI (W4):** an "AI" card (Summarize → summary + key events, "Post as internal note" secondary action; availability-gated) + composer "Draft with AI" for customer-facing updates + header entry opening the `<AiChat>` side sheet. All buttons hidden when `/ai/availability` is false.
6. **Similar incidents card (W4):** war-room sidebar + create form (debounced on title) — top 5 with severity/status badges, linking to incidents; label notes it searches history. No AI dependency.
7. **Create form (W4):** "Suggest severity & type" (triage route) fills the selects with a visible rationale hint; duplicate warnings render above submit.
8. **Postmortem panel (W4):** "Draft from timeline" fills the form fields; human reviews and saves.
9. **Update cadence (W5):** war-room chip "Next customer update due in 12m" → overdue turns `warning` status token; settings gain the cadence matrix next to SLA targets.
10. Dialog keyboard rules, `aria-label`s, status tokens, lucide icons, `EmptyState`/`LoadingMessage` — per DS, unchanged.

## Access Control & Setup (delta)

- **New feature id `incidents.ai.use`** (FROZEN on release) gating every AI surface (routes probe + agents `requiredFeatures`). `defaultRoleFeatures`: granted to `admin` (via existing `incidents.*`) and `employee` (explicit).
- Trigger CRUD reuses `incidents.settings.manage`. No other ACL changes.
- `setup.ts seedDefaults` (idempotent, check-before-insert): seed the two default `incident_trigger` rows (`data_sync.run.failed` enabled; `integrations.state.updated` enabled with `conditions: [{ path: 'reauthRequired', equals: true }]`) **for new tenants only — it never reads the legacy JSONB** (by the time setup runs, the migration owns and has completed the legacy conversion; see Migration). Catalog-label keys need no seeding (render-time resolution).
- After implementation: `yarn mercato auth sync-role-acls`.

## Migration & Backward Compatibility

Pre-release branch: v1/v2 surfaces are still mutable; everything below FREEZES on release.

| Surface | v3 change | Class |
|---|---|---|
| Entity/table | `incident_trigger` (`incident_triggers`), `E.incidents.incident_trigger` | FROZEN on release |
| Incident columns | + `next_update_due_at` | additive |
| Settings columns | + `update_cadence`; **− `auto_incident_triggers`** (data-migrated) | pre-release change, migration provided |
| Event IDs | + `incidents.incident.update_overdue`; + `incidents.trigger.created/updated/deleted` (CRUD) | FROZEN on release |
| Notification type ids | + `incidents.update_overdue` | FROZEN on release |
| API routes | + `/api/incidents/triggers` (CRUD), `/api/incidents/ai/availability`, `/api/incidents/ai/triage`, `/api/incidents/[id]/ai/{summary,customer-update,postmortem-draft}` | STABLE |
| AI agent ids / tool ids | `incidents.assistant`, `incidents.triage`, `incidents.summarizer`, `incidents.customer_update_writer`, `incidents.postmortem_writer`; `incidents.{list_incidents,get_incident,find_similar_incidents,add_timeline_note}` | FROZEN on release |
| ACL | + `incidents.ai.use` | FROZEN on release |
| Shared UI prop | `EventSelect.excludeModules?: string[]` | ADDITIVE-ONLY (optional; default unchanged) |
| Entity id | `E.incidents.incident_trigger` (snake_case, matching the module's existing entity-id style) | FROZEN on release |
| Removed | subscribers `auto-incident-data-sync.ts`, `auto-incident-integrations.ts` (superseded by dispatch + seeded triggers) | pre-release removal, behavior preserved via migration |

**Migration:** one migration adds `incident_triggers` (+ indexes), `incident.next_update_due_at`, `incident.update_overdue_notified_at`, `incident_settings.update_cadence`; **the migration itself** converts each legacy `auto_incident_triggers` JSONB entry to an `incident_trigger` row (preserving enabled/severity/type; the `integrations.state.updated` entry gains the `reauthRequired` condition; inserts are idempotent — `ON CONFLICT DO NOTHING` against the partial-unique — so duplicate/inconsistent legacy entries collapse safely); then drops the JSONB column. The same change removes the two legacy subscribers, so no code path reads the dropped column after this lands (single pre-release branch — deployed atomically). Reviewed SQL + snapshot committed (`yarn db:generate`; delete unrelated generator output per repo rule). Re-runnable; no released surface broken.

## Search / Encryption (delta)

- No search-config change (similar-incidents reads the existing index). No new encrypted columns; AI drafts are not persisted by AI routes (they land in existing encrypted fields only when the human saves). Prompt content stays within the v1 encryption-scope decision.

## Implementation Plan

> One lean commit per step; `yarn generate` after discovery-file changes; `yarn db:generate` after entity changes; each phase ends green (typecheck/test + its integration tests).

### Phase 1 — i18n completeness (W1)
- [x] Translate all EN-identical values in `pl.json`, `de.json`, `es.json` (allowlist file for legitimate identicals); repo-voice Polish.
- [x] `catalogLabels.ts` helper + `incidents.catalog.*` keys (4 locales) + apply at every catalog-label render site (list, detail, selects, settings, portal, notification renderers).
- [x] Dashboard-widget locale keys per the platform's existing id-derived convention (no shared-type change; see i18n §3).
- [x] Nav/meta audit: `pageTitleKey`/`pageGroupKey`/breadcrumb `labelKey` on all module pages incl. portal.
- [x] `__tests__/i18n-locale-coverage.test.ts` regression guard.
- [x] **Tests:** the coverage guard itself; `yarn i18n:check-sync` green.

### Phase 2 — escalation & UI polish (W2)
- [x] `EscalationPathPreview` shared component; wire into policy editor (live) + war-room escalation card ("View policy" popover).
- [x] Team targets: staff-team lookup select in the policy editor (soft-optional; exact staff route verified here); label resolution in previews/cards.
- [x] SLA-targets matrix editor in settings.
- [x] Polish-mode truncation pass on all module pages per UI/UX §1 (button rules; screenshots as evidence).
- [x] **Tests:** policy editor round-trip with team target (staff present) and hidden option (absent); SLA editor persists matrix; unit test for preview label resolution.

### Phase 3 — deep integration (W3)
- [x] `IncidentTrigger` entity + migration (incl. JSONB conversion + drop) + validators + CRUD route + events (`incidents.trigger.*`) + `E.incidents.incident_trigger`.
- [x] `subscribers/auto-incident-dispatch.ts` (wildcard, loop-guard, TTL cache, `source_event_ref` dedupe, per-trigger severity/type/policy); delete the two v2 subscribers; `setup.ts` seed rules.
- [x] Settings "Auto-incident triggers" manager: table + add/edit dialog with `EventSelect` (`excludeTriggerExcluded`), severity/type/policy selects, enable toggle.
- [x] `RecordSelect` component (per-target-type search over peer list APIs, soft-optional degrade to id input) + wire into ImpactPanel add-impact and create form affected-records fields. **Note (verified):** the existing `impact.add` command takes `snapshot`/`revenueAmountMinor`/`revenueCurrency` from the client — `RecordSelect` populates them from the picked record's list-API result (label stays non-PII per the v1 rule: order number / business name / component name), preserving the existing command contract unchanged.
- [x] **Tests:** trigger CRUD (validation incl. `incidents.*` rejection, RBAC, tenant isolation, optimistic lock); dispatch creates-once under redelivery, respects disabled, loop-guard, applies severity/type/policy; migration converts JSONB; RecordSelect impact add end-to-end.

### Phase 4 — AI (W4)
- [x] `ai-agents.ts` (3 agents) + `ai-tools.ts` (4 tools; `add_timeline_note` via `prepareMutation`) + `incidents.ai.use` ACL + grants + `yarn generate`.
- [x] AI routes (`availability`, `triage`, `summary`, `customer-update`, `postmortem-draft`) with DI-resolved runtime, zod, `openApi`, graceful 503.
- [x] War-room AI card + composer draft button + `<AiChat>` side sheet; create-form triage suggest; postmortem draft button; similar-incidents card (search API) in war-room + create form.
- [x] **Tests:** availability=false hides surfaces + routes 503 i18n'd; triage route validation; tool RBAC (mutation tool needs `manage`; agents need `incidents.ai.use`); similar-incidents card renders from search results (mocked); agent registry passes `yarn generate`.

### Phase 5 — customer-update cadence (W5)
- [x] Settings `update_cadence` editor; `next_update_due_at` set/reset logic in create/severity/transition/timeline commands; sweep due-check (set-once, atomic guard) emitting `incidents.incident.update_overdue` + notification; war-room chip.
- [x] **Tests:** cadence set → due computed; sweep emits once per due window; customer-facing update resets; resolve clears; no cadence ⇒ untouched.

### Phase 6 — docs + spec sync
- [x] Update the v1/v2 spec header + changelog pointing here; move nothing to `implemented/` (branch not merged).
- [x] Verify `yarn i18n:check-sync`, full gate, integration suite.

## Integration Test Coverage (v3 — ships with the change)

Self-contained fixtures (API-created, cleaned in teardown; policy-compliant passwords; unique codes; workers=1 where round-trips asserted):

**API:** triggers CRUD (happy/validation/`incidents.*`-rejection/RBAC 403/tenant isolation/optimistic-lock 409/`?ids=`); wildcard dispatch — enabled trigger + synthetic peer event → incident created with trigger's severity/type/policy, **redelivery creates exactly one** (`source_event_ref`), disabled trigger → none, `incidents.*` event → never, absent scope → no-op; migration seeds triggers from legacy JSONB; AI routes — availability false ⇒ 503 with i18n'd body + probe false, triage input validation 400, RBAC (`incidents.ai.use` missing ⇒ 403); cadence — due set on create per settings, sweep emits `update_overdue` once (double-tick safe), customer-facing timeline entry resets `next_update_due_at`, resolve clears.
**UI (Playwright):** settings → add trigger via EventSelect and see it dispatch (fixture event); impact add via RecordSelect picking a fixture order → snapshot/revenue rendered; policy editor shows path preview incl. team target; SLA matrix edit persists; Polish-mode smoke asserting translated nav + list headers (`pl` locale fixture) — the regression the user reported; war-room AI card hidden without provider.
**Unit:** i18n locale-coverage guard; catalog-label resolver fallback; dispatch matcher (loop-guard, cache); preview label resolution.

## Risks & Impact Review

- **Wildcard subscriber overhead** — every platform event probes the trigger cache. *Severity: Medium.* Mitigation: `webhooks` ships the identical pattern in production; early-exit + per-tenant TTL cache; integration test asserts no-op cost path (no DB hit on cache warm). Residual: negligible.
- **Event-storm / loops** — a trigger on a chatty event floods incidents. *Severity: Medium.* Mitigation: `incidents.*` hard-excluded; `excludeFromTriggers` honored; `source_event_ref` partial-unique dedupes per source entity; per-trigger disable is one click. Residual: an operator can still pick a noisy event — visible and reversible in settings.
- **AI unavailability/failure mid-flow** — provider down or unconfigured. *Severity: Low.* Mitigation: availability probe hides UI; routes return structured 503; no AI path blocks core incident flows; drafts are never persisted server-side. Residual: none material.
- **AI content quality** — wrong severity suggestion / bad draft. *Severity: Low.* Mitigation: human-in-the-loop everywhere (fills forms; approval gate for the one mutation tool); rationale surfaced. Residual: acceptable.
- **Translation quality** — machine-flavored Polish. *Severity: Low.* Mitigation: repo-voice reference locales; allowlist keeps technical terms; native review invited in PR. Residual: cosmetic.
- **Dropping `auto_incident_triggers`** — dev DBs on the feat branch lose config. *Severity: Low.* Mitigation: data migration converts rows; branch is pre-release. Residual: none.
- **Shared dashboards type change** — cross-package edit. *Severity: Low.* Mitigation: optional fields + fallback (ADDITIVE-ONLY compliant); dashboards resolver change covered by a unit test. Residual: none.

## Final Compliance Report — 2026-07-02

Reviewed: root `AGENTS.md` (Task Router rows: Module Development, API Routes, Events, Notifications, Widget Injection, AI agents, Search, Access Control, optimistic locking), `ARCHITECTURE.md` §4/§7/§9/§11/§13/§14/§15/§16/§25/§27/§31, `BACKWARD_COMPATIBILITY.md`, `packages/ai-assistant/AGENTS.md`, `packages/events/AGENTS.md`, `packages/ui/AGENTS.md`, `.ai/ds-rules.md`, `.ai/ui-components.md`, webhooks wildcard-subscriber precedent, `om-create-ai-agent` skill.

| Rule | Status | Note |
|---|---|---|
| No cross-module ORM relations / peer entity imports | Compliant | trigger rows store event-id strings; pickers use peer HTTP APIs; AI via DI |
| Tenant/org scoping everywhere incl. dispatch + cache keys | Compliant | dispatch requires scope; cache keyed tenant:eventId |
| CRUD via `makeCrudRoute` + indexer/list ids; zod; openApi | Compliant | triggers CRUD |
| Optimistic locking default-ON (new editable entity) | Compliant | `incident_triggers.updated_at` in responses; CrudForm-derived header |
| Commands/undo for writes; subscriber isolation | Compliant | dispatch reuses create command; failures logged not rethrown |
| UMES boundary (no editing peers; additive shared type change flagged) | Compliant | only dashboards resolver additive change, declared in BC table |
| AI mutation approval (`prepareMutation`), feature-gated, soft-optional | Compliant | single mutation tool; `incidents.ai.use`; availability probe |
| Event id convention (`module.entity.action`) | Compliant | `update_overdue` mirrors the `escalation_exhausted` state-announcement precedent |
| DS tokens / primitives / no arbitrary values; dialogs' keys; `aria-label` | Compliant | UI/UX section binds them; Boy-Scout on touched lines |
| i18n: no hardcoded user-facing strings; `[internal]` prefix rule | Compliant | W1 + regression guard |
| Enterprise line (§25) | Compliant | no status pages / rotations / paging / AIOps / advanced SLA; priority matrix deferred to enterprise |

**Verdict: approved for implementation** (implementation-time verifications: exact staff-teams route path + feature id; exact customers/sales list route paths for `RecordSelect`; ai-assistant server-side object-execution helper name; dashboards title render site).

## Changelog

### 2026-07-02 — Timeline pagination (long-incident scroll)
The war-room timeline (`Oś czasu`) loaded a fixed `pageSize=50` and rendered every entry with no "load more", so (a) entries beyond 50 were unreachable and (b) even 50 was a very long scroll on high-activity incidents. Fixed: the timeline API now returns `total`/`page`/`pageSize` (adds a cheap `em.count`); the panel loads the **20 most recent** entries initially and shows a **"Load older entries (N)"** button that fetches and prepends the next page on demand (de-duplicated by entry id), so a busy incident stays compact by default and its full history is still reachable. Verified against a 46-entry incident: initial 20 + "(26)" → click → 40 + "(6)" → click → all 46.


### 2026-07-02 — Escalation-status list column + filter
Added a visible **Escalation** column to the incidents list (per-row status badge — escalating/acknowledged/exhausted, or muted "not set") plus an **Escalation** filter (`GET /api/incidents?escalationStatus=…` + a list-page filter dropdown) so operators can see only escalated incidents: options are `escalated` (active or exhausted — the convenience "anything escalating or exhausted"), `active` (currently escalating), `acknowledged`, and `exhausted`, mapped to `escalation_status` (already stored in the query index and returned in the list projection). Works with perspectives/saved views like the other filters. (Notifications context: escalation already emits in-app notifications — `escalation_started`/`escalated`/`escalation_exhausted` to the policy step's resolved recipients, plus `assigned`, `update_overdue`, and account-manager alerts — but those reach concrete people only when the policy's role/team targets resolve to real users; a dedicated broadcast-to-all-admins-on-new-incident channel remains a deliberate product decision, not shipped.)

### 2026-07-02 — Polish-mode UI review fixes (manual QA follow-up)
Fixes from a live Polish-mode walkthrough: (1) war-room severity/type and create-form severity/type option labels now resolve through `resolveCatalogLabel` (were rendering seeded English labels — "High"/"Security" — in `pl` mode; `severityLabel` no longer short-circuits on the raw stored label); (2) the merge action's `pl` label was a dangling "Scal z..." (mirrored "Merge into..." and read as truncated) — Link + Merge are consolidated into a single "More" (`Więcej`) popover with complete labels ("Scal z innym incydentem"), which also (3) keeps the header action bar on one row (the two selects' `min-w` trimmed so all controls fit); (4) the participant "role id" free-text UUID input is now a searchable `RoleSelect` dropdown (new `components/RoleSelect.tsx` + `useRoleLabel`) resolving role labels to the active locale, and the participant list renders the resolved role label instead of the raw UUID. Bonus fixes found during the walkthrough: the timeline rendered raw actor UUIDs — now resolved to user labels via `useUserLabels`; the "Acknowledge" action no longer shows on resolved/closed incidents (escalation is already inactive there); the war-room "Escalate now" action was still offered on resolved/closed incidents (the panel only knew the escalation status, not the lifecycle status) and hitting it returned `409 incident is resolved or closed` — the escalate action is now gated on a `canEscalate` (non-terminal) flag while "View policy" stays available (read-only). Manual API verification (all pass): required-fields-on-resolve gate (400 + field errors), resolve-with-fields, reopen-via-transition, escalation bounded → 409 `escalation_exhausted`, ack halts escalation, merge → source closed + read-only (409) + escalation cleared, customer-update cadence set-and-reset. Full gate green; 53 incidents unit tests pass.

### 2026-07-02 — Implemented (Fable orchestrator; Codex 5.5 implementer packets A–H; four-reviewer jury)
All five workstreams shipped on `feat/incidents-v3`. Verification: full CI gate green (build:packages, generate, i18n:check-sync, typecheck, full unit suite 22/22 turbo tasks, build:app); migration validated from zero on a fresh DB AND its legacy-JSONB conversion empirically validated against a legacy-shaped dataset (3 entries → 3 rows, conditions seeded for `integrations.state.updated`, ON CONFLICT idempotent re-run inserts 0; transactional, rolled back); TC-INC-010..015 integration specs pass against a live isolated environment (TC-INC-013 is retry-flaky under parallel workers — tenant-singleton `incident_settings` contention, annotated in both settings-mutating specs); DS guardian PASS on ~2,000 changed UI lines; Polish-mode UI verified via live screenshots (list, settings, war room).
**Implementation deviations (deliberate):** five agents not three (`incidents.summarizer` + `incidents.customer_update_writer` back the summary/customer-update routes so each output has a registered schema); `EventSelect.excludeModules` additive prop (audit finding: incidents' own events would otherwise appear in the trigger picker); no dispatch cache (webhooks precedent queries per event); dashboards title i18n via the platform's existing id-derived key convention (no shared-type change).
**Latent v2 bugs fixed en route (exposed by the new integration tests):** BigInt revenue serialization crashed every impacts read/write carrying revenue (entity now `BigIntType('string')` + String() coercions at serialization boundaries); war-room background refreshes unmounted the page and killed open dialogs (`hasLoadedOnceRef` — full-page loader only on first load); escalation timeline rendered "level Not set" (`toLevel` metadata + 1-based display); `next_update_due_at`/`update_overdue_notified_at` added to the incident API projection.
**Code-review jury reconciliation (Claude fresh-reviewer + Codex + Kimi + DeepSeek):** dispatch gained a setup-phase try/catch so resolver/query failures never reject the subscriber (Codex+Kimi, 2-voter signal); setup seeding respects soft-deleted default triggers (no resurrection); all four AI tools additionally require `incidents.ai.use`; `customer_person` impact snapshots strip `label` server-side (PII defense-in-depth); trigger dispatch omits `escalationPolicyId` when the trigger has none so type/settings defaults resolve (DeepSeek — auto-incidents keep escalating); war-room policy popover resolves role labels via the catalog and team labels via staff lookup (no raw UUIDs); redelivery-dedupe + per-trigger isolation unit tests added (the exactly-once path the deleted v2 test covered); Polish register nits fixed (postmortem declensions, revenue phrasing). DeepSeek's trigger-optimistic-lock blocker was judged spurious: `makeCrudRoute` enforces the lock framework-level, proven by TC-INC-010's passing 409 case.

### 2026-07-02 — Cross-model spec-review + pre-implement-audit reconciliation (Codex gpt-5.5 fail→fixed, Kimi K2.7 fail→fixed, DeepSeek V4 Pro pass; auditor READY-WITH-FIXES)
Design blockers resolved before any code: dropped the invented dispatch TTL cache (webhooks queries per event — the precedent is cache-less; org-collision + invalidation blockers dissolve); dispatch requires payload tenant+org and mirrors webhooks' eventId resolution chain + skip-list (`incidents./application./query_index./webhooks.`) + runtime `excludeFromTriggers` check; added `incident_trigger.conditions` (AND'd scalar predicates) preserving the legacy `reauthRequired===true` semantics; migration owns the JSONB conversion (idempotent ON CONFLICT) while setup seeds new tenants only; deterministic `source_event_ref` chain (stable-id fields → volatile-key-filtered scalar hash → no-dedupe+log); cadence dedupe via `update_overdue_notified_at` claim column; per-tool `requiredFeatures`; corrected facts from the audit — `runAiAgentObject` direct import (no DI seam) + error-mapped availability probe, dashboards already resolve id-derived title keys (shared-type change removed), `GET /api/search/search`, as-built create command id `incidents.incidents.create`, `E.incidents.incident_trigger`, verified picker routes (staff teams, customers people/companies, sales document kinds), `customer_account` picker deferred (no guarded route), additive `EventSelect.excludeModules` prop.

### 2026-07-02
- Initial v3 delta spec: i18n completeness (translated locales, catalog-label resolution, dashboard `titleKey`, locale-coverage guard), escalation/settings UX completion (path preview, team targets, SLA matrix, truncation pass), deep integration (`incident_trigger` + EventSelect manager + wildcard dispatch, `RecordSelect` impact pickers), AI layer (3 agents, 4 tools, one-shot draft routes, similar-incidents, all human-in-the-loop + soft-optional), customer-update cadence on the existing sweep. Research-grounded against incident.io / PagerDuty / JSM / ServiceNow / Freshservice / FireHydrant / Rootly (2026 sweep).
