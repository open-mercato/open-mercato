# Agent Orchestrator — UX Consistency Pass (remediation spec 5 of 5)

> Part of the [UX remediation plan](./2026-07-12-ux-remediation-plan.md) (umbrella; Q-gate decisions locked 2026-07-12).
> Findings source: [`.ai/analysis/2026-07-12-agent-orchestrator-ux-audit.md`](../../../analysis/2026-07-12-agent-orchestrator-ux-audit.md), themes D (consistency mechanics), E (domain leakage, Q5), F (tasks safety) + the P2 grab-bag.
> Assumes specs 1–4 (P0 hotfixes, navigation, data honesty, operator throughput) land first; nothing here hard-depends on them except where noted.

## TLDR

**Key Points:**
- Makes the nine cockpit pages behave like **one product**: run-lifecycle events become `clientBroadcast` so Traces (list + a "Running" detail) and the Tasks list refresh live like Caseload/Overview/Processes already do; the Tasks list gains a last-run status column.
- Consolidates six divergent per-page date/duration formatters into shared `components/types.ts` helpers and kills hardcoded `'en-US'` locale calls (13 call sites across 5 files) — numbers and dates finally follow the user's locale via `useLocale()`.
- Fixes lying header sorts on the two server-paginated tables (Traces, Processes), translates raw enum leakage on the trace page (`pass/warn/block`, phase, tool `ok`), adds the missing `runtime.native` i18n key ×4, and executes the **Q5 neutral-vocabulary sweep** (claims → subject/reference) across 5 pages ×4 locales.
- Closes the two search gaps (run-id search on Traces; a Processes search box over the already-shipped `q` param) and the **tasks safety trio**: real cron validation + "next run at…" preview (reusing `cron-parser@5.6.1` already shipped in `@open-mercato/scheduler` — no new dependency), IANA timezone picker, per-target-type permission prefill + empty-grants warning, features-picker datalist; plus a schedule-health indicator.
- Finishes with a terse P2 grab-bag phase (plurals, aria semantics, artifact-expander collapse, audit operator-name resolution, etc.).

**Scope:** `packages/enterprise/src/modules/agent_orchestrator/` (events.ts, backend pages, `components/types.ts`, validators, i18n ×4) + one additive export from `@open-mercato/scheduler` (cron validation/next-run helper).

**Concerns:** broadcast volume of `run.completed`/`run.ingested` at high run concurrency (mitigated: subscribers use the existing `useCoalescedReload`, and the DOM bridge scopes by org); the vocabulary sweep touches 5 pages × 4 locales — regression surface is copy-only but wide.

## Overview

The audit's cross-cutting reviewer summarized the module as "one product visually, not yet behaviorally": live refresh, date formatting, sorting semantics, enum translation, and domain vocabulary each work differently depending on which page you are standing on. Every item in this spec is a convergence: pick the pattern the module already does best (coalesced SSE refresh, `components/types.ts` formatters, `t()`-mapped labels, server-side sort params) and apply it to the pages that diverge. The tasks safety items are the one exception — they harden a brand-new surface (Agentic Tasks) whose validation currently accepts nonsense (`foo bar baz qux quux` is a "valid" cron).

## Problem Statement

Verified against the working tree (2026-07-12):

