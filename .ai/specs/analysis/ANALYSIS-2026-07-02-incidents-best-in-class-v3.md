# Pre-Implementation Analysis: Incidents v3 — Best-in-Class Completion (i18n, Escalation Clarity, Deep Integration, AI)

Spec: `.ai/specs/2026-07-02-incidents-best-in-class-v3.md` (delta on `.ai/specs/2026-06-30-incident-management-module.md`, v1+v2 as-built on `feat/incidents`).
Analyzed: 2026-07-02, worktree `feat/incidents-v3`. Every claim below verified against code, not spec text.

## Executive Summary

The spec is architecturally sound, structurally complete (all required sections present, incl. Migration & BC), and its headline factual claims verify **exactly** (e.g. 262 of 565 `pl.json` values byte-identical to English — confirmed by flatten-diff). No BC violations exist under the stated pre-release framing (branch unmerged; v1/v2 surfaces mutable). However, **one mechanism claim is wrong (W4 "DI-resolved ai-assistant runtime" — no such DI registration exists)** and one gate decision (Q4, dashboard `titleKey`) rests on an incomplete premise — the platform already ships a widget-title i18n convention. Verdict: **READY-WITH-FIXES** — update the spec text per the corrections below, then implement; no architectural rework needed.

## Backward Compatibility

Note: `BACKWARD_COMPATIBILITY.md` defines **14** categories (the skill table lists 13; category 12 "AI Agent, Tool, UI Part, and Override IDs — FROZEN/STABLE" was added, `BACKWARD_COMPATIBILITY.md:201`). All 14 audited.

### Violations Found

| # | Surface | Issue | Severity | Proposed Fix |
|---|---------|-------|----------|-------------|
| — | (none) | All v3 changes are additive (new entity/table, new columns, new event/notification/ACL/agent/tool ids, new routes) or pre-release removals (JSONB column drop + 2 subscriber files) on the unreleased `feat/incidents` line, with a data migration preserving behavior | — | — |

Pre-release caveats to keep true at implementation time:
- Dropping `incident_settings.auto_incident_triggers` (exists: `packages/core/src/modules/incidents/data/entities.ts:698-699`) must also remove it from `settingsUpdateSchema`/settings API response and the settings page section — the spec implies but does not name the validator change (add to Phase 3 step 1).
- Removing subscribers `auto-incident-data-sync.ts` / `auto-incident-integrations.ts` (both exist; each subscribes to a single event id) is safe pre-release; the migration/seed plan matches the existing default-disabled JSONB seeds (`setup.ts:17-18`).
- If widget ids are renamed (see Q4 correction below), saved dashboard layouts on dev DBs reference the old `widgetId` — acceptable pre-release, but state the decision.

### Missing BC Section
Present and adequate (spec § Migration & Backward Compatibility).

## Spec Corrections (spec says → code says)

These MUST be applied to the spec before implementation; none change the architecture.

