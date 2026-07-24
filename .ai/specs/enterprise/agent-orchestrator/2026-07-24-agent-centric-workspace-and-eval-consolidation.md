# Agent-Centric Workspace & Evaluation Consolidation

> Enterprise · `agent_orchestrator` · **2026-07-24** · builds on
> [`00-IMPLEMENTED-BASELINE.md`](./00-IMPLEMENTED-BASELINE.md),
> [`2026-07-12-ux-navigation-pass.md`](./2026-07-12-ux-navigation-pass.md) and
> [`2026-07-12-ux-data-honesty-pass.md`](./2026-07-12-ux-data-honesty-pass.md).

## TLDR

The Agent Orchestrator sidebar carries **ten flat items, three of them just for evaluation**
(Eval assertions, Eval cases, Evaluations). The agent detail page is a ~782-line single scroll of
raw registry/metrics data. This spec makes **the agent the unit everything hangs off**: it deletes
the three standalone eval list screens and re-hosts their data — filtered per agent — inside a
restructured, tabbed agent workspace (**Overview / Activity / Evaluation / Configuration**), with
drawers for detail. No new persistence, no API contract changes: every eval list API already
accepts an agent-scoped filter, and every UI primitive already exists.

## Overview

Users reason about *an agent* — "is `underwriting.risk_assessment` healthy, and is it safe to ship?"
— but the current IA forces them to open three separate global lists and filter each by an agent id.
Because an "agent" is a **code-defined string id** (no `Agent` table; the id appears as `appliesTo` /
`agentDefinitionId` on every eval row — see baseline §Data model), those three lists are already just
three views of one agent's quality. Folding them onto the agent page is the schema's natural shape.

This is a **UX/IA refactor**, not a capability change. Governance/autonomy controls remain the honest
read-only placeholders established by the 2026-07-12 data-honesty pass.

## Problem Statement

1. **Menu sprawl.** Three of eleven Agents-group items exist only to manage evaluation; they compete
   with daily operator work (Caseload, Traces) for sidebar attention.
2. **Agent id as a filter, not a home.** To see an agent's assertions/cases/eval runs a user opens a
   global list and types/selects the agent id — repeated three times, with three mental models.
3. **Agent page is a data dump.** One long scroll (header, 7-cell stat grid, override banner, recent
   runs, tools, sub-agents, skills, instructions, token usage) with no task-shaped structure; eval is
   present only as a single "Eval pass %" stat and the override banner.

## Proposed Solution

### Information architecture

**Delete** the three eval *list* screens and their sidebar entries. **Keep** all `api/eval-*` routes
and the `[id]` detail routes (already nav-excluded). Re-host eval data per-agent on the agent page.

Sidebar Agents group after this change: Overview · Caseload · Processes · Traces · **Agents** ·
Playground · Agentic Tasks · Audit. (A cross-agent evaluation roll-up remains available as a facet on
Traces/Overview; it is no longer a top-level item.)

### Agent workspace — header card + four tabs

Persistent header card (avatar, label, health `StatusBadge`, the existing icon `Select`, Playground
link) sits above a `Tabs variant="underline"` control. Tabs are deep-linkable via
`?tab=<id>&section=<id>` so cross-links (e.g. "Needs attention") land on the right section.

| Tab | Purpose | Content | Data source |
|---|---|---|---|
| **Overview** | "Is it OK?" | Stat grid (existing), override-gate banner (existing), **Needs attention** list, run-volume sparkline | existing `agents/{id}` + `metrics/agents` reads; counts from eval-cases/proposals/eval-runs |
| **Activity** | "What has it done?" | Recent runs (`DataTable`) with facet filter All/Errors/Overridden → link to `/backend/traces/{id}` | `GET /runs?agentId=` (lazy on first open) |
| **Evaluation** | "Is it good & safe?" | Summary strip + `underline` sub-tabs **Assertions / Cases / Runs** + drawers | the three agent-scoped eval list APIs |
| **Configuration** | "How is it built?" | Instructions (+copy), tools/skills/sub-agents, model/loop, governance (read-only placeholder), identity/principal | existing `agents/{id}` read |

**Needs attention** is computed from real data only: count of `draft` eval cases, count of `pending`
runtime proposals, and the most recent `failed`/`advisory` eval suite run. Each row deep-links into the
relevant tab/section. If a signal has zero items it is omitted (no fake zeros — data-honesty rule).

### Evaluation tab detail

