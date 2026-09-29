# Agent Orchestrator — UX Remediation Spec 2: Navigation Pass

> Part of the [UX remediation plan](./2026-07-12-ux-remediation-plan.md) (spec 2 of 5). Source findings:
> [`.ai/analysis/2026-07-12-agent-orchestrator-ux-audit.md`](../../../analysis/2026-07-12-agent-orchestrator-ux-audit.md), theme B.
> Assumes spec 1 (P0 hotfixes) has landed — in particular the `/backend/agentic-tasks` route rename and the
> Processes ACL meta flip.

## TLDR

**Key Points:**
- Closes every dead end and asymmetry on the cockpit's golden paths: the Playground finally links to the trace and proposal it just created; the trace inspector links back to its proposal(s); "Open process" renders only when a real `processId` exists (and Overview stops sending a **proposal id** to the process detail); Processes' "Waiting on you" gains a "Review in Caseload" action; "Add to evals" stops being a write-only black hole via a minimal read-only eval-cases page; the audit page joins the sidebar and the AGENTS menu group is ordered by persona priority.
- All API changes are **additive response fields or new read-only routes** — no breaking contract changes, no schema changes, no new entities.
- Effort: S–M. One enterprise module, one candidate shell-behavior check (menu ordering) that may escalate to core (Ask First — flagged below).

**Scope:** `packages/enterprise/src/modules/agent_orchestrator/` — `api/agents/[id]/run`, new `api/eval-cases` list route, `backend/{playground,traces,overview,processes,caseload,agents,audit,eval-cases}` pages + metas, `lib/runtime` (one additive ctx hook), i18n ×4.

**Concerns:** sidebar ordering may be decided by the shell, not `pageOrder` (the live audit observed alphabetical order despite explicit `pageOrder` values) — step 4.2 verifies and, if the fix is in `packages/ui`, it becomes an Ask First core touch.

## Overview

The audit's live walkthrough rated the propose→dispose loop one of the smoothest moments in the product — and then found that almost every hop *between* surfaces is missing, asymmetric, or wrong: Playground → nowhere (no run/proposal ids in the response), trace → proposal absent while proposal → trace exists, "Open process" reliably navigating to a degraded banner for non-workflow runs (and Overview passing a proposal id outright), Processes' own "waiting on you" status offering no path to the decision it demands, "Add to evals" creating records no page can display, and the audit page reachable only by URL. This spec is one coherent navigation pass: every object that references another object gets a real, gated link, in both directions where the journey warrants it.

## Problem Statement

Verified against the working tree (2026-07-12):

1. `POST /api/agent_orchestrator/agents/[id]/run` returns the bare typed `AgentResult` (`api/agents/[id]/run/route.ts:122` — `NextResponse.json(result)`); `agentRuntime.run` returns only that result, so the route has no run/proposal ids. The Playground's success card links to the generic `/backend/caseload` (`backend/playground/page.tsx:212`) under copy promising "this proposal" (audit B-1, live `12-playground-after-run.png`).
2. The trace inspector's API response now includes the run's `proposals`, but the page renders no link to them; caseload → trace exists, trace → caseload doesn't. The trace back button always pushes `/backend/traces` regardless of origin (audit B-5).
3. "Open process" fallbacks: traces detail `run.processId ?? run.id` (`backend/traces/[id]/page.tsx:728`), caseload detail `proposal.processId ?? proposal.id`, and Overview's stuck queue pushes `row.id` — a **proposal id** (`backend/overview/page.tsx:337`) — even though the proposals list API already returns `processId` (`api/proposals/route.ts:56`); the `StuckRow` type simply never threads it (`backend/overview/page.tsx:33`) (audit B-3, P1-B2).
4. Processes detail: status `waiting_on_you` and `pendingProposalCount` are computed (`backend/processes/[id]/page.tsx:411,417`), each timeline step is keyed by `proposal.id` (`:152`), yet the only action anywhere is "Open full trace" (`:343`) — no path to `/backend/caseload/<proposalId>` (audit B-4/M1).
5. "Add to evals" (`POST /api/.../runs/[id]/eval-case`, gate `eval.manage`) creates draft `AgentEvalCase` rows; **no list route and no page exist** (`api/eval-cases/` contains only `[id]/approve` and `export`), so the record is invisible forever (audit B-2, live `32/33`).
6. IA: `backend/audit/page.meta.ts` has `navHidden: true` and no `labelKey`; the valuable `backend/audit/by-instigator` chain page is linked only from Overview. The AGENTS sidebar group renders alphabetized in practice (live audit), burying Overview and Caseload below "Eval assertions" despite `pageOrder` 90/100.
7. Agents detail recent-runs rows are plain `<tr>` with no navigation (`backend/agents/[id]/page.tsx:275`) — "overridden ✗" has no path to *why*.