| Divergence | Evidence |
|---|---|
| Live refresh: caseload/overview/processes-list/tasks-detail subscribe; **traces list, trace detail, tasks list never refresh** | `useAppEvent` present only in `backend/{caseload,overview,processes,tasks/[id]}/page.tsx`; `run.completed`/`run.ingested` lack `clientBroadcast` (`events.ts:13,18`) while `proposal.*`/`task_run.*`/`process.updated` have it |
| `guardrail.tripped` is `clientBroadcast` "so the cockpit live-updates" (`events.ts:25-26`) — **zero listeners** | grep: no `useAppEvent('agent_orchestrator.guardrail.tripped')` anywhere |
| Six local date/duration formatters + `'en-US'` hardcoded in 13 call sites | `formatWhen` (`audit/page.tsx:61-65`), `formatWait` (`overview/page.tsx:68`), `formatLatency` (`traces/page.tsx:78`), `formatSubjectValue`/`formatAge` (`processes/[id]/page.tsx:93,99`), `formatDateTime` ×2 (`tasks/[id]/page.tsx:122` (→ `backend/agentic-tasks/**` after spec 1), `traces/[id]/page.tsx:61`); `toLocaleString('en-US')` in `overview/page.tsx:262,299,385,423`, `audit/page.tsx:65,256,262,268,274`, `agents/page.tsx:182,275`, `agents/[id]/page.tsx:230`, `processes/[id]/page.tsx:96` |
| Header sort lies on server-paginated tables | `sortable` DataTable over page-local rows: `traces/page.tsx:336` (client slice), `processes/page.tsx:236` (server-paginated but header sort never sent to the API); both APIs have `sortFieldMap` (`api/runs/route.ts:65`, `api/processes/route.ts:69`) |
| Raw enum leakage on the trace page | `check.phase` chip (`traces/[id]/page.tsx:265`), `check.result` badge (`:268`), tool status `'ok'/'error'` (`:435-437`) — caseload translates the same guardrail vocabulary (`caseload.inbox.guardrailFlagged`) |
| `runtime.native` label untranslated | `agents/page.tsx:167` resolves `t('…runtime.native', RUNTIME_LABEL.native)` — the key exists for the other three runtimes, not for `native`, in any locale |
| Audit meta bypasses i18n | `backend/audit/page.meta.ts` uses `pageTitle: 'Audit'` + `breadcrumb: [{ label: 'Audit' }]`; sibling pages use `pageTitleKey` (`overview/page.meta.ts:16`) |
| Claims vocabulary on a generic platform | `overview.domain` ("Claims adjudication"), `caseload.searchPlaceholder` ("Search claims, agents…"), `caseload.col.claim`, `audit.col.claim`, `agentDetail.recent.claim`, `process.factClaimed`/`factPolicyholder`/`list.col.claim`/`list.subtitle` (`i18n/en.json:44,109,132,171,261,366-383`); `claimId/claim_id/dealId/deal_id/reference` key-sniffing in `audit/page.tsx:123`, `agents/[id]/page.tsx:165`, `caseload/page.tsx:289`, `overview/page.tsx:221` |
| PL terminology wobble | "dyspozycje" (`pl.json:114`) vs "Rozstrzygnięto" (`pl.json:406`) vs "decyzja" elsewhere; `caseload.view.inbox` = "Inbox" untranslated; `caseload.inbox.guardrailFlagged` PL value is the raw English template (`pl.json:150`) |
| Search gaps | Traces search matches `agentId/model/runtime/externalRunId` only — not `run.id` (`traces/page.tsx:82-87`); Processes has **no search box** while the API supports `q` → `subject_label $ilike` (`api/processes/route.ts:86`) |
| Tasks safety | cron validated by token-count regex only (`data/validators.ts:861-865` — `/^\S+(\s+\S+){4,5}$/`); `scheduleTimezone` free text `max(64)` (`:878`); no per-target permission prefill/warning (audit F-1); features picker is blind free text; tasks list columns are name/target/schedule/enabled only (`tasks/page.tsx:280-324` — → `backend/agentic-tasks/**` after spec 1) — no last-run health |

## Proposed Solution

### Area 1 — Live-refresh coherence

- `events.ts`: add `clientBroadcast: true` to `run.completed` and `run.ingested` (additive per `BACKWARD_COMPATIBILITY.md` — EventDefinition flags are additive-only surface).
- `backend/traces/page.tsx`: subscribe both events via `useCoalescedReload` (same 5 s leading+trailing pattern as caseload); keep the manual refresh button.
- `backend/traces/[id]/page.tsx`: subscribe the same two events filtered client-side by `runId` (payload carries the run id); a "Running" trace updates when the run completes or its trace ingests. No polling.
- `backend/tasks/page.tsx` (→ `backend/agentic-tasks/page.tsx` after spec 1): subscribe `task_run.started/completed/failed`; add a **Last run** column (status badge + relative time) — data comes from extending the tasks list route to include a `lastRun {status, finishedAt}` projection per row (one additional grouped query, no schema change).
- `guardrail.tripped`: **keep the flag, add the missing listener** — the caseload page adds it to its existing subscription set (a trip usually precedes `proposal.created` by seconds; subscribing costs one array entry and makes the flag honest). Dropping the flag would be a contract removal — rejected.
- Volume risk: broadcasts are org-scoped by the DOM Event Bridge and every subscriber coalesces; at the reference load (~20 concurrent runs) this is ≤ a few events/s per org, well inside what `proposal.*` already produces. No extra throttle layer.

### Area 2 — Shared formatters