- **Assertions** — `GET /eval-assertions?appliesTo=<agentId>` plus a second call `?appliesTo=*`,
  merged and deduped client-side; wildcard rows are badged "all agents". Rendered as an `Accordion`;
  the enable `Switch` reuses the existing optimistic-lock `PUT /eval-assertions/{id}`. **Edit** and
  **+ Assertion** open the assertion drawer (the CrudForm relocated from the deleted list page).
- **Cases** — `GET /eval-cases?agentDefinitionId=<agentId>`. `DataTable` + `SegmentedControl` status
  filter (All / Draft / Approved / Archived). Row opens a case drawer (input/expected/provenance via
  `GET /eval-cases/{id}`); **Approve** / **Archive** reuse `POST /eval-cases/{id}/{approve,archive}`.
- **Runs** — `GET /eval-runs?agentDefinitionId=<agentId>`. `DataTable`, live-refreshed on the
  `agent_orchestrator.eval_suite_run.completed` app event (coalesced, as the current list does).
  **Run evaluation** opens a drawer (`POST /eval-runs`); a row opens a results drawer
  (`GET /eval-runs/{id}/case-runs`).

### Drawers

All new drawers compose the shared `Drawer` primitive (Radix — focus trap, Esc, `aria-modal` free),
matching the existing `SkillDrawer` / `AgentIoDrawer` pattern: `AssertionFormDrawer` (relocated form),
`EvalCaseDrawer`, `RunEvaluationDrawer`, `EvalResultsDrawer`. `SkillDrawer` and the read-only
`AgentConfigDrawer` are retained.

## Architecture

- **Reused primitives** (no new components): `Tabs` (`variant="underline"`), `Drawer` (+ sub-parts),
  `Accordion`, `SegmentedControl`, `DataTable`, `SectionHeader`. This agent page is the first backend
  page to adopt `Tabs variant="underline"` directly.
- **Page decomposition.** `backend/agents/[id]/page.tsx` becomes a shell that keeps the existing fetch
  (agent + windowed metrics) and hoists shared drawer state above the tabs. Tab bodies extracted to
  co-located components (`AgentHeaderCard`, `OverviewTab`, `ActivityTab`, `EvaluationTab`,
  `ConfigurationTab`) plus the four eval drawers. Activity/Evaluation fetch lazily on first open.
- **Write paths.** The icon `Select` optimistic-lock write is preserved verbatim. Every new mutating
  action (assertion toggle/edit, case approve/archive, run evaluation) goes through
  `useGuardedMutation` + `buildOptimisticLockHeader` where the entity is editable, surfacing conflicts
  via `surfaceRecordConflict(err, t)`.
- **No contract change.** Wildcard-assertion inheritance is a client-side second fetch, avoiding any
  change to `evalAssertionListQuerySchema`. `data/validators.ts` and all `api/eval-*` routes are
  untouched.

## Data Models

**Unchanged.** No entities, columns, or migrations. The relevant read-only shapes
(`AgentEvalAssertion.appliesTo`, `AgentEvalCase.agentDefinitionId`, `AgentEvalSuiteRun.agentDefinitionId`,
`AgentProposal.disposition`) are consumed exactly as the deleted list pages consumed them.

## API Contracts

**Unchanged — consumed, not modified.** Confirmed agent-scoped params already accepted:

| Endpoint | Param used | Handler |
|---|---|---|
| `GET /api/agent_orchestrator/eval-assertions` | `appliesTo` (`=<agentId>` and `=*`) | `makeCrudRoute`, `buildFilters` maps `applies_to` |
| `GET /api/agent_orchestrator/eval-cases` | `agentDefinitionId` | `makeCrudRoute`, `buildEvalCaseListFilters` |
| `GET /api/agent_orchestrator/eval-runs` | `agentDefinitionId`, `status` | hand-written GET |
| `PUT /eval-assertions/{id}`, `POST /eval-cases/{id}/{approve,archive}`, `POST /eval-runs`, `GET /eval-runs/{id}/case-runs`, `GET /eval-cases/{id}` | — | existing, reused by drawers |

ACL unchanged: the agent page already gates on `agent_orchestrator.agents.view`; eval sections
additionally check `agent_orchestrator.eval.manage` before rendering mutating controls (same feature
the deleted pages required).

## Integration Coverage

New/updated tests (self-contained per `.ai/qa/AGENTS.md` — fixtures created in setup, torn down after):

| Path | Coverage |
|---|---|
| Agent Evaluation ▸ Assertions | loads only this agent's + `*` assertions; toggle enable persists |
| Agent Evaluation ▸ Cases | loads only this agent's cases; approve a draft; archive |
| Agent Evaluation ▸ Runs | loads only this agent's runs; trigger an evaluation |
| Agent workspace | four tabs render; `?tab=` deep-link selects the tab; icon-Select lock write intact |
| `__tests__/nav-order.test.ts` | updated to the reduced Agents-group sequence |
| Deleted routes | `/backend/eval-assertions|eval-cases|eval-runs` no longer registered; `[id]` deep links still resolve |

