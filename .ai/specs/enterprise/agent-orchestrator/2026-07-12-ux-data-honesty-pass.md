# Agent Orchestrator — UX Remediation Spec 3: Data-Honesty Pass

> Part of the [UX remediation plan](./2026-07-12-ux-remediation-plan.md) (spec 3 of 5). Findings source:
> [`.ai/analysis/2026-07-12-agent-orchestrator-ux-audit.md`](../../../analysis/2026-07-12-agent-orchestrator-ux-audit.md), theme A.
> Locked gate decisions: **Q7 — straight to server-side aggregates** (no interim caveats-only tier); **Q8 — minimal per-model pricing config** + confidence stamping.

## TLDR

**Key Points:**
- Makes every number and timestamp the cockpit shows *true*: a forensic `completed_at` on runs (Flag currently rewrites the displayed "Finished" time), confidence + cost stamped on native runs (both render `—` today), and windowed server-side aggregates replacing three silent 100-row client samples (Traces KPIs, Agents health, Audit page).
- Wires UI to backends that already exist (Agents eval-pass/cost cells vs the live `agents/:id/metrics` endpoint; the Overview window picker vs the supported `window` param) and kills their stale "Needs backend" chips.
- Distinguishes policy from failure (guardrail-blocked runs get their own error contract, not "invalid output") and forbidden from empty (per-panel 403/error states on Overview).

**Scope:** `agent_orchestrator` only — one additive column + backfill, one additive command-input extension, one new batch metrics endpoint, additive rollup-blob keys, UI wiring across overview/traces/agents/playground/processes pages, i18n ×4.

**Concerns:** windowed p95 has no rollup today — live fallback on large tenants must stay bounded (indexed, capped); pricing defaults go stale as providers reprice (mitigated: env override + visible "estimated" labeling).

## Overview

The audit's theme A found the cockpit mixes three truth grades — real, labeled-placeholder, and silently wrong — on surfaces whose entire job is to build trust in agent behavior. This spec is the "honesty pass": no new product features, only making displayed facts either correct or explicitly labeled. Target audiences: operators (caseload/overview), engineers (traces/agents/playground), admins/auditors (overview/audit).

> **Market Reference**: Langfuse (OSS LLM-observability leader). Adopted: model-pricing as a code-shipped default table with operator overrides, cost computed at ingestion time and stored on the trace (not recomputed at read); windowed aggregates precomputed with live fallback. Rejected: Langfuse's fully dynamic price-table UI — over-scoped for Q8's "minimal" decision; we ship code defaults + env override and defer a CRUD surface.

## Problem Statement

1. **"Finished" is `updatedAt`** (`backend/traces/[id]/page.tsx:804`) and `runs.toggleFlag` bumps it (`commands/runActions.ts:42`) — flagging yesterday's failing run moves its visible finish time to now (live-confirmed: 03:47 → 06:48).
2. **Native runs render "Confidence —" and "Cost —"**: `runs.complete` accepts only `{runId, status, output, resultKind}` (`lib/runtime/persistence.ts:137-151`), so the proposal's confidence (available at `nativeAgentRunner.ts:425`) never reaches the run row; `cost_minor` is computed nowhere in the codebase (tokens are stamped async by trace capture, cost never).
3. **Silent 100-row samples labeled as aggregates**: Traces list computes window KPIs (p95, error rate, pass rate) client-side over one `pageSize=100` page (`backend/traces/page.tsx:131,151-186`); Agents list derives per-agent runs/override/health from the last 100 *global* events (`backend/agents/page.tsx:87-90`); the Audit page joins `proposals?pageSize=100` + `runs?pageSize=100` client-side and titles the result "Agent decisions logged" (`backend/audit/page.tsx:107-108,257`).
4. **UI lags its own backend**: Agents eval-pass/cost cells and KPI cards show "Needs backend" (`backend/agents/page.tsx:187,209,277-292`; `[id]/page.tsx:232,238`) while `GET /agents/:id/metrics` serves exactly those numbers (rollup-preferred); Overview's window button flashes "Needs backend" while the API supports `window=24h|7d|30d` (`api/metrics/overview/route.ts:25,78`).
5. **Failure states lie politely**: Overview's `fetchList` swallows every error into `{items: []}` (`backend/overview/page.tsx:76-81`) — a 403 renders "No agents yet", a transient failure renders "Nothing stuck right now" (false all-clear); "Data refreshed just now" is a static string (`:269`); windowed and current-state tiles share one "last 7 days" chip (`api/metrics/overview/route.ts:107-125`).
6. **Policy blocks masquerade as model bugs**: the run route maps `AgentOutputInvalidError` before (and without ever importing) its subclass `AgentGuardrailBlockedError` (`api/agents/[id]/run/route.ts:92-94`; `lib/runtime/errors.ts:47`), discarding `kind`/`phase`.
7. **Live-looking mocks**: the agents-detail autonomy segmented control mutates state, is reflected in the header stat, and persists nothing (`backend/agents/[id]/page.tsx:519,89,245-247`); playground "Tools used" lists *declared* tools with fallback "No tools were used" regardless of execution (`backend/playground/page.tsx:228-249`); process-list mappers coerce unknown cost to `0`/`''` and unknown `openedAt` to epoch (age "20000d") (`components/processTypes.ts:588-592`).