- Extend `components/types.ts` (siblings of `formatCostMinor`, `components/types.ts:543`) with locale-aware helpers: `formatNumber(value, locale)`, `formatDateTime(iso, locale)` (absolute, date+time), `formatRelativeAge(iso, locale, t)` (for "3d 4h" style ages), `formatWaitMinutes(min, locale)`. Locale comes from the existing `useLocale()` (`packages/shared/src/lib/i18n/context.tsx:90`); helpers take it as a parameter (pure functions — no hook coupling), pages call `useLocale()` once.
- Delete the six local formatters; replace the 13 `toLocaleString('en-US')` call sites. `Intl.NumberFormat(locale)` / `Intl.DateTimeFormat(locale)` under the hood.
- Relative-vs-absolute policy (documented as a comment on the helpers): **lists show relative age** (queues are about urgency), **detail headers show absolute date+time** (forensics), tooltips carry the other form.

### Area 3 — Header-sort truth

- `backend/processes/page.tsx`: wire DataTable's sorting callback to the existing server `sortField`/`sortDir` params (the route's `sortFieldMap` at `api/processes/route.ts:69` already whitelists columns); columns without a map entry get `enableSorting: false`.
- `backend/traces/page.tsx`: header sort is disabled (`sortable` removed) **in this spec** — wiring header sort to a client-side 100-row slice would still lie. The honest fix now exists as a commissioned step: **the data-honesty spec §3.3(a) / Phase 3 step 3a ships traces-list server-side row pagination**; once that lands (spec 3 precedes this one in the umbrella order), header sort binds to `api/runs/route.ts:65`'s `sortFieldMap` exactly like Processes below (coordinated step, see Implementation Plan).

### Area 4 — Enum label maps

- Trace page: translate guardrail `result` (`traces.detail.guardrailResult.{pass,warn,block}`), `phase` (`…guardrailPhase.{input,output}`), and tool status (`…toolStatus.{ok,error}`) — reusing the caseload's existing PL/DE/ES vocabulary for guardrails.
- Add `agent_orchestrator.agents.list.runtime.native` to all four locales (en "Native", pl "Natywny", de "Nativ", es "Nativo"); the code path (`agents/page.tsx:167`) already resolves the key — fallback map stays as fallback.
- `titleCase` fallbacks (`agents/page.tsx:334`, `agents/[id]/page.tsx:388`) stay, but verify the `autonomy.*`/`status.*`/`outcome.*` key families are complete ×4 (add any missing).
- `backend/audit/page.meta.ts` i18n keys: **owned by the navigation spec §6** (it un-hides and labels the audit page in the same edit) — no work here.

### Area 5 — Neutral-vocabulary sweep (Q5)

Terminology table (en; pl/de/es translated in the same change — this spec **owns** the sweep so specs 1–4 don't half-migrate):

| Key | Old | New |
|---|---|---|
| `overview.domain` | "Claims adjudication" | **already removed by spec 1** (chip + key ×4) — this spec **verifies only** (grep for residual references) |
| `caseload.searchPlaceholder` | "Search claims, agents…" | "Search subjects, agents…" |
| `caseload.col.claim`, `audit.col.claim`, `agentDetail.recent.claim`, `process.list.col.claim` | "Claim" | "Subject" |
| `process.factPolicyholder` | "Policyholder" | "Owner" |
| `process.factClaimed` | "Claimed" | "Value" |
| `process.list.subtitle` | "Claims worked jointly…" | "Cases worked jointly by agents and Open Mercato." |

- Key **renames are avoided** (values change, ids stay) so no code churn; the one deletion (`overview.domain`) is owned by spec 1 (chip + key together) — this sweep only verifies it left no orphans.
- Key-sniffing: extract the shared `fieldOf(input, 'claimId', 'claim_id', 'dealId', 'deal_id', 'reference')` heuristic (4 call sites) into one `components/` helper `subjectRefOf(input)` with the same probe list **plus** `subjectId/subject_id/ref`; where a `subjectType`-bearing row is available (processes) the noun renders from `subjectType`. Full replacement of the heuristic by declared agent facts is out of scope (tracked as follow-up).
- PL unification: "disposition" → **„decyzja"** everywhere (`audit.emptyDescription` "dyspozycje" → „decyzje agentów", `process.stepDisposed` „Rozstrzygnięto" → „Zdecydowano — {disposition}"); `caseload.view.inbox` → „Skrzynka"; `caseload.inbox.guardrailFlagged` PL gets a real translation („Zabezpieczenie {kind}: {result}").

### Area 6 — Search gaps

