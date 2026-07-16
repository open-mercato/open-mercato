# Agent Orchestrator — UX & Usability Audit

**Date:** 2026-07-12 · **Branch:** `feat/agent-orchestrator-mvp` (incl. the same-day uncommitted work: trace-inspector real-data chain, native runtime P1–P2, Agentic Tasks P1–P4, process projection)
**Method:** 8 parallel auditors — 7 code-slice audits (Overview, Caseload, Traces, Agents+Playground, Processes, Tasks/eval-assertions/audit, cross-cutting IA/i18n/DS/ACL) + 1 **live empirical walkthrough** (ephemeral env, Playwright, all 9 pages empty **and** populated, real LLM runs, 43 screenshots, dark mode + 390 px). Findings below are deduplicated and re-ranked across all eight reports; per-finding evidence is `file:line` or a screenshot name (screenshots in the session scratchpad `ux-audit/`).

**Live-session health note:** zero console errors, zero page errors across every page in both passes; only the two live LLM calls exceeded 1 s. The foundation is solid — the problems are honesty, navigation, and throughput, not stability.

---

## P0 — Ship-blockers

| # | Finding | Evidence | Fix |
|---|---------|----------|-----|
| P0-1 | **Route collision: the entire Agentic Tasks UI is unreachable.** Sidebar "Agentic Tasks" → `/backend/tasks`, but core workflows' "User Tasks" owns the same path and wins; the launcher (list, create, Run-now, run history) cannot be reached anywhere in the app. Two near-identically-named menu items point at one URL. | live: `27-tasks-populated.png` renders "User Tasks"/"Workflow Engine" | Rename the module's path (e.g. `/backend/agentic-tasks`) + distinct menu label; add a route-collision guard test. |
| P0-2 | **Processes pages gate the wrong ACL feature.** `page.meta.ts` still guards the interim `trace.view` while the APIs now gate `processes.view` — users with `trace.view` see the page and 403 on every fetch; users with only `processes.view` can't see the page at all. | `backend/processes/page.meta.ts:17`, `[id]/page.meta.ts:4` vs `api/processes/route.ts:23` | Flip both metas to `processes.view`; delete the stale comment. |
| P0-3 | **Fake-clickable case actions flash success.** Processes detail's Pause / Reassign / **Take over** are enabled buttons (Take-over styled primary) that flash a success-toned toast while doing nothing; copy still says "design preview" on a live page. An operator on a `fraud_hold` case believes they took ownership. | `backend/processes/[id]/page.tsx:538-561`; live `64-process-detail.png` | Disable with tooltip ("needs assignment support") or hide; never success-tone a no-op. |
| P0-4 | **Destructive deletes have no confirmation.** Task delete (tears down its cron registration), event-trigger delete, and eval-assertion delete all fire on a single click, no undo. | `backend/tasks/page.tsx:497-509`, `backend/tasks/[id]/page.tsx:459-466`, `backend/eval-assertions/page.tsx:428-440` | Confirmation dialogs (house Cmd+Enter/Escape rules) with blast-radius copy. |
| P0-5 | **Overview renders fabricated numbers as fact.** "Where humans stepped in" shows hardcoded 412/188/96/61/53 interventions with **no Sample label**, next to real KPIs, and deep-links to the real audit page whose data won't match. Sister issue: hardcoded "Claims adjudication" domain chip for every tenant. | `backend/overview/page.tsx:238-246,400-433,260`; live `65-overview-populated.png` | Add the Sample/pending marker (pattern exists on the same page) or hide the section; derive/remove the domain chip. |
| P0-6 | **Caseload inbox hard-caps at 20 items with no pager.** Tab badge says "Action required: 110", the primary decision view shows 20, and there is no way to reach item 21 (pagination exists only in the list view). | `backend/caseload/page.tsx:671-689` vs `:718-733` | Pager / load-more / infinite scroll in `ExceptionsInbox`; at minimum "20 of 110 loaded". |

## P1 — Major, grouped by theme

### A. Data honesty (the cockpit's core currency)