1. **W4 execution mechanism (Critical).** Spec: one-shot routes "resolve the ai-assistant runtime from DI with `allowUnregistered: true`". Code: `packages/ai-assistant/src/modules/ai_assistant/di.ts` registers **only `mcpToolRegistry`** — there is no DI-resolvable runtime. The working mechanisms are:
   - **Direct package import** — `runAiAgentObject` (`packages/ai-assistant/src/modules/ai_assistant/lib/agent-runtime.ts:1886`; re-exported from `@open-mercato/ai-assistant` root, `src/index.ts:171`). Legal from incidents: `packages/core/package.json:249` lists `@open-mercato/ai-assistant` as a dependency, and customers already runtime-imports it (`packages/core/src/modules/customers/ai-tools/deals-pack.ts:19` `defineApiBackedAiTool`, etc.).
   - **Platform HTTP route** — `POST /api/ai_assistant/ai/run-object` (`packages/ai-assistant/src/modules/ai_assistant/api/ai/run-object/route.ts`) already enforces the agent's `requiredFeatures` + `executionMode: 'object'` via `checkAgentPolicy` (`agent-policy.ts:173`). The UI could call it directly and drop most module-local routes.
   Pick one (recommend: module-local routes keep the spec's UX/i18n/503 contract and import `runAiAgentObject` directly; soft-optionality = catching `AgentPolicyError`/`AiModelFactoryError`, not DI absence).
2. **AI availability probe (Critical, dependent on #1).** No ready-made "provider configured" boolean exists. `/api/ai_assistant/health` checks **OpenCode/MCP** status and is gated `ai_assistant.view` (`api/health/route.ts:14-16`) — wrong probe for AI-SDK provider config. The model factory throws `AiModelFactoryError` with code `'no_provider_configured'` (`model-factory.ts:289`). The incidents `GET /api/incidents/ai/availability` route should attempt model resolution (imported factory) and map that error → `{ available: false }`; spec text "cheap DI probe" must be rewritten accordingly.
3. **Dashboard widget title i18n (Important — Gate Q4 premise incomplete).** Spec: "metadata has no i18n field today" → true for the type (`packages/shared/src/modules/dashboard/widgets.ts:5-18`), **but both render sites already resolve titles via an i18n key convention with fallback to `metadata.title`**: `packages/ui/src/backend/dashboard/DashboardScreen.tsx:183-198` (`resolveWidgetTitle`, tried keys `${id}.title`, `dashboard.widgets.${id}.title`, `${prefix}.widgets.${last}.title`; rendered at :474/:689) and `packages/core/src/modules/dashboards/components/WidgetVisibilityEditor.tsx:59-96` (`resolveWidgetText`). Dashboards' own widgets use dotted ids (`dashboards.analytics.revenueKpi`) + keys `dashboards.analytics.widgets.revenueKpi.title` in their locale files. Incidents ids are dash-form (`incidents-active`, `incidents-mtta-mttr`, `incidents-revenue-at-risk`; titles hardcoded English at `widgets/dashboard/*/widget.ts`). **Simplest compliant fix: add locale keys matching the existing convention (flat keys `dashboard.widgets.incidents-active.title` or rename ids to dotted `incidents.dashboard.active` → key `incidents.dashboard.widgets.active.title`) — no shared-type change, no resolver change.** The additive `titleKey?`/`descriptionKey?` remains ADDITIVE-ONLY-safe if explicitly preferred, but the spec must acknowledge the existing mechanism and justify (or drop) the shared change. Note: server-side `title` also flows through `api/layout/route.ts:183` and `api/widgets/catalog.ts:28`, which the client re-resolves.
4. **Search route (Important).** Spec: "platform `GET /api/search`". Code: **`GET /api/search/search`** (module prefix; `packages/search/src/modules/search/api/search/route.ts`; feature `search.view`; global variant `/api/search/search/global`). A reusable client helper exists: `packages/search/src/modules/search/frontend/utils.ts:37`.
5. **Create-command id (Minor).** Spec: dispatch reuses "`incidents.incident.create` command". Code: command id is **`incidents.incidents.create`** (`packages/core/src/modules/incidents/commands/incident.ts:394`). (Event ids are `incidents.incident.*` — only the command id differs.)
6. **Generated entity-id key (Minor).** Spec writes `E.incidents.incidentTrigger`; generated keys are snake_case (`E.incidents.incident`, `E.staff.staff_team`, `E.sales.sales_order`) → **`E.incidents.incident_trigger`**.
7. **Webhooks "lookup discipline" wording (Minor).** `outbound-dispatch.ts` has **no TTL cache** — it early-exits (`webhooks.`/`application.`/`query_index.` prefixes + `excludeFromTriggers` via `getDeclaredEvents()`, lines 17-47) then queries the DB per event. The incidents TTL cache is an improvement over, not a mirror of, webhooks. Keep the cache, fix the wording, and **add cache invalidation on trigger CRUD writes + a bounded-staleness note (TTL) for multi-process workers**.
8. **`customer_account` RecordSelect source (Important — was "verify at implementation", resolved).** Customers has **no accounts list route** (kinds are `person`/`company` only, `customers/data/entities.ts:13-28`). A `customer_account` impact `targetId` is `CustomerUser.customerEntityId` (see `incidents/api/portal/route.ts:99`, `customer_accounts/lib/customerAuth.ts:15`) — i.e. a customers-module entity id. Closest list API: `GET /api/customer_accounts/admin/users` (`?search=&page=&pageSize=&customerEntityId=`; **`export const metadata = {}` — no declarative feature guard, verify in-handler guard before relying**). Spec must pin: picker searches admin users mapping selection → `customerEntityId`, or `customer_account` degrades to the plain id input.
9. **Trigger EventSelect filtering (Important).** `EventSelect` supports only `excludeTriggerExcluded` (default true) — it has **no per-module exclusion**. Incidents' own events are NOT marked `excludeFromTriggers` (`incidents/events.ts` — correct, they must stay available to workflows), so `incidents.*` events WILL appear in the picker unless filtered. Add a client-side filter (or an additive optional `filterEvents` prop on `EventSelect`) alongside the already-specced zod rejection.

## Resolved Implementation-Time Verifications (from spec verdict)

| Item | Resolution |
|---|---|
| Staff teams route + feature | `GET /api/staff/teams` — flat-file route `packages/core/src/modules/staff/api/teams.ts`; GET gated `staff.view` (POST/PUT/DELETE `staff.manage_team`); list params `page,pageSize,search,ids,isActive,sortField,sortDir`; `makeCrudRoute` + `E.staff.staff_team`; `updated_at` in fields |
| Customers pickers | `GET /api/customers/people` (`customers.people.view`), `GET /api/customers/companies` (`customers.companies.view`) — both `?search=` (ILIKE on display_name/primary_email + search-engine assist) |
| Sales pickers | `GET /api/sales/{orders,quotes,invoices,credit-memos}` — all via `buildDocumentCrudOptions` (`sales/api/documents/factory.ts:78,103`): `?search=`; view features `sales.<kind>.view` |
| customer_account picker | See correction #8 |
| AI object-execution helper | `runAiAgentObject` (`agent-runtime.ts:1886`, exported from `@open-mercato/ai-assistant`); HTTP alternative `POST /api/ai_assistant/ai/run-object`; chat `POST /api/ai_assistant/ai/chat`; agent catalog `GET /api/ai_assistant/ai/agents` |
| Dashboards title render site | `packages/ui/src/backend/dashboard/DashboardScreen.tsx:183-198` (+ render :474/:689); `packages/core/src/modules/dashboards/components/WidgetVisibilityEditor.tsx:59-96`; server: `dashboards/api/layout/route.ts:183`, `dashboards/api/widgets/catalog.ts:28` |
| Events catalog | `GET /api/events` — `packages/events/src/modules/events/api/route.ts` (`metadata.path: '/events'`, GET `requireAuth` only, supports `excludeTriggerExcluded`, default true); consumed by `packages/ui/src/backend/inputs/EventSelect.tsx:78,162` |

## Verified-True Spec Claims (spot-audit of the delta baseline)

`auto_incident_triggers` JSONB exists (`entities.ts:698`); both v2 subscribers exist (single-event each); webhooks wildcard precedent exists (`outbound-dispatch.ts:12`, `event: '*'`, persistent); `defineAiAgent` supports `executionMode` + `output` + `requiredFeatures` + `mutationPolicy` + `resolvePageContext` (`ai-agent-definition.ts:298,404,382,386,405`); `DashboardWidgetMetadata` lacks `titleKey` (`widgets.ts:5`); pl.json = 565 keys / 262 EN-identical (exact); seeded catalog labels are English data strings with keys `sev1..sev4/operational/customer_impacting/security/maintenance/commander/comms_lead/scribe/responder` (`setup.ts:48-65`); `source_event_ref` partial-unique exists (`entities.ts:41`); `sla_targets` JSONB exists (`entities.ts:695`); `escalate/preview` endpoint exists; policy targets enum is `['user','team','role']` (`validators.ts:62`); ImpactPanel uses a raw `Input` for `targetId` (v2 claim); sweep worker exists (`workers/escalation-sweep.ts`, schedule registered in `setup.ts`); `defaultRoleFeatures` admin `['incidents.*']` + explicit employee list (`setup.ts:224-233`); notification ids additive vs existing 4; `search.ts` indexes `title/description/number`; `AiChat` prop is `agent` (`AiChat.tsx:208`) with core-module usage precedent (customers injection widgets); `page.meta.ts` files already carry `pageTitleKey`/`pageGroupKey` (W1 item 4 is an audit, correctly scoped); i18n scripts exist (`package.json:79,81`); ai-agents.ts auto-discovery precedent: `customers/ai-agents.ts`, `catalog/ai-agents.ts`.

## AGENTS.md Compliance

| Rule | Location | Fix |
|------|----------|-----|
| DI-resolved services vs direct imports | Spec §W4 / Gate Q3 | Correction #1 — spec prescribes a DI seam that does not exist; use the documented package-import or HTTP-route mechanism |
| `makeCrudRoute` + indexer + zod + openApi (triggers CRUD) | Spec §API | Compliant as written; ensure `updated_at` in list/detail (optimistic-lock guard test will enforce) |
| Wildcard-ACL feature matching in AI/route gating | §W4 | Platform `checkAgentPolicy` already wildcard-aware; module routes must use `requireFeatures` metadata (spec says so) |
| No hardcoded user-facing strings | W1 | Spec is the fix; locale-coverage guard is a strong addition |
| DS rules (tokens, no truncating buttons, lucide, dialogs) | §UI/UX | Spec binds them explicitly — compliant |
| Events convention (`module.entity.action`) | `incidents.trigger.created/updated/deleted`, `incidents.incident.update_overdue` | Compliant |

## Risk Assessment

### High Risks
| Risk | Impact | Mitigation |
|------|--------|-----------|
| (none) | | |

### Medium Risks
| Risk | Impact | Mitigation |
|------|--------|-----------|
| Wildcard subscriber runs on every platform event | Latency/DB load on chatty events | Mirror webhooks' full early-exit list (`application.`, `query_index.`, own module) — spec only names `incidents.*`; add the internal-event skip list explicitly. TTL cache + warm-path test as specced |
| W4 mechanism rework ripples through Phase 4 steps/tests | Wasted implementation effort if started as written | Apply corrections #1/#2 to the spec first |
| Trigger cache staleness across worker processes | Disabled trigger keeps firing up to TTL | Short TTL (≤60s) + invalidate on CRUD in-process; document residual |
| Org-scope semantics of trigger matching | Events without `organizationId` never match org-scoped triggers | Pin the rule in the spec (recommend: match on tenant, then org-exact; entity has non-null org per common-columns convention) |

### Low Risks
| Risk | Impact | Mitigation |
|------|--------|-----------|
| Polish translation quality | Cosmetic | Native review in PR (specced) |
| Dashboard title approach churn | Small rework | Correction #3 decides it pre-implementation |
| JSONB→entity migration | Dev-only data | Migration specced; re-runnable |
| Cadence sweep double-fire | Duplicate notifications | Set-once/atomic guard reuse (specced); workers=1 in round-trip tests |

## Gap Analysis

### Critical Gaps (Block Implementation)
- **W4 mechanism + availability probe design** (corrections #1, #2): the spec's stated mechanism cannot be built as written.

### Important Gaps (Should Address)
- `customer_account` picker source decision (correction #8).
- `incidents.*` filtering in the trigger EventSelect (correction #9).
- Trigger-cache invalidation on CRUD + staleness bound (correction #7).
- Wildcard subscriber internal-event skip list beyond `incidents.*` (webhooks skips `application.`/`query_index.` explicitly).
- Settings validator/API cleanup when dropping `autoIncidentTriggers` (name it in Phase 3).
- Search path fix everywhere it appears (`/api/search/search`), including the similar-incidents card and tests.

### Nice-to-Have Gaps
- Note the existing `packages/search/.../frontend/utils.ts` client helper for the similar-incidents card.
- State whether `GET /api/customer_accounts/admin/users`'s missing declarative guard is acceptable for the picker (verify its in-handler auth first).
- Loading/error/empty states for the AI cards (DS section covers generically; one line suffices).

## Remediation Plan

### Before Implementation (Must Do)
1. Edit the spec: replace Gate Q3/W4 "DI-resolved runtime, `allowUnregistered`" with direct `runAiAgentObject` import (or platform run-object route) + `AiModelFactoryError('no_provider_configured')`-based availability; update Phase 4 steps/tests accordingly.
2. Edit Gate Q4/W1-3/BC table: acknowledge the existing widget-title i18n convention (DashboardScreen/WidgetVisibilityEditor); either drop the shared `titleKey` change in favor of convention keys, or keep it with justification and still cite the existing resolvers.
3. Fix factual strings: `/api/search/search`; command id `incidents.incidents.create`; `E.incidents.incident_trigger`; staff route `GET /api/staff/teams` + `staff.view`; peer picker routes/params per the table above.
4. Pin the `customer_account` picker decision and the trigger-manager `incidents.*` event filtering approach.

### During Implementation (Add to Spec)
1. Trigger-cache invalidation + TTL residual note; wildcard skip list (`application.`, `query_index.`).
2. Settings schema/UI cleanup for the dropped JSONB; org-scope matching rule for dispatch.

### Post-Implementation (Follow Up)
1. Update v1/v2 spec header/changelog (already Phase 6); run `yarn mercato auth sync-role-acls` (specced); native Polish review in PR.

## Recommendation

**READY-WITH-FIXES** — needs spec text updates first (items 1–4 above, ~an hour of editing); architecture, phasing, data model, BC posture, and test coverage are otherwise implementation-ready.