- `traces/page.tsx` `matchesSearch` (`:82-87`): add `run.id` (case-insensitive **prefix** match, since users paste id prefixes from logs); placeholder becomes "Search by run id, agent, model…".
- `processes/page.tsx`: search input debounced 300 ms → list reload with `q`; helper text notes it matches the subject reference/label (the encrypted title is not searchable — `api/processes/route.ts:86` filters `subject_label` only).

### Area 7 — Tasks safety trio (+ schedule health)

- **Cron**: `@open-mercato/scheduler` gains an additive export `validateCronExpression(expr): { ok: boolean; nextRuns?: Date[]; error?: string }` wrapping its existing `cron-parser@^5.6.1` dependency (`packages/scheduler/package.json:64`) — **no new production dependency**; `packages/enterprise` calls it from the tasks CRUD validators (server-side, replacing the token-count regex's semantic gap — the shape regex stays as a cheap first gate) and from the create/edit form for a live "Next runs: …" preview (3 upcoming occurrences, rendered in the schedule section). Adding the scheduler workspace dep to `packages/enterprise` is additive; flagged for maintainer visibility (Ask First — new cross-package edge), with the fallback of duplicating a minimal parse in enterprise if declined.
- **Timezone**: replace the free-text field with a combobox over `Intl.supportedValuesOf('timeZone')` (no dependency, supported in the repo's Node/browser baseline); server-side, validators reject values not IANA-resolvable via `Intl.DateTimeFormat('en', { timeZone })` in a try/catch.
- **Permissions**: per-target-type prefill of `grantedFeatures` in the create form (workflow target → `workflows.instances.create` + `workflows.instances.view`; agent target → empty is legitimate) and a non-blocking create-time warning banner when a workflow-target task has empty grants (the audit's F-1 / original spec §369 pre-check). Server-side stays permissive (propose-only philosophy) — UI-level guidance only.
- **Features datalist**: the create/edit form's features picker becomes a text input + `<datalist>`. The platform's existing feature listing is `GET /api/auth/features` (`packages/core/src/modules/auth/api/features.ts` — flattens `getModules()` feature declarations to `{items: [{id, title, module, dependsOn}]}`), but it is gated `auth.acl.manage`, which task admins (`tasks.manage`) generally do not hold — so the picker cannot consume it directly. Add a thin module-local `GET /api/agent_orchestrator/features` gated `tasks.manage`, reading the **same source** (`getModules()` feature flatten, mirroring the auth route's ~40-line implementation) and returning ids+titles only; read-only, openApi-documented. Unknown ids at save render a warning chip (not an error — custom-module features may not be listed).
- **Schedule health**: task detail shows registration state ("Scheduled — next run {t}" via `validateCronExpression`, or "Schedule inactive — registration failed, re-save to retry") derived from re-computing next-run client-side; a persisted health flag is out of scope (scheduler is best-effort by design).

### Area 8 — P2 grab-bag (terse, low-risk)

1. Plurals: "1 steps" (`traces/[id]/page.tsx` reasoning hint) and the reject-dialog "(s)" → proper `{count}`-interpolated keys ×4.
2. `ArtifactExpander`: label includes payload size (`payloadBytes` is on the row) and the loaded JSON gets a collapse toggle.
3. Tool request/response summaries render via `JsonDisplay` (copy affordance) instead of raw `<pre>` when the summary is an object.
4. Timeline span-kind legend (violet=llm, indigo=tool) as a caption row; keep bar rendering unchanged.
5. Processes: facet-specific empty copy ("No processes match this filter" when a facet is active); detail auto-selects the **last** step (or first pending) instead of the oldest; completed processes render the stepper in a terminal all-done state.
6. Playground: switching agents clears the input and re-offers that agent's sample.
7. A11y: clickable `<tr>`s on Overview (stuck/trust tables) get link semantics (`tabIndex` + Enter/Space or a real link in the primary cell) — Agents-detail recent runs are owned by the navigation spec §7; facet tabs get `role="tab"`/`aria-selected`; tool-call and guardrail accordions get `aria-expanded`.
8. Audit page: resolve the Operator column's `disposition_by` UUID to a display name via the same directory enrichment the caseload uses. (Dead Filters/Export removal is owned by the data-honesty spec §3.3(c), which rebuilds that page.)

## Implementation Plan

> Each step leaves the app working; steps within a phase are sequential, phases 2–5 are independent of each other except 3↔spec-3 coordination.

**Phase 1 — Events & live refresh (S)**
1. `events.ts` broadcast flags + unit test asserting the flag set; `yarn generate`.
2. Traces list + detail subscriptions (coalesced); tasks list subscription + Last-run column (route projection + UI); caseload adds `guardrail.tripped` to its subscription array. Unit tests for the tasks-route lastRun projection.

**Phase 2 — Formatters (S)**
3. Add the four shared helpers + unit tests (locale matrix en/pl/de); migrate all 13 `'en-US'` call sites and delete the six local formatters; visual spot-check per page.

**Phase 3 — Sort + search (S)**
4. Processes header-sort binding + Processes search box (`q`); Traces header-sort removal (leave a code comment pointing at spec 3's server-pagination step for re-enable); Traces run-id search + placeholder.

**Phase 4 — Labels & vocabulary (M)**
5. Trace-page enum label maps; `runtime.native` + autonomy/status/outcome key-family completeness ×4.
6. Vocabulary sweep per the Area-5 table ×4 locales + `subjectRefOf` helper extraction (4 call sites); PL unification trio; `yarn i18n:check-sync`.

**Phase 5 — Tasks safety (M)**
7. Scheduler `validateCronExpression` export (+ its unit tests in `packages/scheduler`); enterprise validator wiring + form next-run preview + IANA timezone combobox + server-side tz validation.
8. Permission prefill + empty-grants warning; features datalist endpoint + picker wiring + unknown-id warning; schedule-health line on detail.

**Phase 6 — P2 grab-bag (S)**
9. Items 1–8 of Area 8, one commit each or batched by page; a11y checks via the existing integration harness where feasible.

## Integration Test Coverage

| TC | Path | Assertion |
|---|---|---|
| TC-AGENT-UXC-001 | Traces live refresh | Seed a `running` run, open its trace detail, complete the run via trace ingest API → the page updates to `completed` without manual reload (SSE) |
| TC-AGENT-UXC-002 | Tasks last-run | Run a seeded task to failure → tasks **list** shows a failed Last-run badge without reload |
| TC-AGENT-UXC-003 | Cron validation | `POST /api/agent_orchestrator/tasks` with `scheduleCron: "foo bar baz qux quux"` → 400 with the validation message; a valid 5-field expr passes and the create form shows three next-run timestamps |
| TC-AGENT-UXC-004 | Run-id search | Seed a run, paste its id prefix into the Traces search → the row is found; an unrelated prefix yields the empty state |
| TC-AGENT-UXC-005 | Processes search | `q` typed in the new box narrows the server-paginated list (seeded distinct `subject_label`s); total reflects the filter |
| TC-AGENT-UXC-006 | PL locale smoke | With `pl` locale: caseload view toggle shows „Skrzynka", trace guardrail badge shows the translated result, no raw `{kind}` template leaks |
| TC-AGENT-UXC-007 | Timezone validation | Task create with `scheduleTimezone: "Warsaw"` → 400; `"Europe/Warsaw"` → 201 |

All fixtures self-contained (API/direct-DB seed per `agentPerfFixtures.ts` precedent), cleaned up in teardown.

## Risks & Impact Review

| Risk | Severity | Mitigation | Residual |
|---|---|---|---|
| `run.*` broadcast volume at high concurrency floods the SSE bridge | Medium | Org-scoped bridge + `useCoalescedReload` on every subscriber (5 s window); events are already emitted — only the browser flag is new | Low — worst case is one coalesced refetch/5 s per open page |
| Vocabulary sweep regresses copy in 4 locales × 5 pages | Medium | Values-only changes (no key renames except one deletion); `i18n:check-sync` + TC-006 PL smoke; native-speaker review requested on the PR | Low |
| Traces header-sort removal perceived as a regression | Low | Toolbar sort select remains the (truthful) sort control; re-enable step documented for spec 3 | Low |
| New scheduler export creates a cross-package edge (enterprise → scheduler) | Low | Additive export; scheduler is already wired in the module's `setup.ts`; **Ask First flagged** for the workspace-dependency addition | Low |
| `Intl.supportedValuesOf` availability | Low | Supported in the repo's Node ≥18/modern-browser baseline; fallback to a static IANA list constant if the runtime check fails | Negligible |
| Last-run projection slows the tasks list | Low | Single grouped query over `agent_task_runs` (indexed by definition), pageSize ≤ 100 | Negligible |

No schema changes. No new production dependencies. No contract-surface removals (event flags additive; i18n key ids stable except one deleted orphan).

## Final Compliance Report

| Rule | Status |
|---|---|
| Singular naming / no new entities | ✅ no schema changes |
| Cross-module isolation | ✅ only additive `@open-mercato/scheduler` export consumed via existing DI seam (Ask First flagged) |
| Tenant/org scoping | ✅ no new data paths; features endpoint scoped to caller |
| Zod validation | ✅ cron/timezone validators tightened server-side |
| Encryption | ✅ untouched; Processes search documented as label-only (title stays encrypted) |
| Canonical primitives | ✅ `useCoalescedReload`, `DataTable` sort params, `apiCall`, `t()`/locale from shared i18n |
| DS rules | ✅ copy/label changes only; no new colors; a11y additions token-free |
| i18n | ✅ every change lands ×4 locales; `i18n:check-sync` in the gate |
| Integration coverage | ✅ TC-AGENT-UXC-001…007 listed and implemented with the change |
| BC contract | ✅ additive event flags; stable i18n key ids; one orphaned key deleted with its dead UI |

## Changelog

- **2026-07-12**: Spec created from the UX audit (themes D/E/F + P2), Q5 locked to neutral vocabulary at the umbrella gate; all evidence re-verified against the working tree (corrected the audit's "8 files" `'en-US'` count to 13 call sites in 5 files; noted runtime labels already route through `t()` and only the `native` key family is missing).
- **2026-07-12**: Post-review fixes applied per fresh-context architectural review: H-2 (Traces header-sort re-enable re-anchored to the data-honesty spec's now-commissioned §3.3(a)/step 3a server pagination), M-1/M-2/M-3/M-4 (duplicated items yielded — `overview.domain` deletion to spec 1, audit page-meta labeling to spec 2, dead Filters/Export to spec 3, agents-detail run rows to spec 2), M-7 (tasks paths annotated with the post-spec-1 `backend/agentic-tasks/**` location), L-3 ("6 files" → 5), L-6 (features datalist source named: mirrors `packages/core/src/modules/auth/api/features.ts` over `getModules()`, via a module-local `tasks.manage`-gated route because the auth route requires `auth.acl.manage`).
- **2026-07-12**: **Implemented** (all six phases, one commit each on `feat/agent-orchestrator-mvp`):
  - Phase 1 `f0853a0a8` — `run.completed`/`run.ingested` `clientBroadcast` (payloads carry the run id; trace detail filters + silent-refreshes), traces list + agentic-tasks list subscriptions, Last-run column (`attachLastRunProjection`, `distinct on` grouped query), caseload `guardrail.tripped` listener. Also swept the untracked `api/tasks/` tree from spec-8's phases.
  - Phase 2 `d9cc20043` — shared locale-aware formatters in `components/types.ts` (relative-vs-absolute policy documented), 18 call sites migrated, 9 local formatters deleted, module-wide no-`'en-US'` test guard.
  - Phase 3 `d21b19695` — header sorts bound to server params on BOTH tables via shared `components/serverSort.ts` (**deviation from the spec text: Traces sort enabled rather than removed** — spec 3's server pagination landed first); run-id prefix search via an additive `idPrefix` uuid-range filter on `api/runs` (ilike on uuid errors in PG); debounced Processes `q` search with facet counts sharing the filter.
  - Phase 4 `adbd10584` — guardrail/tool enum label maps ×4, `runtime.native` key ×4, Q5 sweep (8 en swaps + de/es/pl insurance-term neutralization), `components/subjectRef.ts` (4 call sites), PL „decyzja" unification + „Skrzynka" + real `guardrailFlagged` translation.
  - Phase 5 `7e207a666` — `@open-mercato/scheduler` `validateCronExpression` export (Ask First resolved: approved in-session; enterprise workspace dep added), route-layer semantic cron validation (kept out of client-bundled `validators.ts`), next-runs preview, IANA timezone combobox + server validation, workflow-target grants prefill + empty-grants warning, `GET /features` datalist route, schedule-health line.
  - Phase 6 `b7e9e26da` — P2 grab-bag (plurals, artifact collapse — size skipped: `payloadBytes` not served by any API; `JsonDisplay` tool summaries; timeline legend; process facet-empty copy + pending-first step selection + terminal stepper; playground input reset; a11y roles on rows/tabs/accordions; **audit operator-name resolution skipped** — no user-lookup precedent exists module-wide, flagged as follow-up) + housekeeping sweep of all earlier phases' untracked leftovers. Module tree now fully committed except the web-search stream.
  - TC-AGENT-UXC-001…007 authored (env-gated). Final module suite at completion: 102 suites / 727 tests green; scheduler 333 green.