1. **Silent 100-row samples presented as aggregates.** Traces list fetches one `pageSize=100` page and computes window KPIs (p95, error rate), facet counts, search, and pagination client-side (`backend/traces/page.tsx:131,151-186`); Agents list derives per-agent runs/override/health from the last 100 **global** events — no agent filter, so "Status: poor" is sampling noise (`backend/agents/page.tsx:87-90`); Audit page KPIs + log are a 100-row client join labeled "Agent decisions logged" (`backend/audit/page.tsx:107-108,257`). *Fix: server aggregates (metrics endpoints exist) or explicit "newest 100 of N" caveats.*
2. **"Needs backend" chips where the backend exists.** Agents list/detail "Eval pass" and "Cost/run" cells + KPI cards say Needs-backend while `GET /agents/:id/metrics` (rollup-backed) already serves those numbers (`backend/agents/page.tsx:187,209,277-292`); Overview's window picker is a dead button flashing "Needs backend" while the API supports `window=24h|7d|30d` (`backend/overview/page.tsx:273-277` vs `api/metrics/overview/route.ts:25`). *Fix: wire them; the honesty pattern must track the backend.*
3. **Forensic facts that mutate.** "Finished" renders `run.updatedAt`, and Flag/unflag bumps it — flagging yesterday's failing run moves its visible finish time to now (**confirmed live**: 03:47 → 06:48 after Flag; `commands/runActions.ts:42`, `backend/traces/[id]/page.tsx:804`, screenshots `30` vs `72`). *Fix: render a real completion timestamp.*
4. **Native runs render "Confidence —" and "Cost —"** — the runner never stamps `run.confidence` (the proposal has it) nor computes `cost_minor` despite token counts (**confirmed live + DB**). *Fix: stamp both in the native persistence tail.*
5. **Playground "Tools used" lists declared tools, not what ran** — "Tools used: policy.lookup" with zero actual calls (`backend/playground/page.tsx:228-249`). *Fix: real tool calls via the trace, or retitle "Declared tools".*
6. **Agents detail "Configure" drawer's autonomy toggle is a live-looking mock** — fully interactive, reflected in the header stat, persisted nowhere; a safety-relevant control (`backend/agents/[id]/page.tsx:519,89,245-247`). *Fix: disable like the other fields or actually persist.*
7. **Silent 403/failure → fake empty states.** Overview panels swallow errors into `{items:[]}` — a permission gap renders "No agents yet", a transient failure renders "Nothing stuck right now" (false all-clear) (`backend/overview/page.tsx:76-81`). *Fix: per-panel error/forbidden states.*
8. Smaller: static "Data refreshed just now" (`overview/page.tsx:269`); mixed 7d-vs-current-state time bases under one "last 7 days" chip (`route.ts:107-125`); process list null-to-zero coercions (unknown cost → `0`, unknown date → epoch/age "20000d", `components/processTypes.ts:588-592`); audit "Waiting"/"Closed today" dead KPI tiles.

### B. Broken / asymmetric navigation (the golden paths)

1. **Playground → nothing.** The run route returns only the typed result — no `runId`/`proposalId` — so there's no "View trace", and "Open this proposal in Caseload" links to the generic list (`api/agents/[id]/run/route.ts:87,122`; live `12`). *Highest-leverage single fix in the module: return both ids, render both links.*
2. **"Add to evals" is a dead end** — success toast, idempotent repeat message, and **no eval-cases page exists anywhere** to see/edit/delete what was created (live `32/33`). *Fix: minimal eval-cases list page (route + table), or link into wherever eval cases will live.*
3. **"Open process" renders for processless runs** and navigates to the degraded banner: traces `run.processId ?? run.id`, caseload same fallback, and Overview sends a **proposal id** (`backend/overview/page.tsx:337`). *Fix: gate all three links on a real `processId`.*
4. **Processes "Waiting on you" has no path to the decision** — the one action the status demands (dispose in Caseload) is not linked; Caseload and Processes never cross-link in either direction (`backend/processes/[id]/page.tsx:342`). *Fix: "Review in Caseload" button on pending steps.*
5. **Trace ↔ proposal asymmetry** — caseload links to the trace, the trace never links back to its proposal(s) though the API now returns them; trace back-button always goes to the traces list regardless of where you came from. |
6. **Agents detail recent-runs rows aren't clickable** to the trace inspector; cost column hardcoded `—` (`backend/agents/[id]/page.tsx:274-293`).
7. **Queue context evaporates** — caseload view/filters/page live in React state only; disposing from the detail page hard-pushes to bare `/backend/caseload` (`[proposalId]/page.tsx:145`). *Fix: URL-encode queue state.*
8. `/backend/audit` is an orphan (URL-only, not in the sidebar); the genuinely good `by-instigator` on-behalf-of chain page is linked only from Overview. Sidebar alphabetizes the AGENTS group, burying Overview/Caseload below "Eval assertions".