## Risks & Impact Review

| Risk | Severity | Area | Mitigation | Residual |
|---|---|---|---|---|
| Deleted UI list routes 404 for old bookmarks | Low | backend routes | Accepted per product decision; `[id]` detail routes + all `api/*` preserved (no API/data break); `[id]` back-links repointed to the agent Evaluation tab | Old list bookmarks 404 (UI-only) |
| Wildcard `*` assertions lose their dedicated global list | Low | eval mgmt | Surfaced + editable inside every agent (badged "all agents"); "Applies to: all agents" stays selectable in the assertion drawer, so they remain creatable/manageable | No single global `*` inventory view |
| Over-fetching on a busy agent page | Low | perf | Activity/Evaluation fetch lazily on first tab open; `pageSize` ≤ 100; live-refresh coalesced | — |
| Reintroducing "fake editability" on governance | Med | data honesty | Governance/autonomy stay disabled placeholders exactly as the 2026-07-12 pass established | — |
| i18n key removal breaks `yarn i18n:check` | Low | i18n | Remove `nav.eval*` from all four locales in the same change; add new `agentDetail.*` keys to all four | — |

## Final Compliance Report

Runner: local (no Docker `app` container running).

- **Typecheck** — `tsc -p packages/enterprise --noEmit`: clean for all new/changed workspace files
  (page shell, `workspaceShared`, `workspacePrimitives`, `AgentHeaderCard`, Overview/Activity/Configuration
  tabs, `AgentConfigDrawer`, and the Evaluation domain). The only errors are pre-existing in the unrelated,
  in-progress `components/WebSearchHealthCard.tsx`.
- **Unit / guard tests** — `@open-mercato/enterprise` jest: **878 passed / 878** (116 suites). Updated three
  source-invariant guards that asserted on the old single-scroll page (behaviors preserved, not weakened):
  `nav-order` (reduced Agents group), `truth-in-ui` (autonomy control now guarded in `workspacePrimitives.tsx`,
  still disabled), `vocabulary-labels` (`subjectRefOf` probe now on `workspaceShared.ts`), `p0-honesty-safety`
  (assertion management is the reversible guarded enable/disable toggle — the destructive standalone delete
  page is gone; deleting shared `*` assertions from a per-agent page is deliberately not exposed).
- **Lint** — `yarn lint`: 0 errors (12 pre-existing warnings, none in changed files).
- **i18n** — `i18n:check-usage`: no missing keys introduced by this change (4 pre-existing repo-wide misses in
  DataTable/workflows remain). `i18n:check-sync`: en sorted; the 3 `nav.eval*` keys removed; new keys added to
  all four locales (pl in full parity; es/de get the change's keys as EN placeholders — their pre-existing
  245-key backlog is left untouched to keep the diff focused).
- **generate** — `yarn generate`: all generators completed; no committed generated file changed (route
  discovery is runtime).
- **DS** — semantic-token scan of all ten new/changed component files: no hardcoded status colors, arbitrary
  values, `dark:` overrides, or hex — first backend adopter of `Tabs variant="underline"`.
- **BACKWARD_COMPATIBILITY.md** — deleted UI list routes `/backend/eval-{assertions,cases,runs}` are a UI-route
  removal (not an API/type/event/DB contract surface); all `api/eval-*` routes and the `[id]` detail routes are
  preserved, so no frozen/stable contract surface changes. `[id]` breadcrumbs + back-links repointed to the
  agent Evaluation tab (or the Agents list when the record isn't loaded).

**Follow-up (pending):** the integration-coverage matrix above (Playwright) is specified but not yet
implemented — it needs the prepared test environment (`om-prepare-test-env` → `om-integration-tests`). Run it
as the next step to exercise the agent-scoped eval fetches, case approve/archive, assertion toggle, and
evaluation trigger end-to-end.

## Changelog

- **2026-07-24** — Spec created **and implemented**. Deleted the three standalone eval list screens
  (`backend/eval-{assertions,cases,runs}/page.*`) and their sidebar entries; restructured the agent detail page
  into a four-tab workspace (Overview / Activity / Evaluation / Configuration) with evaluation composed per
  agent via the existing agent-scoped list APIs, plus assertion/case/run/results drawers on the shared `Drawer`.
  No data-model or API-contract changes. Integration tests remain a documented follow-up.