## Proposed Solution

### 1. Playground → trace & proposal

**Contract change (additive):** the run route's 200 response becomes the result object **plus two sibling fields**: `runId: string`, `proposalId: string | null`. The `AgentResult` union (`kind: 'informative'|'actionable'` + `data`/`proposal`) has no such keys, so spreading is collision-free; existing consumers that read `kind`/`proposal` are byte-for-byte unaffected. openApi doc updated.

**How the route obtains `runId`:** additive optional hook on the run context — `AgentRunCtx.onRunPersisted?: (runId: string) => void` (`lib/runtime/persistence.ts`), invoked by `NativeAgentRunner` (and the OpenCode runner) immediately after `runs.create` succeeds. This mirrors the module's established ALS/ctx seam patterns (`rerunContext.ts`, `runContext.ts`) but is simpler: the route owns the closure, no async-storage needed. Rejected alternatives: (a) rerun-style lineage query (`api/runs/[id]/rerun/route.ts:135-140`) — racy without a marker column; (b) changing `agentRuntime.run`'s return type — a breaking runtime contract.

**`proposalId`:** after `run()` resolves, the route makes one scoped `AgentProposal` query by `runId` (newest first, limit 1); `null` for informative runs.

**UI:** the Playground success card renders two actions — "View trace" → `/backend/traces/<runId>`, and "Open this proposal" → `/backend/caseload/<proposalId>` (rendered only when `proposalId` is non-null; the current generic-list link is removed). New i18n keys ×4.