### C. Operator throughput & decision safety (Caseload)

1. **All-mouse loop**: no j/k, no A/R/E hotkeys, approve = 2 clicks, reject = 3 + typing; "auto-advance" resets selection to the top row, not the neighbor (`caseload/page.tsx:920-922,939-965,1076-1096`).
2. **Live events wipe bulk selection** mid-task — any org-wide `proposal.*` event clears the checkbox set (`:381,312-314`). *Fix: intersect selection with surviving ids.*
3. **Risky rows look identical to safe rows** — no guardrail/risk chip at row level, approve is a frictionless hover-icon adjacent to reject; rubber-stamping is a named spec risk. *Fix: warn/fail chips on rows + confirm-or-undo for warn-flagged approves.*
4. **"Proposes" column shows accidental prose** — `summarizeProposal` probes keys that don't exist on the canonical payload and falls back to the rationale sentence, which then pollutes the pane headline and the "All decisions" filter options (`:135-145` vs `proposalFactsData.ts:67-99`). *Fix: reuse `summarizeProposalShaped`.*
5. **Edit-before-approve is whole-payload raw-JSON surgery** — `isComplexPayload` is effectively always true for real proposals (`ProposalCard.tsx:82-91,264-276`). *Fix: structured editor over `actions[n].payload`.*
6. Auto-approved vs human-approved indistinguishable in the Approved tab; tab counts can silently zero on a failed overview call while rows render; bulk-failure = flash storm.

### D. Consistency mechanics (one product, one behavior)

