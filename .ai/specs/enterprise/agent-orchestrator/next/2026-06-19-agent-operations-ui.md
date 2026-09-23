> 🗂️ **Status update 2026-06-24 · 🟡 PARTIALLY IMPLEMENTED (PR #3532)** on `feat/agent-orchestrator-mvp`. The operator caseload, engineer trace inspector, and admin KPI tiles shipped — but as **standalone `backend/` pages** (`overview`, `caseload`, `traces`, `agents`, `playground`), NOT as the widget-injection overlays onto `workflows` My-Tasks / `dashboards` / `perspectives` that this spec proposes. Still open: the perspective + injection approach, persisted KPI rollups (vs live client-side compute), and the disposition-card guard-results panel (F10, **blocked** on the unbuilt guardrails overlay). Code-grounded status matrix: [`IMPLEMENTATION-TRACE.md`](./IMPLEMENTATION-TRACE.md).

# Agent Operations UI (Cockpit)

> **Status:** Partially implemented (PR #3532, 2026-06-24 — built as standalone pages, not widget injection) · **Owner:** Patryk Lewczuk (Comerito) · **Created:** 2026-06-19
> **Module:** `agent_orchestrator` (core) · **subdomain:** cockpit · **Depends:** `workflows` (monitoring dashboard + My Tasks queue), `dashboards`, `perspectives`, `inbox_ops`, the trace spec (`2026-06-19-agent-trace-eval-capture.md`), the orchestration spec (`2026-06-19-agent-orchestration-step-and-proposal.md`), `@open-mercato/ui`
> **Conventions:** Governed by `2026-06-19-agent-orchestrator-conventions.md` — where an entity/layout/naming detail conflicts with this spec, that document wins.

## TLDR

The Admin / Operator / Engineer UI for the agent fleet. This spec is **UI-only and owns NO new entities** — it reads from the trace and orchestration specs and from `workflows`, and writes only through their existing APIs. Rather than building a separate cockpit app, it **extends** OM's existing workflow monitoring dashboard, "My Tasks" queue, `dashboards`, and `perspectives` through **widget injection**, adding agent-specific surfaces: the Admin fleet KPIs, the Operator four-verb caseload, the proposal disposition card with an inline agent I/O drawer, and the Engineer trace inspector + eval panel.

## Overview

Everything the cockpit needs as a substrate already exists in OM:

- `workflows` **monitoring dashboard** — running instances + drill-down → the Admin fleet view base.
- `workflows` **"My Tasks"** queue — assignment / claim / SLA → the Operator caseload base.
- `dashboards` — KPI tiles for the Admin fleet metrics.
- `perspectives` — role-scoped views that map cleanly onto the Admin / Operator / Engineer personas.
- `inbox_ops` — the operator action surface that agent tasks land in.
- The **trace spec** — read APIs for runs, spans, tool calls, output, eval assertions, and per-agent metrics.
- The **orchestration spec** — the proposal disposition write API.

The cockpit is therefore a set of widget-injected overlays + perspective definitions, not a new product surface.

## Problem Statement

The agent-specific operator and engineer surfaces (caseload grouped by verb, proposal disposition with agent I/O, trace inspector, eval panel) do not exist. But the queue, monitoring, dashboards, and perspective substrate does. Building a fresh cockpit app would duplicate queue/state/claim/SLA logic that `workflows` already owns and would fragment the operator experience across two surfaces. We need agent overlays on the existing surfaces, not a parallel app.

## Proposed Solution

Extend the four existing surfaces via widget injection and `perspectives`, sourcing all reads/writes from the sibling specs:

1. Define **three perspectives** — Admin, Operator, Engineer — that scope the existing workflow monitor / My Tasks / dashboards to the relevant agent slice.
2. Inject **agent KPI tiles** into the Admin dashboard / workflow monitor via `admin.page` injection and `dashboards` tiles.
3. Overlay the **four-verb caseload** (Decide / Answer / Do / Know) onto "My Tasks", with a summary strip and segments (Needs you / Waiting / Running).
4. Add the **proposal disposition card** (proposal + confidence + guard results + inline I/O drawer) as a row-action / detail overlay on the workflow tasks table, writing dispositions through the orchestration spec's dispose API via `useGuardedMutation`.
5. Add the **Engineer trace inspector + eval panel** as injected detail surfaces reading the trace spec APIs, reachable as a handoff from any process step or proposal card.

No new entities, tables, migrations, or SSE channels are introduced. Live updates ride the events the trace and orchestration specs already declare (`clientBroadcast` where appropriate).

## Architecture (extend, don't rebuild)

- **No new pages where injection suffices.** Prefer widget injection into `workflows` monitor + My Tasks over net-new `backend/` pages. New `backend/` pages are added only for the standalone Engineer trace inspector if a route-level surface is genuinely required; everything else is an overlay.
- **Personas via `perspectives`.** Admin/Operator/Engineer scoping is declarative perspective config, not bespoke routing or role-name checks (use feature-based gating, never role names).
- **All reads/writes proxy the sibling specs.** The cockpit holds no business logic and no persistence; it composes the trace, orchestration, and workflows APIs.
- **Live updates** subscribe to the broadcast events the other specs declare (e.g. proposal-ready / guardrail-tripped / task-status-changed), surfaced client-side rather than via a new event channel.

## Surfaces

### Admin (fleet)

Extend the workflow monitor + `dashboards` with agent KPI tiles: auto-completion %, operator-to-process ratio, exception rate, queue depth, cost, per-agent override rate. Tiles read the trace spec's `/agents/:id/metrics` and aggregate run data. Drill-down from a tile lands in the standard workflow instance drill-down, augmented with agent attribution. Anti-rubber-stamp signals (approve-unchanged rate, sampled re-review) are surfaced here, sourced from the trace spec.

### Operator (four-verb caseload)

Overlay "My Tasks" with the four-verb grouping — **Decide / Answer / Do / Know** — scoped to the operator's assigned processes. A summary strip plus segments (Needs you / Waiting / Running) sits above the existing queue. Each `USER_TASK` keeps its full case context; the overlay adds verb classification and the disposition entry point. Claim/assignment/SLA remain owned by `workflows`.

### Proposal disposition card + I/O drawer

For agent-produced `USER_TASK`s, the card shows the orchestration spec's `AgentProposal` (capability + payload), its `confidence`, and `guardResults` (from the guardrails surface). An inline **I/O drawer** pulls the run's input / output / tool calls from the trace spec. Actions: **Approve / Edit / Reject**, routed to the orchestration spec's `POST /api/agent_orchestrator/proposals/:id/dispose` via `useGuardedMutation(...).runMutation(...)`. Edit and Reject write an `AgentCorrection` (owned by the orchestration/trace spec — not by this UI). Proposal and guardrail states render with DS status tokens (`text-status-*` / `bg-status-*`), never raw Tailwind status colors. All strings via `i18n/<locale>.json`.

### Engineer (trace inspector + eval panel)

Reads the trace spec APIs only — no `telemetry`/`otel` or `eval-runner` dependency (neither exists; engineer metrics and eval results read the trace spec's own tables/APIs). The inspector renders: span waterfall, context-routing panel, tool calls, output, eval assertions, and model comparison. "Open full trace" is a handoff link from any process step or proposal card.

### Cross-persona handoff

A supervisor reviewing a questionable proposal opens its I/O drawer, escalates to the full trace inspector, and hands the run to engineering — all via deep links across the same surfaces, no data copy.

## Widget Injection Plan (concrete spot ids)

Placement uses `InjectionPosition`. Spot ids below are the real OM spots; `<...>` are the concrete table/entity/path ids resolved against the workflows + orchestration specs.

| Surface | Spot id | Purpose |
|---|---|---|
| Admin fleet KPIs | `admin.page:<workflows-monitor-path>:before` | Agent KPI tile strip above the monitor |
| Admin fleet KPIs | `dashboards` tile widget | Per-agent metric tiles (auto-completion %, override rate, cost) |
| Operator caseload | `data-table:<workflow-tasks-table>:header` | Four-verb summary strip + segment filters |
| Operator caseload | `data-table:<workflow-tasks-table>:columns` | Verb / agent-attribution column |
| Operator caseload | `data-table:<workflow-tasks-table>:filters` | Verb (Decide/Answer/Do/Know) + segment filters |
| Proposal disposition | `data-table:<workflow-tasks-table>:row-actions` | Open disposition card for an agent task |
| Proposal disposition | `crud-form:<workflow-task-entityId>:fields` | Inline disposition card + I/O drawer in the task detail |
| Engineer handoff | `data-table:<agent-runs-table>:row-actions` | "Open full trace" → trace inspector |
| Persona nav | `menu:sidebar:main` / `menu:sidebar:settings` | Entry points scoped per perspective |

Perspective definitions (Admin / Operator / Engineer) drive which injected surfaces and scopes each persona sees.

## API Contracts (reads/writes from sibling specs — no new entities)

This spec defines **no** new entities and **no** new API routes. It consumes:

**Reads**
- Trace spec: `GET /api/agent_orchestrator/runs`, `GET /api/agent_orchestrator/runs/:id` (spans, tool calls, output, eval assertions), `GET /api/agent_orchestrator/agents/:id/metrics`.
- Workflows: instance + task list/detail APIs (monitoring + My Tasks).

**Writes**
- Orchestration spec: `POST /api/agent_orchestrator/proposals/:id/dispose` (Approve / Edit / Reject; Edit & Reject persist an `AgentCorrection`). The proposal carries `updatedAt`, so the disposition write enforces optimistic locking at the command layer (handled by the orchestration spec) and surfaces 409s via `surfaceRecordConflict(err, t)`.
- Workflows: task completion APIs (the dispose call advances the underlying workflow step).

All client calls use `apiCall*` from `@open-mercato/ui/backend/utils/apiCall`; non-`CrudForm` writes go through `useGuardedMutation(...).runMutation(...)` and include `retryLastMutation` in the injection context.

## Phases

1. **Perspectives + Admin fleet.** Define Admin/Operator/Engineer perspectives; inject agent KPI tiles into the workflow monitor + dashboards (Admin).
2. **Operator caseload + disposition.** Four-verb overlay on My Tasks; proposal disposition card + inline I/O drawer; wire dispose via `useGuardedMutation`.
3. **Engineer trace inspector + eval panel.** Trace list + inspector (span waterfall, context-routing, tool calls, output, eval assertions, model comparison) reading the trace spec.
4. **Cross-persona handoff + anti-rubber-stamp signals.** Deep links across surfaces; approve-unchanged rate + sampled re-review tiles (from the trace spec).

## Acceptance

- An operator sees only assigned processes, grouped by the four verbs, and can dispose a proposal (Approve / Edit / Reject) which advances the underlying workflow.
- The disposition card shows proposal + confidence + guard results and an inline I/O drawer (input/output/tools) from the trace spec; Edit/Reject persists an `AgentCorrection`.
- An engineer can open any agent run's full trace with span waterfall, eval results, and model comparison — no telemetry/eval-runner service involved.
- Admin KPI tiles render auto-completion %, override rate, cost, queue depth, and anti-rubber-stamp signals from the trace spec.
- The UI reuses workflow My Tasks / monitoring / dashboards / perspectives as its base rather than duplicating queue, claim, SLA, or state logic; it adds no entities or migrations.

## Risks & Impact Review

| Risk | Severity | Affected area | Mitigation | Residual |
|---|---|---|---|---|
| Workflow table/spot ids differ from assumptions | Medium | Widget injection | Resolve concrete ids against the live workflows module before Phase 2; specs reference them by role not literal id | Low |
| Sibling API shapes drift (trace/orchestration) | Medium | Reads/writes | Cockpit only composes sibling APIs; pin to their contracts and fail closed on missing fields | Low |
| Rubber-stamping (operators approve without reading) | Medium | Operator/governance | Surface approve-unchanged rate + sampled re-review from the trace spec in Admin tiles | Medium |
| Perspective scoping leaks cross-tenant/cross-operator tasks | High | RBAC/tenancy | Feature-gated perspectives (never role names); all reads filter by `organization_id` upstream | Low |
| Disposition 409 conflicts confuse operators | Low | Disposition card | `useGuardedMutation` + `surfaceRecordConflict(err, t)`; optimistic lock owned by orchestration spec | Low |
| Live-update event ids not yet declared by siblings | Low | Real-time updates | Subscribe to the broadcast events the trace/orchestration specs declare; degrade to poll if absent | Low |

## Integration Coverage

> Per repo rule, this feature ships executable Playwright integration tests with the change. As a UI-only spec, coverage centers on the **key cockpit E2E flows** plus the sibling-owned APIs each flow calls; the API contract tests themselves live with their owning specs (orchestration `dispose`, trace reads), and this spec asserts the UI exercises them end-to-end.
> Location: `packages/enterprise/src/modules/agent_orchestrator/__integration__/TC-AGENT-COCKPIT-<NNN>.spec.ts` (cockpit UI flows test against the injected `workflows` / My-Tasks / dashboards / perspectives surfaces).
> Helpers: `@open-mercato/core/helpers/integration/{auth,api,authFixtures,generalFixtures}` (+ this module's `__integration__/helpers/agentFixtures.ts` for proposal / run / task fixtures). All fixtures created in setup (prefer API), cleaned in `finally`/teardown. No seeded/demo data; deterministic across retries; rely on global config (`timeout 10s`, `expect.timeout 10s`, `retries 1`).

| API path / UI flow | Method | Must-have tests |
|--------------------|--------|-----------------|
| Operator four-verb caseload (My Tasks overlay) | UI | Operator sees **only assigned** processes, grouped by the four verbs (Decide / Answer / Do / Know); a verb with no assigned tasks renders empty; tasks assigned to another operator are not visible |
| Proposal disposition card | UI | Card renders proposal capability + payload, `confidence`, and `guardResults`; the inline I/O drawer opens and shows the run's input / output / tool calls from the trace spec; DS status tokens (`text-status-*` / `bg-status-*`) — no raw Tailwind status colors |
| Dispose proposal → advance workflow | UI → `POST /api/agent_orchestrator/proposals/:id/dispose` | **Approve** advances the underlying workflow step (task leaves the caseload / status changes); **Edit** and **Reject** also advance and each writes an `AgentCorrection` (asserted via the trace spec); the headline operator E2E |
| Disposition write — guarded mutation | UI → `dispose` | Write routes through `useGuardedMutation(...).runMutation(...)`; a stale `updatedAt` returns **409** surfaced via the unified conflict bar (`surfaceRecordConflict`), and `retryLastMutation` re-issues with the fresh version |
| Engineer trace inspector | UI → `GET /api/agent_orchestrator/runs/:id` | "Open full trace" renders span waterfall, context-routing panel, tool calls, output, eval assertions, and model comparison from the trace spec; `LoadingMessage` / `ErrorMessage` boundaries covered |
| Cross-persona handoff | UI | Supervisor opens a proposal's I/O drawer → escalates to the full trace inspector → hands the run to engineering via deep link, with no data copy and the same record in scope across surfaces |
| Admin fleet KPIs | UI → `GET /api/agent_orchestrator/agents/:id/metrics` | KPI tiles (auto-completion %, override rate, cost, queue depth) plus anti-rubber-stamp signals (approve-unchanged rate) render from the trace spec |
| RBAC / perspective scoping | UI | Feature-gated Admin / Operator / Engineer perspectives scope correctly: a user **without** `agent_orchestrator.proposal.dispose` cannot see or dispose a proposal; a user without `agent_orchestrator.trace.view` cannot open the trace inspector; perspectives never expose another persona's surfaces |
| Tenant isolation (Critical) | UI | An operator/engineer in org B never sees org A's caseload tasks, proposals, runs, or KPI rows — explicit cross-tenant denial across caseload, disposition card, and trace inspector |
| DS-token / i18n compliance | UI | Proposal / guardrail / task states use DS status tokens only; all user-facing strings resolve from `i18n/<locale>.json` (no hard-coded strings) |

**Tenant-isolation harness (mandatory):** create two orgs/tenants (`createUserFixture` per org), seed an agent proposal + run + assigned task in org A, then assert org B's token sees an empty caseload and gets 404/403 (never the row) when attempting to open the disposition card, dispose, or open the trace for org A's records. Cleanup both orgs in teardown.

**Sibling-owned API tests:** the contract-level `dispose` (happy / RBAC / tenant-isolation / 409 / `AgentCorrection`) and trace read (`runs/:id`, `agents/:id/metrics`) tests are owned by the orchestration and trace specs respectively; this spec's E2E flows depend on and exercise them rather than re-implementing them.

## Migration & Backward Compatibility

Mostly **N/A** — this spec adds no entities, tables, migrations, or API routes. The only additive contract change is the new ACL features (`agent_orchestrator.trace.view`, `agent_orchestrator.proposal.dispose`, persona-scoping features) declared in `acl.ts` + `setup.ts` `defaultRoleFeatures` and synced with `yarn mercato auth sync-role-acls`. Adding ACL features is additive per `BACKWARD_COMPATIBILITY.md`. Widget injections are purely additive overlays on existing surfaces and can be disabled per perspective without affecting the host modules.

## Final Compliance Report

- **Widget injection over new pages:** Yes — overlays via documented spot ids; new `backend/` page only for the standalone trace inspector if a route surface is required.
- **i18n:** All user-facing strings in `i18n/<locale>.json` via `useT()` / `resolveTranslations()`; no hard-coded strings.
- **Design system:** Proposal/guardrail/task states use DS status tokens (`text-status-*` / `bg-status-*`); no raw Tailwind status colors, no arbitrary values, no `dark:` overrides on status tokens.
- **HTTP:** `apiCall*` from `@open-mercato/ui/backend/utils/apiCall` only — never raw `fetch`.
- **Mutations:** Disposition + task-completion writes go through `useGuardedMutation(...).runMutation(...)` with `retryLastMutation`; 409s via `surfaceRecordConflict`.
- **Loading/error:** `LoadingMessage` / `ErrorMessage` from `@open-mercato/ui/backend/detail`.
- **Dialogs:** I/O drawer + disposition card support `Cmd/Ctrl+Enter` submit and `Escape` cancel.
- **List sizing:** `pageSize` ≤ 100.
- **RBAC:** Feature-gated perspectives + ACL features; never role names; tenant-scoped reads upstream.
- **Entities/contracts:** None added — UI-only.

## Changelog

- **2026-06-20:** Added the `## Integration Coverage` section per GAP-17, enumerating the key cockpit Playwright E2E flows (four-verb caseload showing only assigned processes; Approve/Edit/Reject disposition that advances the workflow and writes an `AgentCorrection`; disposition card confidence + guardResults + I/O drawer trace data; engineer full-trace inspector; cross-persona handoff; Admin KPI tiles) and the sibling-owned APIs they call, plus mandatory RBAC/perspective scoping, tenant-isolation denial, `useGuardedMutation` optimistic-lock 409 handling, and DS-token/i18n checks; anchored fixtures/cleanup/placement to the `.ai/qa` harness with `TC-AGENT-COCKPIT-<NNN>` naming.
- **2026-06-19:** Rewrite of `SPEC-COCKPIT-01`. Aligned to real OM conventions and the verified 2026-06-19 architecture: confirmed UI-only (no new entities), reframed as widget-injection overlays on the real `workflows` monitor + My Tasks + `dashboards` + `perspectives` rather than a separate cockpit app, listed concrete spot ids, namespaced ACL features under `agent_orchestrator.*`, pointed reads/writes at the trace + orchestration sibling specs, dropped the non-existent telemetry/eval-runner dependencies, and demoted the `om-agent-cockpit-v3.html` prototype to an optional design reference (it may not exist in the repo).