## Proposed Solution

### 3.1 Forensic completion timestamp (`completed_at`)

Add an additive nullable `completed_at` (timestamptz) column to `agent_runs`, stamped by the `runs.complete` and `runs.fail` command handlers at execution time. Rationale for a column over derivation (per the directive's decision point): `latencyMs` measures the model loop, not wall-clock end; spans are written asynchronously and may be absent (`OM_AGENT_TRACE_CAPTURE=off`); `updatedAt` is mutable by design. A stamped fact is the only value that survives later writes.

- **Migration**: `alter table "agent_runs" add column if not exists "completed_at" timestamptz null;` + backfill `update "agent_runs" set "completed_at" = "updated_at" where "status" in ('ok','error') and "completed_at" is null;` (best available approximation for historical rows — imprecise only for runs already flagged, an acceptable one-time skew, noted in the migration comment). Snapshot updated per module convention.
- **Render**: trace inspector "Finished" cell reads `completedAt ?? null`; renders `—` when null (running/legacy-unbackfilled), never `updatedAt`. `components/types.ts` `RunView` gains `completedAt`.
- **Trace ingestion**: `ingestTrace` may also set `completed_at` from the envelope's run end time when the column is null (OpenCode path), never overwriting a non-null value.
- **Guard**: unit test — toggleFlag twice, assert `completed_at` unchanged; the existing flag test file (`__tests__/run-flag-rerun.test.ts`) gains the assertion.

### 3.2 Confidence + cost stamping on native runs (Q8)

- **Command contract (additive)**: `runs.complete` input gains optional `confidence?: number | null`, `inputTokens?: number | null`, `outputTokens?: number | null`, `costMinor?: number | null`, `currency?: string | null`. Absent fields leave columns untouched (existing callers byte-for-byte unaffected). `runs.fail` gains the same token/cost fields (failed runs still consumed tokens).
- **Native runner**: `nativeAgentRunner.ts` already holds `result.proposal.confidence` and usage totals — pass them through `completeRun`/`failRun`. Informative runs (no proposal) leave confidence null, rendered `—` (honest: they have no confidence semantics).
- **Pricing config (minimal, per Q8)**: new `lib/runtime/modelPricing.ts` exporting `resolveModelPrice(model: string): { inputPer1M: number; outputPer1M: number; currency: string } | null`:
  - Code-shipped default table for the models the module actually routes to (kept next to the model-factory presets; documented as *estimates*).
  - Env override `OM_AGENT_MODEL_PRICING` — JSON `{ "<model>": { "inputPer1M": n, "outputPer1M": n } }`, merged over defaults; `OM_AGENT_COST_CURRENCY` (default `USD`).
  - Unknown model → `null` → `cost_minor` stays null → UI renders `—`. **No cross-currency conversion** — one configured currency per deployment; mixed-currency display is out of scope.
  - Rationale vs alternatives: a tenant-scoped pricing entity means a migration + CRUD + UI for a table nobody edits monthly; the `configs` module offers no typed per-module store precedent here. Env+code is the smallest honest surface; a CRUD price table is listed as future work if per-tenant billing ever needs it.
- **Cost computation**: at `completeRun`/`failRun` call sites (native) and in `ingestTrace` (OpenCode/external, when tokens arrive and `cost_minor` is null): `costMinor = round((inTok × inputPer1M + outTok × outputPer1M) / 1_000_000 × 100)`.
- **Labeling**: everywhere cost renders (trace header, agents cells, audit), the i18n label becomes "Cost (est.)" — computed from a static price table, honesty requires the qualifier.

### 3.3 Server-side aggregates (Q7)

**Rollup blob extension (no migration — `AgentMetricRollup.metrics` is jsonb)**: `metricRollupService` additionally computes `errorRate`, `p95LatencyMs`, `evalPassRate` (already present), `runsTotal` per agent-window. Older rollup rows lacking the new keys are treated as "no fresh rollup" for those metrics (live fallback), same freshness contract as `/metrics/overview`.

**(a) Traces KPI strip + list rows** — extend `GET /api/agent_orchestrator/metrics/overview` response additively with a `traces` block: `{ p95LatencyMs, errorRate, evalPassRate, source: 'rollup'|'live' }` for the requested `window`. Live fallback uses indexed, bounded queries (`agent_runs_org_status_created_idx` shipped in the perf pass): error rate = two `count()`s; p95 = `percentile_cont(0.95)` over `latency_ms` in-window (raw query via the EM, org/tenant-scoped). The traces list page drops its client-side KPI math and reads this block; its facet *counts* likewise come from two windowed counts rather than the loaded page.

**Gate mismatch handled explicitly (avoids re-creating the P0-2 pattern):** the traces page is gated `trace.view` while `/metrics/overview` is gated `proposals.view` — a `trace.view`-only user must not stare at a broken strip. The KPI strip renders an inline forbidden-note variant on 403 (same per-panel pattern as §3.5's Overview treatment; rows below remain fully functional), never fake zeros.

**Traces-list server-side row pagination (same phase):** the row list itself drops the `pageSize=100` client slice for real server paging — `api/runs/route.ts` already supports `page`/`pageSize` and a `sortFieldMap`; the page mirrors the caseload's server-paginated pattern (server `page/pageSize/sortField/sortDir`, per-page rendering, totals from the response). This removes the "newest 100" reachability ceiling outright and is the step the consistency spec's Traces header-sort re-enable binds to (coordinated there).

**(b) Agents health** — new `GET /api/agent_orchestrator/metrics/agents?window=7d&ids=a,b,c` (zod: ids ≤ 50, same window enum), gated `agents.view`. Response: `{ items: [{ agentId, runsTotal, overrideRate, evalPassRate, avgCostMinor, currency, avgLatencyMs, source }] }` — rollup rows per agent, live-fallback per agent, one round-trip for the whole registry page (kills both the global-100-row heuristic and the Overview N+1 fan-out, which repoints to this endpoint too). openApi documented.

**(c) Audit page** — replace the client join: the log becomes a **server-paginated proposals list** (`/proposals?page&pageSize&sortField=created_at&sortDir=desc` — all already supported) with per-page run enrichment via `runs?ids=` (caseload precedent); KPIs read `dispositionCounts` + `runsTotal` from `/metrics/overview` (already served) plus one new additive overview field `correctionsCount` (windowed count of `AgentCorrection`). The "last 100" ceiling, the client search over the sample, and the dead Filters/Export buttons (removed; Export returns as follow-up) all go away; search moves to the disposition filter + a page-scoped note until server `q` exists (out of scope here, noted).

### 3.4 Wire what exists

- **Agents list/detail**: eval-pass and cost cells + the two KPI cards read the new `metrics/agents` batch endpoint **exclusively** (the detail page passes a single id) — the existing `GET /agents/:id/metrics` keeps its current `trace.view` gate and consumers untouched; routing the Agents pages through the `agents.view`-gated batch endpoint keeps one consistent gate story per page (a user who can see the agents registry can see its metrics). Delete the stale "Needs backend" chips there; chips remain only on genuinely unbacked fields.
- **Overview window picker**: real `24h | 7d | 30d` select wired to the existing `window` param; copy unified to rolling-window phrasing ("Last 7 days"); selection stored in the URL query.
- **Per-tile window captions**: windowed tiles get a small "last 7 days" caption, current-state tiles get "now" (`overview.window.now`) — the header chip no longer claims to scope everything.

### 3.5 Per-panel failure states on Overview

`fetchList` returns a discriminated result `{ ok: true, items } | { ok: false, status }`. Each panel renders: 403 → panel hidden when the feature is knowably absent, else an inline "You don't have access to this data" note; non-403 error → compact `ErrorMessage` with retry; empty → existing empty states. The SLA/stuck panel **never** renders "nothing stuck" on an error. "Data refreshed just now" is replaced by a real `lastLoadedAt` relative time, updated on every successful load.

### 3.6 Guardrail-block error contract

`api/agents/[id]/run/route.ts`: check `err instanceof AgentGuardrailBlockedError` **before** `AgentOutputInvalidError`; respond `422 { error, code: 'guardrail_blocked', kind, phase, guardrailSetVersion }`. Playground renders a distinct alert — icon `ShieldAlert`, status-error tokens, copy `playground.guardrailBlocked` ("Blocked by a {kind} guardrail during the {phase} phase") — instead of the generic invalid-output message. Applies identically to the rerun route (same handler shape). i18n ×4.

### 3.7 Truth-in-UI trio

- **Autonomy control**: `AutonomySegmented` on agents detail rendered disabled (like sibling fields) with the existing pending-copy tooltip; the header stat reverts to the declared/derived value only. (Persisting autonomy is a real feature — out of scope, cross-referenced to the deployment-gating spec.)
- **Playground tools panel**: retitled to "Declared tools" (`playground.declaredTools`) with the false "No tools were used" fallback replaced by "This agent declares no tools". Rendering **real** tool calls is specified in the navigation spec §1 ("Real Tools used" — post-run fetch of the run's trace detail, step 1.4 there); this spec only ships the retitled panel, which then serves as the navigation spec's **fallback state** (used pre-run and when the viewer lacks `trace.view`).
- **Process mappers**: `mapProcessListRow` keeps nulls (`costMinor: null`, `openedAt: null`) instead of `0`/epoch; list cells render `—` and age renders `—` when `openedAt` is null. `ProcessListRow` types loosen to nullable accordingly.

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| New `completed_at` column over deriving from `latencyMs`/spans | Derivations measure the wrong thing or may be absent; a stamped immutable fact is the only flag-proof value. Additive + backfill = zero-downtime. |
| Pricing = code defaults + env override, no entity | Q8 asked for *minimal*; a tenant CRUD table is maintenance without a consumer. Unknown model → honest `—`, never a guess. |
| Extend rollup jsonb + `/metrics/overview` instead of a new traces endpoint | Same freshness/fallback contract, one polling surface for the cockpit, no new route to gate/document; `metrics/agents` is new only because batch-per-agent has no home. |
| Audit log = server-paginated proposals list | The API already does pagination/sort/enrichment; a bespoke audit endpoint would duplicate it for zero gain. |

## Architecture

No new modules, queues, or events. Touched command surface: `agent_orchestrator.runs.complete` / `runs.fail` (additive inputs). Read path: two metrics endpoints (one extended, one new) in front of `AgentMetricRollup` with live fallback — identical topology to the shipped `/metrics/overview`. All queries tenant/org-scoped; encrypted columns untouched by this spec (no new encrypted fields; reads keep existing `findWithDecryption` paths).

## Data Models

### AgentRun (modified, additive)
- `completed_at`: timestamptz, nullable — stamped by `runs.complete`/`runs.fail`; backfilled from `updated_at` for terminal rows; never mutated afterwards.

### Model pricing (config, not an entity)
- Default map in `lib/runtime/modelPricing.ts`: `Record<model, { inputPer1M, outputPer1M }>` (currency from `OM_AGENT_COST_CURRENCY`, default `USD`).
- `OM_AGENT_MODEL_PRICING` env: JSON merged over defaults.

### AgentMetricRollup.metrics (jsonb, additive keys)
- `+ errorRate: number | null`, `+ p95LatencyMs: number | null` (per agent-window; computed by the existing rollup worker).

## API Contracts

### `GET /api/agent_orchestrator/metrics/overview` (extended, additive)
- `+ traces: { p95LatencyMs: number | null, errorRate: number | null, evalPassRate: number | null, source: 'rollup' | 'live' }`
- `+ correctionsCount: number` (windowed)
- Existing fields, gate (`proposals.view`), and window semantics unchanged.

### `GET /api/agent_orchestrator/metrics/agents` (new)
- Query (zod): `window: '24h'|'7d'|'30d'` (default `7d`), `ids: string` (comma-separated agent ids, 1–50).
- Gate: `agent_orchestrator.agents.view`. openApi documented.
- Response: `{ items: Array<{ agentId, runsTotal: number, overrideRate: number | null, evalPassRate: number | null, avgLatencyMs: number | null, avgCostMinor: number | null, currency: string | null, source: 'rollup' | 'live' }> }`
- 403 without the feature; unknown ids return no item (no existence oracle).

### `POST /api/agent_orchestrator/agents/[id]/run` and `/runs/[id]/rerun` (error contract, additive)
- `422 { error, code: 'guardrail_blocked', kind: GuardrailKind, phase: 'input'|'output', guardrailSetVersion: string | null }` for `AgentGuardrailBlockedError`; existing 422 shape kept for plain `AgentOutputInvalidError`.

### `agent_orchestrator.runs.complete` / `runs.fail` (command, additive)
- `+ confidence?`, `inputTokens?`, `outputTokens?`, `costMinor?`, `currency?` — optional; undefined leaves columns untouched.

## Internationalization (i18n)

New/changed keys (all ×4 locales, sorted): `overview.window.{h24,d7,d30,now,caption7d}`, `overview.panel.{forbidden,error,retry}`, `overview.refreshedAt`, `traces.kpi.source{Rollup,Live}`, `agents.list.costEstimated`, `traces.detail.costEstimated`, `playground.guardrailBlocked`, `playground.declaredTools`, `playground.noDeclaredTools`, `audit.log.serverPaginatedNote`; removed: stale needs-backend keys that lose their last usage (verify by grep before deleting).

## Migration & Compatibility

- One additive migration (column + backfill) on `agent_runs`; `if not exists` guards; safe re-run; no downtime. Snapshot updated; known partial-index generator noise already resolved on this branch.
- All API/command changes additive; existing clients unaffected. No BC-frozen surface touched (checked against `BACKWARD_COMPATIBILITY.md` categories: no removals, no signature changes, no event-id changes).

## Implementation Plan

### Phase 1 — Forensic facts (S)
1. `completed_at` column + backfill migration + snapshot; stamp in `runs.complete`/`runs.fail`; `ingestTrace` null-only set.
2. Trace inspector + `RunView` render `completedAt` (`—` fallback); flag-immutability unit test.

### Phase 2 — Confidence & cost (S–M)
1. Additive `runs.complete`/`runs.fail` inputs; native runner passes confidence + usage.
2. `modelPricing.ts` (defaults + env merge + tests); cost computation at completion and in `ingestTrace` (null-only).
3. "Cost (est.)" labels; unit tests: known model → cost, unknown model → null, env override wins.

### Phase 3 — Aggregates (M)
1. Rollup service computes `errorRate`/`p95LatencyMs`; worker tests.
2. Extend `/metrics/overview` (`traces` block + `correctionsCount`) with live fallback; new `/metrics/agents` batch endpoint + validators + openApi; `yarn generate`.
3. Traces list consumes the `traces` block + windowed facet counts (delete client KPI math) and renders the strip's 403 forbidden-note variant for `trace.view`-only users; Agents list/detail + Overview trust panel consume `/metrics/agents` exclusively (delete the 100-row heuristic and the N+1 fan-out; `/agents/:id/metrics` untouched).
3a. Traces list rows: swap the `pageSize=100` client slice for server pagination (`page/pageSize/sortField/sortDir` on `api/runs`, caseload pattern); totals from the response; the consistency spec's header-sort re-enable binds here.
4. Audit page: server-paginated proposals + `ids=` run enrichment + overview KPIs; remove dead Filters/Export.

### Phase 4 — Overview honesty (S)
1. Window select wired to `window` param (URL-persisted); copy unification; per-tile window captions.
2. Discriminated `fetchList`; per-panel forbidden/error/empty states; real `lastLoadedAt`.

### Phase 5 — Error contract & truth-in-UI (S)
1. Guardrail-block mapping on run + rerun routes; playground alert; route unit tests (subclass before parent).
2. Autonomy control disabled; playground "Declared tools" retitle; process mapper null-honesty + cell fallbacks.

Each phase ships independently; validation per phase: module jest suite, `tsc --noEmit`, `yarn i18n:check-sync`, `yarn generate` where routes change.

## Integration Test Coverage (implement with this spec)

- `TC-AGENT-HONESTY-001`: complete a run, flag then unflag it → `GET /runs/:id` `completedAt` unchanged; inspector shows stable Finished.
- `TC-AGENT-HONESTY-002`: native playground run with a priced model → run detail shows confidence (from proposal) and non-null estimated cost; unknown-model run shows `—`.
- `TC-AGENT-HONESTY-003`: seed >100 runs across 2 agents → traces KPI strip matches seeded totals (not a 100-row sample); agents list shows per-agent real counts; `metrics/agents` 403s without `agents.view`.
- `TC-AGENT-HONESTY-004`: seed >100 disposed proposals → audit page KPIs match totals; log paginates server-side past row 100.
- `TC-AGENT-HONESTY-005`: user with `proposals.view` but no `agents.view` on Overview → trust panel shows forbidden state, stuck panel still real; API failure simulation shows error-with-retry, not "nothing stuck".
- `TC-AGENT-HONESTY-006`: run an agent whose input trips a moderation guardrail → playground shows the guardrail-blocked alert with kind/phase, not invalid-output.

## Risks & Impact Review

#### Backfill approximates history with `updated_at`
- **Scenario**: rows flagged before this ships get a `completed_at` equal to their flag time.
- **Severity**: Low · **Affected**: historical trace detail only.
- **Mitigation**: one-time, documented in the migration; all new rows stamped correctly.
- **Residual**: a bounded set of historical rows carries minutes-to-days skew — acceptable, previously the value was *always* wrong.

#### Live-fallback p95 on large tenants
- **Scenario**: no fresh rollup (worker lag) → `percentile_cont` over a big window scans many rows per request.
- **Severity**: Medium · **Affected**: `/metrics/overview` latency.
- **Mitigation**: indexed (`org,status,created_at`), single window query, rollup-preferred path is the steady state; coalesced client reloads already bound request rate.
- **Residual**: worst-case slow responses during worker outages — visible via the `source: 'live'` flag.

#### Pricing table staleness
- **Scenario**: provider reprices; costs drift from reality.
- **Severity**: Low · **Affected**: cost cells (labeled "est.").
- **Mitigation**: env override without redeploy; "estimated" labeling; unknown models never guess.
- **Residual**: estimates are estimates — accepted by Q8.

#### Aggregate/rollup key drift
- **Scenario**: old rollup rows lack `p95LatencyMs`/`errorRate`; naive reads render 0.
- **Severity**: Medium · **Affected**: traces KPIs, agents health.
- **Mitigation**: missing key ⇒ treated as no-rollup ⇒ live fallback (explicit in the resolver, unit-tested).
- **Residual**: none material.

#### Audit page behavior change
- **Scenario**: users accustomed to client-side free-text search over the 100-row sample lose it until server `q` ships.
- **Severity**: Low · **Mitigation**: disposition filter + honest note; correct totals outweigh a search over a lying sample.
- **Residual**: reduced ad-hoc search for one release.

Tenant isolation: every new query carries `tenantId`/`organizationId` (same scope pattern as siblings); `metrics/agents` returns nothing for foreign ids. No shared caches introduced. Interrupted stamping: `completed_at` set in the same command/EM flush as the status transition — atomic per row.

## Final Compliance Report — 2026-07-12

### AGENTS.md Files Reviewed
- `AGENTS.md` (root) · `packages/enterprise/src/modules/agent_orchestrator/AGENTS.md` · `packages/core/AGENTS.md` (API routes, commands) · `packages/shared/AGENTS.md` (i18n, boolean/env parsing) · `.ai/ds-rules.md` · `BACKWARD_COMPATIBILITY.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root | Tenant/org scoping on all queries | Compliant | All new reads/writes carry both |
| root | Zod validation, validators in `data/validators.ts` | Compliant | `metrics/agents` query schema; additive command input schemas |
| root | No hardcoded user-facing strings | Compliant | All new copy via i18n ×4 |
| root | Migrations via `db:generate`, snapshot reviewed | Compliant | One additive column + backfill |
| core | API routes export `openApi` | Compliant | New + extended endpoints documented |
| core | Encryption: reads via decryption helpers | Compliant | No new sensitive columns; existing paths untouched |
| BC | Contract surfaces additive-only | Compliant | Command inputs optional; response fields additive; error contract adds `code`, removes nothing |
| ds-rules | Status tokens, no arbitrary values | Compliant | New alert uses status-error tokens; no new arbitrary values |
| module | Commands for mutations | Compliant | Stamping flows through existing `runs.*` commands |

### Internal Consistency Check

| Check | Status |
|-------|--------|
| Data models match API contracts | Pass |
| API contracts match UI/UX consumers listed | Pass |
| Risks cover all write operations (migration, stamping, rollup) | Pass |
| Commands defined for all mutations | Pass |
| No cache layer required (rollup + coalesced reload bound read cost) | Pass |

### Non-Compliant Items
None.

### Verdict
**Fully compliant — ready for implementation** (after specs 1–2 land, for the two declared dependencies: spec 2's `{runId}` return for future real-tools rendering; none blocking this spec's own phases).

## Changelog

### 2026-07-12
- Initial specification (UX audit theme A; gate decisions Q7 = server-side aggregates, Q8 = minimal pricing config). Verified against working-tree code: `runs.complete` input shape, rollup jsonb keys, run-route error mapping order, agents/audit sampling paths.
- Post-review fixes applied per fresh-context architectural review: H-1 (§3.7 pointer corrected — real tool calls are the navigation spec's §1/step 1.4; this spec ships the fallback retitle), H-2 (traces-list server-side row pagination added to §3.3(a) + Phase 3 step 3a), M-5 (traces KPI-strip 403 forbidden-note specified; Agents pages route exclusively through the `agents.view`-gated batch endpoint, `/agents/:id/metrics` gate unchanged); Filters/Export removal ownership confirmed here (M-3).
- **Implemented** (all five phases, one commit each on `feat/agent-orchestrator-mvp`):
  - Phase 1 `ec96afb36` — `completed_at` column + backfill (terminal vocabulary widened to incl. `cancelled`), atomic stamping in `runs.complete/fail`, ingest null-only set from newest span end (envelope carries no run end time), inspector renders `completedAt` never `updatedAt`, flag-immutability guard test.
  - Phase 2 `2b1967203` — additive `runs.complete/fail` inputs (confidence/tokens/cost/currency), `lib/runtime/modelPricing.ts` (6 routed models, per-1M USD estimates, `OM_AGENT_MODEL_PRICING`/`OM_AGENT_COST_CURRENCY` overrides, slash/date-suffix tolerant resolution), cost computed from the model that actually answered, null-only ingest cost, "Cost (est.)" labels ×4.
  - Phase 3 `f979f777b` — rollup keys (counts stored alongside rates for cross-agent summability), `/metrics/overview` `traces` block + `correctionsCount` (p95 always-live — org percentiles can't aggregate from per-agent rollups, documented), new `GET /metrics/agents` batch endpoint, traces list fully server-paginated with real KPIs + 403 forbidden-note, agents/overview repointed (100-row heuristic + N+1 fan-out deleted), audit page rebuilt server-paginated.
  - Phase 4 `1972166b9` — real 24h/7d/30d window select (URL-persisted, feeds both metrics calls), per-tile window/now captions, discriminated per-panel forbidden/error/retry states (stuck panel never false-all-clears), live "Updated X ago".
  - Phase 5 `effe5a12e` — `guardrail_blocked` 422 contract on run + rerun (subclass before parent) + playground ShieldAlert, autonomy control disabled (mutation plumbing removed), declared-tools honest fallback, process mapper null-honesty.
  - TC-AGENT-HONESTY-001…006 authored (006 exercises the client contract via request interception — no shipped guardrail is deterministically trippable from the playground; server side unit-covered).