1. **Live-refresh matrix is incoherent**: overview/caseload/processes-list refresh live; traces list+detail, agents, tasks list refresh never (`run.completed`/`run.ingested` aren't `clientBroadcast`; a "Running" trace stays stale forever); `guardrail.tripped` is broadcast with zero listeners. *Fix: broadcast run lifecycle + subscribe with `useCoalescedReload`; tasks list column + `task_run.*` listener.*
2. **Six divergent date/duration formatters** across pages + **hardcoded `toLocaleString('en-US')` in 8 files** — pl/de/es users get English number/date formats. *Fix: shared formatters in `components/types.ts`, locale from i18n context.*
3. **Column-header sorting lies on server-paginated tables** — sorts only the visible page on Traces and Processes while a global sort select/param exists (`traces/page.tsx:333-338`, `processes/page.tsx:236`). *Fix: bind header sort to the server param or disable.*
4. **Raw enum leakage**: guardrail `pass/warn/block`, phase chips, tool status `ok` untranslated on the trace page (caseload translates the same vocabulary); `RUNTIME_LABEL`/`titleCase(autonomy)` hardcoded English; `runtime.native` i18n key missing ×4 locales.
5. Search gaps: no run-id search on Traces (the #1 debugging entry point), no search box at all on Processes (`q` is supported server-side).
6. Playground lacks the shared `LoadingMessage`/`ErrorMessage`; guardrail-blocked runs surface as generic "invalid output" 422 — policy blocks masquerade as model bugs (`lib/runtime/errors.ts:47`, `api/agents/[id]/run/route.ts:92-94`). *Fix: map the subclass, render "Blocked by guardrail (kind, phase)".*

### E. Domain leakage (claims vocabulary on a generic platform)

"Claims adjudication" chip (Overview), "Search claims…" placeholder + "Claim" column (Caseload), "Claims worked jointly…" subtitle + "Claim"/"Policyholder"/"Claimed" labels (Processes), "Claim" column with `claimId/dealId` key-sniffing (Audit, Overview stuck queue, Agents detail) — while the shipped example agents are **deals**. *Fix: neutral vocabulary ("Subject", "Reference") driven by `subjectType`/declared facts; one sweep across 5 pages.*

### F. Tasks & scheduling safety

1. **Workflow-target task with empty permissions passes create and Run-now, fails only at runtime** with an opaque reason — the spec's own pre-check (§369) is unimplemented. *Fix: per-target-type prefill/validation + create-time warning.*
2. **Cron/timezone inputs validate shape, not meaning** — `foo bar baz qux quux` passes the regex; timezone is free text; scheduler registration is best-effort and failures are invisible (no "next run at…", no schedule-health). |
3. **Features picker is blind free text** against an invisible vocabulary — typos surface as failed runs. *Fix: datalist from the ACL registry + save-time validation.*
4. Event-trigger power features (`filterConditions`, `contextMapping`, `debounceMs`, concurrency) are API-only; dialog collects a bare pattern, triggers can't be edited or inspected. Tasks list: no last-run/status column, caps at 100 without pagination, no client-side ACL awareness (operators see admin controls that 403 on submit), no Edit on the detail page.
5. Audit page: dead Filters/Export buttons; raw UUIDs in the Operator column; `llm_judge` silently coerces `gate`→`warn` severity with no explanation.

## P2 — Minor (selection; full lists in the per-slice reports)

Overview: invisible SLA/health thresholds; run-uuid prefixes under "ID"; 11 dead i18n keys; info icon without tooltip; `formatWait` caps at hours; reload misses run events; N+1 per-agent metrics fan-out (also a perf issue). Traces: artifact expander lacks size cue and collapse; tool `<pre>` blocks lack the copy affordance `JsonDisplay` has; timeline has no span-kind legend, axis collides at 390 px; "1 steps" plural; empty-state style split (EmptyArt vs bare text). Caseload: "Gated to you" vs "shared caseload" copy contradiction; dead select-all on non-pending tabs; "(s)" pluralization. Processes: facet-blind empty copy; 6 API calls per reload (5 count probes); auto-selects the oldest step; completed processes still show a "current" stage; UTC/local day-divider mismatch; degraded-banner engineerese ("Run rebuild-processes") shown to operators; avatars without tooltips. Playground: input not reset on agent switch; sample of agent A submittable to agent B; org-scope/429/422 server strings English-only; `Retry-After` ignored. Agents: "Open in playground" row action renders for roles that 403 on the playground; last-active times HH:MM-only without dates; override meter's unexplained 40 % ceiling. A11y (cross-page): clickable `<tr>`s without keyboard/link semantics (Overview, Agents detail); facet tabs without `role="tab"`; accordions without `aria-expanded`.

## What's genuinely good (don't churn)

- **The core loop works and feels honest**: Playground → run → "Gated to you" proposal → Caseload → Approve was one of the live session's three smoothest moments; `ProposalCard` reuse makes playground results look exactly like caseload proposals.
- **The trace inspector is dense, real, and resilient** — timeline, evals, tool calls, guardrail verdicts, routed/pruned context chips all live-verified, surviving 390 px and dark mode; pruned-context reason tooltips are exactly what TDCR inspectability needs.
- **DS-token discipline is near-perfect** (2 arbitrary values in ~9 000 UI lines); i18n is complete (670/670 keys ×4 locales, zero interpolation bugs); status-tone vocabularies are semantically coherent module-wide.
- Honest-degradation patterns where applied: rollup-vs-live `source` hint, "Needs backend" chips, projection-less process banner, robust dual-id process deep links, mandatory rejection reasons, optimistic-lock conflict bars, coalesced SSE refresh, fail-closed org attribution on the run route.
- Zero console/page errors and instant page loads across the live session.

## Recommended fix order

1. **Day one (small, ship-blocking):** P0-1 route rename · P0-2 ACL meta flip · P0-3 disable stub actions · P0-4 delete confirms · P0-5 label/hide fake overview section · P0-6 inbox pager.
2. **The navigation pass (1–2 days, transforms the product):** playground returns `runId`/`proposalId` + links · trace↔proposal symmetry · `processId`-gated "Open process" everywhere (incl. Overview's proposal-id bug) · "Review in Caseload" on process steps · minimal eval-cases page · audit page into the sidebar.
3. **The honesty pass:** Finished-timestamp fix · native confidence/cost stamping · wire agents metrics + overview window param · sample-size caveats or server aggregates (traces/agents/audit) · guardrail-block error mapping · autonomy toggle disable.
4. **The operator pass (caseload):** keyboard flow + deliberate auto-advance · selection preservation · row-level risk chips · `summarizeProposalShaped` · structured edit.
5. **The consistency pass:** run-event `clientBroadcast` + traces/tasks live refresh · shared date/number formatters (kill `'en-US'`) · header-sort fixes · enum label maps · domain-vocabulary sweep · tasks safety items (cron/tz validation, permission prefill, features datalist).

---

*Full per-slice reports (with complete MINOR/NIT lists) live in the eight auditor transcripts from this session; screenshots (43) in the session scratchpad `ux-audit/` — key evidence: `27` (route collision), `65` (fake interventions), `64` (stub actions), `30`/`72` (Finished-timestamp mutation), `12` (playground dead end).*
