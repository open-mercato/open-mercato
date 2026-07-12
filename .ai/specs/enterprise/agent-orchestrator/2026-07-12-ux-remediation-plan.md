# Agent Orchestrator — UX Remediation Plan (umbrella)

**Date:** 2026-07-12 · **Source:** [`.ai/analysis/2026-07-12-agent-orchestrator-ux-audit.md`](../../../analysis/2026-07-12-agent-orchestrator-ux-audit.md)
(8-auditor UX audit: 7 code slices + 1 live Playwright walkthrough, 43 screenshots, zero console errors).

Per the maintainer's decision the remediation ships as **five sequenced specs** (each its own PR-able unit, landing in order), coordinated by this umbrella. They form an ordered train, not independently orderable units: later passes assume earlier ones (e.g. navigation links assume the P0 route rename; spec 5's Traces header-sort re-enable binds to spec 3's server pagination).

## Decisions locked at the Open Questions gate (2026-07-12)

| Q | Decision |
|---|----------|
| Q1 route collision | Rename the enterprise path to **`/backend/agentic-tasks`** (core `workflows` keeps `/backend/tasks`); add a route-collision guard test. |
| Q2 spec split | **Separate specs per pass** (this umbrella + 5 specs). |
| Q3 fabricated Overview section | **Keep visible with the "Illustrative / Sample" chip pattern** (as on the trace model-comparison card); do not hide. |
| Q4 keyboard flow | **Full keyboard-first Caseload flow in the operator spec** (j/k, A/R/E hotkeys, deliberate advance-to-next, focus management) — not just quick wins. |
| Q5 domain vocabulary | **Neutral labels** ("Subject" / "Reference" / "Value"), noun driven by `subjectType` where available; no tenant-configurable dictionary. |
| Q6 eval-cases dead end | **Minimal read-only eval-cases list page** (`/backend/eval-cases`), deep-linked from the Add-to-evals toast and trace header; editing/approval flow stays future scope. |
| Q7 100-row-sample KPIs | **Straight to server-side aggregates** for Traces-list KPIs, Agents health, and the Audit page (rollup/metrics precedents exist) — no interim caveat-only tier. |
| Q8 native run cost | **Add a minimal per-model pricing config** (model → price per 1M input/output tokens) and compute `cost_minor`; stamp `run.confidence` from the proposal. |

## The five specs

| # | Spec | Scope (audit refs) | Effort |
|---|------|--------------------|--------|
| 1 | [`2026-07-12-ux-p0-hotfixes.md`](./2026-07-12-ux-p0-hotfixes.md) — **✅ implemented 2026-07-12** (commits `73b87cd9b`, `41ad6a23a`, `c243a4569`) | P0-1…P0-6: route rename + guard test, Processes ACL meta flip, stub-action disable, delete confirmations ×3, Overview fabricated section → Sample chip + claims-chip removal, Caseload inbox pager | S |
| 2 | [`2026-07-12-ux-navigation-pass.md`](./2026-07-12-ux-navigation-pass.md) — **✅ implemented 2026-07-12** (commits `f80ce6928`, `1d847fd96`, `38fcc335d`, `780784fd3`; sidebar ordering resolved module-side — no core change) | Theme B: run route returns `{runId, proposalId}` + playground links, playground "Tools used" → real tool calls from the run's trace detail, trace↔proposal symmetry, `processId`-gated "Open process" (incl. Overview proposal-id bug), "Review in Caseload" on process steps, minimal eval-cases page (Q6), audit page into sidebar + persona menu ordering, agents-detail run rows → trace | S–M |
| 3 | [`2026-07-12-ux-data-honesty-pass.md`](./2026-07-12-ux-data-honesty-pass.md) — **✅ implemented 2026-07-12** (commits `ec96afb36`, `2b1967203`, `f979f777b`, `1972166b9`, `effe5a12e`) | Theme A: Finished-timestamp fix, native confidence + cost stamping w/ pricing config (Q8), Agents metrics wiring (kill stale Needs-backend chips), Overview window param + per-panel 403/error states, **server-side aggregates + traces-list server pagination** for Traces KPIs+rows / Agents health / Audit (Q7; audit-page rebuild incl. dead Filters/Export removal), guardrail-block error mapping, autonomy-toggle disable, playground "Declared tools" fallback retitle | M–L |
| 4 | [`2026-07-12-ux-caseload-operator-throughput.md`](./2026-07-12-ux-caseload-operator-throughput.md) — **✅ implemented 2026-07-12** (commits `b76b26444`, `91641ab78`, `3482249ad`, `111cb2ab9`, `1be13ce90`) | Theme C (full, per Q4): keyboard-first flow, selection preservation on live reloads, advance-to-neighbor, `summarizeProposalShaped`, row-level guardrail risk chips, structured edit over `actions[n].payload`, URL-encoded queue state, approved-tab auto/human distinction | M |
| 5 | [`2026-07-12-ux-consistency-pass.md`](./2026-07-12-ux-consistency-pass.md) — **✅ implemented 2026-07-12** (commits `f0853a0a8`, `d9cc20043`, `d21b19695`, `adbd10584`, `7e207a666`, `b7e9e26da`) | Themes D–F: `clientBroadcast` run lifecycle + traces/tasks live refresh + tasks last-run column, shared date/number formatters (kill `'en-US'` — 13 call sites in 5 files), header-sort fixes, enum label maps via `t()` (+ `runtime.native` key ×4), neutral-vocabulary sweep (Q5), run-id search + Processes search, tasks safety trio (cron validation + next-run preview, IANA timezone picker, per-target permission prefill + features datalist), P2 grab-bag | M |

## Cross-spec rules

- Every spec lists integration coverage for its affected API and UI paths (root `AGENTS.md` requirement) and implements those tests in the same change.
- No schema changes anywhere except spec 3's additive `agent_runs.completed_at` column (pricing ended up config/env-based — no table; both decided in spec 3).
- i18n: every copy change lands in all four locales; the vocabulary sweep (spec 5) owns the claims→neutral terminology table so specs 1–4 don't half-migrate it.
- The audit's "genuinely good" list is a do-not-churn contract: DS tokens, coalesced SSE pattern, honest-degradation patterns, ProposalCard reuse.

## Changelog

- **2026-07-12**: Umbrella created; Q1–Q8 resolved at the gate; five specs commissioned.
- **2026-07-12**: Post-review fixes applied per fresh-context architectural review: H-1/H-2 ownership resolved (real tool calls → spec 2; traces-list server pagination → spec 3), M-1..M-8 double-claims settled, L-1..L-6 (sequenced-not-independent wording, per-1M pricing units, `'en-US'` count corrected).