**Real "Tools used" (owns the audit's P1-A5 remainder):** with `runId` in hand, the Playground replaces its declared-tools list (`backend/playground/page.tsx:228-249` — currently rendered regardless of execution) with the run's **actual tool calls**: after a run completes, fetch `GET /api/agent_orchestrator/runs/{runId}` (the trace-detail route, which already returns `toolCalls`) and render a compact tool-call list — name, status badge, latency — reusing the trace inspector's row pattern (read-only, no accordion). **ACL nuance:** that route gates `agent_orchestrator.trace.view` while the playground gates `agents.run`; when the fetch 403s (a runner without trace access), the card degrades to the "Declared tools" retitled list from the data-honesty spec §3.7 — never the false "Tools used" framing. Empty state: "No tool calls in this run."

### 2. Trace ↔ proposal symmetry + back semantics

- Trace header gains an "Open proposal" outline button when `detail.proposals.length > 0`, targeting `/backend/caseload/<proposals[0].id>`; if the run has multiple proposals, a small dropdown lists them by `createdAt` (rare case — sub-agents).
- Back-button policy, applied consistently: **primary back buttons keep their explicit list target** (predictable, matches the module's breadcrumbs); **error-state back buttons switch to `router.back()`** (traces detail load-error, processes detail load-error at `backend/processes/[id]/page.tsx:511`) so a bad deep link returns the user where they came from instead of a foreign list.

### 3. `processId`-gated "Open process"

- Overview: extend `StuckRow` with `processId: string | null` mapped from the proposals list response (field already served); the row's "Open process" button renders only when non-null and navigates to the real process id.
- Traces detail and caseload detail: drop the `?? run.id` / `?? proposal.id` fallbacks; render the button only when `processId` is set. No tooltip-on-disabled — absence is cleaner than a disabled affordance here (the process concept doesn't apply to non-workflow runs).

### 4. Processes → Caseload

- `StepDetailPanel` gains a primary "Review in Caseload" button when the selected step's proposal disposition is `pending` (step id already embeds `proposal.id`; thread the disposition + id through the step model instead of string-parsing).
- The detail header gains the same CTA when `status === 'waiting_on_you'`, targeting the oldest pending proposal (already available from `proposalRows`).

### 5. Minimal eval-cases page (Q6)

- **New route** `GET /api/agent_orchestrator/eval-cases` — thin read-only list (follow the hand-rolled pattern of `api/processes/route.ts`): filters `status?`, `agentDefinitionId?`, `sourceType?`; server pagination (`page/pageSize≤100`, default sort `created_at DESC`); tenant/org-scoped. **Returns metadata only** — `id, status, sourceType, sourceId, agentDefinitionId, createdAt, updatedAt` — never `input`/`expected` (both encrypted per `encryption.ts`), so the route needs no decryption and leaks nothing. Gate: `agent_orchestrator.eval.manage` (matches the create route and `eval-assertions`; no view-tier feature exists and inventing one is out of scope — justified: everyone who can create a case can see the list).
- **New page** `/backend/eval-cases`: read-only `DataTable` (status badge, agent, source type, created), filter tabs by status, empty state explaining cases come from "Add to evals" and dispose-corrections. Meta: group `agent_orchestrator.nav.group`, `pageOrder` 175, gate `eval.manage`. No editing/approval UI — future scope (the approve route exists but its flow belongs to the eval harness UI, not this remediation).
- **Loop closure:** the trace header's "Add to evals" button flips to "View in eval set" (link to `/backend/eval-cases?status=draft`) after a successful or idempotent (`created: false`) response; toast copy unchanged otherwise.

### 6. IA fixes

- `backend/audit/page.meta.ts`: `navHidden` → `false`, add `pageTitleKey`/`labelKey` (`agent_orchestrator.nav.audit`, new key ×4), `pageOrder` 180.
- Explicit `pageOrder` ladder (persona order — operator first): Overview 90 · Caseload **91** · Processes 92 · Traces 95 · Agents 120 · Playground 130 · Agentic Tasks 160 · Eval assertions 170 · Eval cases 175 · Audit 180.
- **Step 4.2 (verify-first):** confirm the backend sidebar sorts group items by `pageOrder`. If it alphabetizes (as the live audit observed), locate the sort in `packages/ui` sidebar/menu merging; a fix there is **core, Ask First** — raise before implementing, with the fallback of accepting alphabetical order and renaming nav labels only as a last resort (not preferred; do not rename without maintainer sign-off).
- Audit page links the `by-instigator` chain page (header action "On-behalf-of chains").

### 7. Agents detail → traces

Recent-runs rows become links to `/backend/traces/<run.id>`: wrap the first cell content in a real link (or row `onClick` + `tabIndex={0}` + Enter/Space handling, matching the a11y fix pattern the consistency spec applies to Overview). Keyboard-accessible either way.

## Data Model & API Contracts

No schema changes. Contract diffs (all additive):

| Contract | Change |
|---|---|
| `POST /api/agent_orchestrator/agents/[id]/run` 200 | `+ runId: uuid`, `+ proposalId: uuid \| null` (sibling fields on the existing result object) |
| `AgentRunCtx` (`lib/runtime/persistence.ts`) | `+ onRunPersisted?: (runId: string) => void` (optional; both runners invoke post-create) |
| `GET /api/agent_orchestrator/eval-cases` | **new** read-only list route (metadata-only projection, gate `eval.manage`) |
| Page metas | audit un-hidden + labeled; `pageOrder` ladder above; new `backend/eval-cases/page.meta.ts` |

## Implementation Plan

**Phase 1 — Playground loop closure** (steps testable independently)
1.1 Add `onRunPersisted` to `AgentRunCtx`; invoke in `NativeAgentRunner` and `openCodeAgentRunner` after run creation; unit test both.
1.2 Run route: collect `runId`, query newest proposal by run, return additive fields; update openApi; unit test (fields present, `proposalId` null for informative, absent-hook BC test).
1.3 Playground success card: "View trace" + gated "Open this proposal"; i18n ×4.
1.4 Playground real "Tools used": post-run fetch of `runs/{runId}`, actual tool-call list with the 403 → "Declared tools" degrade; i18n ×4; unit test for the degrade path.

**Phase 2 — Cross-links**
2.1 Trace header "Open proposal" (+ multi-proposal dropdown); error-state back buttons → `router.back()` (traces, processes).
2.2 Overview `StuckRow.processId` threading + gated button (fixes the proposal-id bug); traces/caseload detail drop fallbacks, gate on `processId`.
2.3 Processes: thread `{proposalId, disposition}` through the step model; "Review in Caseload" on pending step panel + `waiting_on_you` header CTA; i18n ×4.
2.4 Agents detail run rows → trace links (keyboard-accessible).

**Phase 3 — Eval-cases surfacing**
3.1 `GET /api/eval-cases` list route + unit tests (scoping, no encrypted fields in payload, pagination, filters); `yarn generate`.
3.2 `/backend/eval-cases` page + meta + i18n ×4; empty state.
3.3 Trace "Add to evals" → "View in eval set" state flip.

**Phase 4 — IA**
4.1 Audit meta un-hide + label + order; `pageOrder` ladder across all metas; by-instigator link from audit page.
4.2 Verify sidebar honors `pageOrder`; if not → locate in `packages/ui`, **stop and Ask First** before any core change.

## Integration Test Coverage

Implemented in the same change (self-contained fixtures, API-seeded where possible):

- `TC-AGENT-NAV-001` — playground run (seeded agent) → response carries `runId`+`proposalId` → GET both `/backend/traces/<runId>` and `/backend/caseload/<proposalId>` render the objects.
- `TC-AGENT-NAV-002` — trace of a run with a proposal shows "Open proposal" → navigates to the caseload detail → its "trace" link returns to the same run (roundtrip).
- `TC-AGENT-NAV-003` — Overview stuck queue row for a workflow-born proposal navigates to the real process detail; a processless proposal's row renders no "Open process" button.
- `TC-AGENT-NAV-004` — process detail with a pending proposal shows "Review in Caseload" and lands on that proposal; header CTA present when `waiting_on_you`.
- `TC-AGENT-NAV-005` — "Add to evals" on a trace → eval-cases page lists the draft (status filter works); route returns no `input`/`expected` fields; 403 without `eval.manage`.
- `TC-AGENT-NAV-006` — playground run of a tool-using agent → the success card lists the run's actual tool calls (name + status); for a role with `agents.run` but without `trace.view`, the card shows the "Declared tools" fallback instead.

## Risks & Impact Review

| Risk | Severity | Mitigation | Residual |
|---|---|---|---|
| Additive response fields collide with a future `AgentResult` key named `runId` | Low | Keys documented in openApi + a unit test asserting the result schema never defines them; envelope migration path noted for v2 | Negligible |
| `onRunPersisted` throwing breaks runs | Medium | Runners invoke inside try/catch (hook failures logged, never fatal); unit test | Low |
| Menu reordering breaks user muscle memory | Low | One-time change, persona-justified; release note | Accepted |
| Sidebar ordering fix lands in core | Medium | Verify-first step 4.2 with an explicit Ask First gate — no silent core edits | Low |
| Eval-cases route leaks encrypted payloads | High if done wrong | Metadata-only projection by construction + integration assertion (TC-005) | Low |

## Final Compliance Report

- **Module isolation / no cross-module ORM:** ✅ all changes inside `agent_orchestrator`; core touched only behind an Ask First gate (4.2).
- **Tenant scoping:** ✅ new list route filters tenant/org; proposal lookup in the run route reuses the existing scope pattern.
- **Encryption:** ✅ eval-cases list is a metadata-only projection; no decryption path added.
- **Canonical mechanisms:** ✅ `DataTable`, `apiCall`, existing flash/i18n patterns; hand-rolled list route follows the module's `processes` precedent (justified: read-only projection, no CRUD).
- **BC:** ✅ additive-only API fields, optional ctx hook, no renames, no schema changes.
- **DS / a11y:** ✅ semantic tokens only; keyboard-accessible row links; no icon-only buttons without labels.
- **i18n:** ✅ every new string ×4 locales; no hardcoded copy.
- **Integration coverage:** ✅ five TC scenarios listed and shipped with the change.

## Changelog

- **2026-07-12**: Spec authored from audit theme B after the umbrella's Q-gate (Q6 = minimal eval-cases page). Verified all cited code against the working tree.
- **2026-07-12**: Post-review fixes applied per fresh-context architectural review: H-1 — this spec now owns rendering the Playground's **real** tool calls (design in §1, step 1.4, TC-AGENT-NAV-006); confirmed sole ownership of the audit page-meta labeling (§6) and agents-detail run-row links (§7) vs the consistency spec (M-2/M-4).
- **2026-07-12**: **Implemented** (all four phases, one commit each on `feat/agent-orchestrator-mvp`):
  - Phase 1 `f80ce6928` — `onRunPersisted` ctx hook (both runners, never-fatal), run route returns additive `{runId, proposalId}`, playground "View trace"/"Open this proposal" links, real "Tools used" panel with 403 → "Declared tools" degrade.
  - Phase 2 `1d847fd96` — trace-header "Open proposal" (Popover for multi-proposal — no `DropdownMenu` primitive exists, house pattern used), error-state backs → `router.back()`, `processId`-gated "Open process" on overview/traces/caseload (proposal-id bug fixed), "Review in Caseload" on pending steps + `waiting_on_you` header, keyboard-accessible agents-detail run links.
  - Phase 3 `38fcc335d` — `GET /eval-cases` metadata-only list route (encrypted columns never fetched), `/backend/eval-cases` page (status tabs from the real vocabulary `draft|approved|archived`, `?status=` param), trace "View in eval set" flip (incl. idempotent path).
  - Phase 4 `780784fd3` — audit page un-hidden + labeled, persona `pageOrder` ladder, per-row on-behalf-of chain links (deviation: the chain page is parameterized, so a global header action had no valid target). **Step 4.2 resolved module-side, no core change**: the sidebar sorts by `priority ?? order` with alphabetical tie-break (`packages/ui/src/backend/utils/nav.ts:390-397`); all metas carried a constant `pagePriority: 10` → alphabetical. Fixed with distinct per-page priorities (workflows-module convention); two core quirks documented for follow-up (serializeNavItem drops order/priority from the payload; priority shadows pageOrder when constant).
  - TC-AGENT-NAV-001…006 authored (env-gated execution).
