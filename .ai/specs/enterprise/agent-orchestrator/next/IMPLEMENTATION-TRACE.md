# Agent Orchestrator `next/` — Implementation Trace

> **Generated:** 2026-06-24 · **Re-audited:** 2026-07-12 · **Branch:** `feat/agent-orchestrator-mvp` · **Method:** code-grounded audit of
> `packages/enterprise/src/modules/agent_orchestrator/` (entities, `di.ts`, `lib/`, `api/`, `backend/`, `events.ts`,
> migrations, workers) cross-checked against each `next/` spec's signature entities/services/APIs, plus the
> module git history (Guardrails P1–P4, Context P1–P4, Identity P1–P4, performance hardening, F1 offload).

## Status legend

- ✅ **Implemented** — the spec's core entities/services/APIs/UI exist in the working tree.
- 🟡 **Partial** — substantial pieces exist; meaningful scope still missing or built differently than specced.
- ⬜ **Not started** — no signature artifact found in code.

## Trace matrix

| # | Spec | Status | Primary evidence (or absence) |
|---|------|--------|-------------------------------|
| 1 | `2026-06-19-agent-trace-eval-capture.md` | ✅ Implemented | `AgentSpan`/`AgentToolCall`/`AgentRunSession` entities; `lib/trace/{ingestAuth,traceIngestionService,correctionService,artifactStore}.ts`; `api/trace/ingest`, `api/runs/[id]`, `api/runs/[id]/artifact`; `backend/traces/{page,[id]/page}.tsx`; events `run.ingested`/`run.evaluated` |
| 2 | `2026-06-20-agent-eval-harness-and-metrics.md` | ✅ Implemented | `AgentEvalCase`/`AgentEvalAssertion`/`AgentEvalResult`/`AgentCorrection`/`AgentMetricRollup` entities; `lib/eval/`, `lib/metrics/`; `workers/{llm-judge,metric-rollup}.ts`; `api/{corrections,eval-cases/*,eval-assertions,agents/[id]/metrics,metrics/overview}`; `backend/eval-assertions` page |
| 3 | `2026-06-19-agent-operations-ui.md` | 🟡 Partial | Cockpit exists as **standalone `backend/` pages** (`overview`, `caseload`, `traces`, `agents`, `playground`, `processes`, `audit`, `eval-assertions`), **not** the specced widget-injection overlays into `workflows` My-Tasks. Since the last audit: Overview KPIs are **rollup-backed** (`/metrics/overview`, live fallback), Caseload is server-paginated with real run enrichment, and the decision panel shows **real guardrail verdicts** (`proposal.guardResults` → `components/ProposalFacts.tsx`). As of 2026-07-12 the **trace inspector is fully real-data** — guardrail-verdicts panel (`GuardrailsCard`), context bundle, proposal-rationale reasoning, and working Add-to-evals / Flag / Re-run header actions (`api/runs/[id]/{eval-case,flag,rerun}`) — except the **model-comparison card** (still Sample; needs #9 shadow runs). The Processes pages read **live projection data** (#11). Remaining spec delta: standalone pages vs the specced widget-injection model. |
| 4 | `2026-06-24-trace-eval-pr4b-and-followups.md` | 🟡 Nearly complete | F1/F2/F4/F5/F6/F7/F8/F9/F10 ✅ (F8 + F10 closed 2026-07-12), F3 ⬜ (rides with the native-runtime rollout) — see the F-table below. |
| 5 | `2026-06-19-agent-runtime-guardrails.md` | ✅ Implemented (P1–P4) | `AgentGuardrailCheck`/`AgentGuardrailSet` entities; `lib/guardrails/{guardrailService,promptInjection,grounding,groundingSets,syncGroundingSets}.ts`; `api/guardrail-checks`; event `guardrail.tripped`. P3 injection isolation + P4 grounding cite-or-abstain landed after Context `retrieve()` (Waves 1+3 complete). |
| 6 | `2026-06-19-agent-context-knowledge-plane.md` | ✅ Implemented (P1–P4) | `AgentContextBundle` entity; `lib/context/{registry,contextResolver,retrievalSource,documentIngest,documentOcrProvider,documentSource,packer,redactor}.ts`; `api/context-bundles`. TDCR registry + retrieval + doc-ingest/OCR + redaction/token-budget packer (Wave 2 complete). |
| 7 | `2026-06-19-agent-identity-and-on-behalf-of.md` | ✅ Implemented (P1–P4) | `AgentPrincipal`/`AgentDelegationGrant` entities; `lib/identity/{agentPrincipalService,agentTokenService,agentDelegationGrantService,agentAuthMdService,agentNoBypassSubscriber,agentWriteScope}.ts`; `api/identity/{token,well-known,…}`; events `agent_principal.registered`/`delegation_grant.revoked`; `agentRuntime.run` `ctx.runAs` fail-closed no-bypass (Wave 4 complete). |
| 8 | `2026-06-19-agent-dispatch.md` | ⬜ Not started | No `AgentTask`/`AgentBinding`/`AgentTaskLease`, no `DispatchService`/`TaskRouter`, no internal/pull/A2A adapters in `lib/`. Its identity prerequisite (Wave 4) is now met. |
| 9 | `2026-06-19-agent-deployment-and-regression-gating.md` | ⬜ Not started | No `AgentRelease`/`AgentBudget`, no shadow/canary/autonomy ramp, no `EvalGateRunner`/`promote`. Prereqs eval ✅ + rollups (F2) ✅ are met; canary still wants the Wave-5 `TaskRouter`. |
| 10 | `2026-06-19-agent-decision-transparency-and-ai-act.md` | ⬜ Not started | No `AgentDecisionRecord`/`AgentContestCase`/`AgentFairnessMetric`, no DSAR/erasure/portal `decisions` surfaces. Precursors: `AgentCorrection`, anti-rubber-stamp KPIs, F5 encryption (crypto-shredding base). |
| 11 | `2026-06-25-agent-process-subject-and-caseload-projection.md` | ✅ Implemented (2026-07-12; assignment/SLA fields await the workflows task-assignment signal) | `AgentProcess` entity + migration `…20260711235946` (partial unique `agent_processes_org_process_uq`); `subject` on `invokeAgentConfigSchema` (core, additive) → bridge ctx → `lib/processes/subjectContext.ts` (ALS) → `proposal.created` payload; `processId` added to `proposal.corrected`/`run.ingested`; idempotent recompute-from-source projection (`lib/processes/agentProcessProjection.ts`) + 8 subscribers (`agent-process-*`: 4 agent events + 4 `workflows.instance.*` incl. terminal resolution — Phase B unblocked by #17); `process.updated` clientBroadcast; `rebuild-processes` CLI (`cli.ts`); `api/processes` (scoped list: `needs_decision`/`stuck_24h`/`high_value`/`fraud_flagged`) + `api/processes/[id]` (`findOneWithDecryption`, accepts processId or row id); ACL `processes.view`; Processes list/detail pages rewired to live data (sample builders no longer used). Deferred per the spec changelog: `my_team`/assignment fields (no task-assignment signal yet), workflow-definition stage labels, Pause/Reassign/Take-over proxy verbs, `TC-AGENT-PROCESS-*` integration specs. |
| 12 | `2026-06-26-agent-attachments-and-artifacts.md` | ⬜ Not started (now unblocked) | No `AgentRunArtifact`; no `lib/runtime/{agentWorkspaceManager,artifactCollector,attachmentStager}.ts`; OpenCode frontmatter still hard-denies `write/edit/bash` and inputs are text-only. Its hard prerequisites **F5 (`encryption.ts`) and F1 (`lib/trace/artifactStore.ts`) are both shipped** — pull forward at will. Note the lightweight-runtime spec (#15) plans to decommission OpenCode; reconcile before building the OpenCode sandbox file plane. |
| 13 | `../2026-07-03-agentic-tasks.md` | ✅ Implemented (P1–P4; P5 deferred) | `AgentTaskDefinition`/`AgentTaskRun`/`AgentTaskEventTrigger` entities + migration `…20260711232818`; `api/tasks/**` (CRUD + `[id]/run` + event-trigger sub-resource) + `api/task-runs/**`; `commands/tasks.ts` (`tasks.enqueueRun`); `agent-task-runs` queue + `workers/task-run-executor.ts` (both target types; per-task execution principal via `lib/tasks/executionPrincipal.ts` with `runAs` on-behalf-of); `subscribers/task-run-workflow-{completed,failed,cancelled}.ts` (workflow-target resolution — #17 landed same day) + wildcard `subscribers/task-event-trigger.ts`; cron via `lib/tasks/schedule.ts`; `backend/tasks` list/detail UI; ACL `tasks.*`; events `task.*`/`task_run.*`/`task_event_trigger.*`. **Phase 5 (cross-module launch widget + schema-driven form + bulk ProgressJob) deferred** — see the spec changelog (2026-07-12). |
| 14 | `../2026-07-06-agent-orchestrator-performance-hardening.md` | ✅ Implemented (Phases 0–5) | Per its implementation log: compose `OPENCODE_URL` fix + scaling runbook; core `workflow-invoke-agent` queue + worker; `lib/runtime/admission.ts` (capacity gate, 429/`Retry-After`, run timeout); composite/partial indexes + `list.defaultSort` (`created_at DESC`); rollup-backed `/metrics/overview` + server-paginated Caseload + `useCoalescedReload`; 4 Playwright specs (authored; execution pending env). |
| 15 | `../2026-07-07-lightweight-agent-runtime.md` | 🟡 Partial (P1–P2 ✅ 2026-07-12) | Phases 1–2 shipped: `lib/runtime/{nativeAgentRunner,nativeTraceCapture,providerBudget,errors}.ts` (`agentRuntime.ts` reduced to dispatch); `defineAgent` registers `'native'`; runs stamp `externalRunId = runId` (closes F8); always-on async per-step span capture through `ingestTrace` (partial traces survive failures; `OM_AGENT_TRACE_CAPTURE=off` escape hatch); per-provider concurrency semaphore + full-jitter backoff on 429/529/overloaded (`AgentProviderCapacityError` reuses the structural-retryable seam); additive `ai-assistant` object-mode `loop.onStepFinish` forwarding + `steps` return. **Remaining:** Phase 3+ — file-agent compilation to `native`, OpenCode decommission (BC bridge), `AgentDefinition`/`AgentDefinitionVersion` + org-scoped registry resolver + builder UI. Absorbs F3 next. |
| 16 | `2026-07-10-agent-role-taxonomy-and-decision-pipeline.md` | ⬜ Not started (newly specced) | No `AgentFinding`/`AgentDecision` entities, no `decision` `AgentResult` kind, no closed action catalog, no decision-outcome workflow transitions / `WAIT_FOR_SIGNAL` negotiation bridge. |
| 17 | `2026-06-26-workflows-emit-instance-lifecycle-events.md` | ✅ Implemented (2026-07-12) | `workflow-executor.ts` now emits `workflows.instance.created/started/completed/failed/cancelled` to the bus (`emitInstanceLifecycleEvent` over `emitWorkflowsEvent`, `persistent: true`, best-effort). Unblocked #13's workflow-target subscribers the same day. `paused`/`resumed` + task-assignment signals deferred per the spec's own scope; see its changelog. |

## Summary

- **Shipped:** trace + eval + corrections + metric rollups (1, 2), **guardrails P1–P4** (5), **context knowledge
  plane P1–P4** (6), **identity & on-behalf-of P1–P4** (7), **performance hardening Phases 0–5** (14), and the
  Wave-0 stabilization backlog minus F3 (4). Waves 0–4 of the dependency plan are done.
- **Partial:** operations UI (3) — all cockpit surfaces now read real data (only the trace inspector's
  model-comparison card remains Sample, blocked on #9 shadow runs); remaining delta is architectural
  (standalone pages vs widget-injection).
- **Shipped 2026-07-12 (this working tree):** workflows lifecycle-event emission (17); **Agentic Tasks
  Phases 1–4** (13) — launcher entities/CRUD/run pipeline/worker, both target types, per-task execution
  principals, cron + domain-event triggers, `backend/tasks` UI; its Phase 5 (cross-module launch widget)
  deferred; the **process subject + caseload projection** (11): `AgentProcess` read-model, `subject` on
  the `INVOKE_AGENT` boundary, `processes.view` + list/detail APIs, `rebuild-processes` CLI, Processes
  cockpit pages rewired off sample data (assignment/`my_team` fields still await a workflows task-assignment
  signal); the **native runtime Phases 1–2** (15) — `NativeAgentRunner`, always-on span capture for
  in-process runs, per-provider LLM budgets/backoff, additive `ai-assistant` step forwarding (closes F8);
  and the **trace-inspector real-data completion** — context bundle, guardrail panel (closes F10),
  proposal-rationale reasoning, and live Add-to-evals / Flag / Re-run actions
  (`AgentRun.flaggedAt/flaggedBy/rerunOfRunId`, migration `…20260711225137`).
- **Not started:** dispatch (8), deployment gating (9), AI-Act compliance (10), agent file plane (12),
  role taxonomy / decision pipeline (16), the native runtime's remaining Phases 3+ (OpenCode decommission,
  `AgentDefinition` + builder UI), and F3 partitioning.

## Deferred follow-ups on the shipped work (from spec 4, F1–F10)

> **Status re-audited 2026-07-12** against code on `feat/agent-orchestrator-mvp`.

| ID | Item | Effort · priority | Status |
|----|------|-------------------|--------|
| F1 | Encrypted S3 artifact offload (artifact-key columns exist, unpopulated) | M · medium | ✅ **Done (2026-07-09)** — `lib/trace/artifactStore.ts` (encrypt via reused F5 maps → `storage-s3` upload, fail-open degrade); wired into `ingestTrace` (run output + tool request/response) via injected offloader; read path `GET /runs/:id/artifact` (key-belongs-to-run validated, server-side decrypt) + inspector "load full payload" wiring; unit-tested |
| F2 | `AgentMetricRollup` + scheduler + persisted anti-rubber-stamp signals | M · medium | ✅ **Shipped** — `AgentMetricRollup` entity + `lib/metrics/` + `workers/metric-rollup.ts`; Overview reads rollup-preferred with live fallback |
| F3 | Span/tool-call partitioning + tiered retention + archival worker | L · low (risk-high) | ⬜ **Open** — no `PARTITION` in any migration; re-prioritized alongside the native-runtime rollout (#15) |
| F4 | `/runs` ACL gate rollout safety (`agents.view`→`trace.view` needs `auth sync-role-acls`) | S · **high** | ✅ **Done** — route gates `trace.view`, `setup.ts` grants it, `runs-acl-rollout.test.ts` encodes the invariant; deploy note in the scaling runbook + RELEASE_NOTES (2026-07-09) |
| F5 | Module `encryption.ts` + route reads via decryption helpers | S · medium | ✅ **Shipped** — `encryption.ts` declares `AgentRun.input/output`, `AgentProposal.payload`, `AgentEvalCase.input/expected` |
| F6 | Dispose→correction hook test | S · medium | ✅ **Done** — `__tests__/dispose-correction-hook.test.ts` (4 tests, passing) |
| F7 | i18n flatten + de/es/pl locales | M · low | ✅ **Present** — `i18n/{en,es,de,pl}.json`; `i18n:check-sync` clean as of the perf-hardening gate |
| F8 | Runner stamps `runtime` + `externalRunId` for cross-correlation | S · low | ✅ **Done (2026-07-12)** — closed by #15 Phase 1 as planned: `NativeAgentRunner` creates runs with `stampExternalRunIdFromId` (uuid pre-generated, `externalRunId = id` in one insert); OpenCode already stamped both |
| F9 | `llm_judge` assertion management (CRUD or seed) | M · low | ✅ **Shipped** — `api/eval-assertions` route + `backend/eval-assertions` page |
| F10 | Cockpit guard-results panel | M · low | ✅ **Done (2026-07-12)** — caseload decision panel renders real verdicts (`proposal.guardResults` → `ProposalFacts`); trace inspector gained `GuardrailsCard` (all checks, `pass/warn/block` badges, redacted evidence + pinned set version) fed by `guardrailChecks` on `GET /runs/:id` |

## Implementation Plan

A dependency-ordered roadmap. Each **Wave** is independently shippable; phases inside a wave are the owning
spec's own phase numbers. Effort: S ≤ 2d, M ≈ 3–6d, L ≈ 1–2wk (one engineer).
**Waves 0–4 are complete** (0 minus F3); they are kept below, collapsed, as the as-built record.

### Dependency graph (what must precede what)

```
Wave 0  Stabilize shipped trace/eval (F1–F10)                   ✅ done (F3 deferred to the native-runtime rollout)
Wave 1  Guardrails P1–P2 (schema/tool-scope, moderation/PII)    ✅ done
Wave 2  Context & Knowledge Plane P1–P4                         ✅ done
Wave 3  Guardrails P3–P4 (injection isolation, grounding)       ✅ done
Wave 4  Identity & On-Behalf-Of P1–P4                           ✅ done
            ▼
Wave 5  Dispatch + A2A P1–P7 (internal+pull critical path 1→2→3→4, then A2A 5→6→7)
            ▼
Wave 6  Deployment & Regression Gating P1–P4 (needs eval ✅ + Dispatch router for canary)
            ▼
Wave 7  Compliance / AI-Act P1–P4 (mostly independent; pull earlier if a person-affecting agent ships)

Independent overlays (not on the chain, pull forward by workload):
  · #15 Lightweight `native` runtime + UI-authored agents        🟡 P1–P2 done (2026-07-12); P3+ remain (OpenCode decommission absorbs F3)
  · #13 Agentic Tasks                                            ✅ P1–P4 done (2026-07-12); P5 cross-module launch deferred
  · #12 Agent file plane (F1+F5 met; reconcile with #15's OpenCode decommission first)
  · #11 Process subject + caseload projection                    ✅ done (2026-07-12)
  · #16 Role taxonomy & decision pipeline (4 phases; Phase 4 inbound emit-scope fix is core/webhooks Ask First)
  · #17 Workflows instance lifecycle events                      ✅ done (2026-07-12)

Cross-cutting: Operations-UI completion — model-comparison card (needs #9 shadow runs),
optional widget-injection migration.
```

### Waves 0–4 — complete (as-built record)

- **Wave 0** (`2026-06-24-trace-eval-pr4b-and-followups.md`): F4 → F5 → F8(partial) → F6 → F7 → F2 → F1 → F9 all
  landed; **F3 (partitioning/retention) deliberately deferred** to ride with the native-runtime rollout.
- **Wave 1+3 — Guardrails P1–P4** (`2026-06-19-agent-runtime-guardrails.md`): output-schema/tool-scope,
  moderation/PII, prompt-injection isolation, grounding cite-or-abstain (`lib/guardrails/`, `AgentGuardrailCheck`,
  `guardrail.tripped`).
- **Wave 2 — Context P1–P4** (`2026-06-19-agent-context-knowledge-plane.md`): TDCR registry/resolver, retrieval
  source, document ingest/OCR, redaction + token-budget packer (`lib/context/`, `AgentContextBundle`).
- **Wave 4 — Identity P1–P4** (`2026-06-19-agent-identity-and-on-behalf-of.md`): `AgentPrincipal` provisioning,
  on-behalf-of audit + `runAs`, OAuth `/token` + delegation grants + three-layer no-bypass, ID-JAG self-registration
  (`lib/identity/`, `api/identity/`).
- Plus (unplanned in the original waves): **performance hardening Phases 0–5** (#14) — invoke-agent queue split,
  admission control + run timeout, indexes + default ordering, rollup-backed cockpit reads, integration specs.

---

### Wave 5 — Dispatch + A2A (P1–P7)  *(identity prerequisite met)*

> Source: `2026-06-19-agent-dispatch.md`. New: `AgentTask`/`AgentTaskEvent`/`AgentBinding`/`AgentTaskLease`, `DispatchService`, `TaskRouter`. **Critical path 1→2→3→4.**

- **§Phase 1** (M): `AgentTask` + `AgentTaskEvent` + state machine + `DispatchService.enqueue` (idempotency, payload-by-reference, events).
- **§Phase 2** (M): `AgentBinding` registry + `TaskRouter` (capability match, concurrency, priority, health). *Consumed by Wave 6 canary.*
- **§Phase 3** (M): **internal** adapter + result → trace ingestion (OM-hosted, end-to-end).
- **§Phase 4** (L): **pull** adapter (`claim`/`heartbeat`/`result`/`input` + `AgentTaskLease` + `packages/scheduler` sweeper + agent-principal creds).
- **§Phase 5–6** (L): **A2A client** (Agent Card resolution, delegation, artifacts, webhook callbacks) then **A2A server** (OM Agent Card, inbound → `AgentTask`).
- **§Phase 7** (M): HITL bridge (`input_required` ↔ `USER_TASK`), dead-letter → caseload, fairness, binding health, `/metrics`.

**Exit:** tasks route to internal/pull/A2A runtimes under one contract; results flow back into trace + caseload.

---

### Wave 6 — Deployment & Regression Gating (P1–P4)  *(needs eval ✅ + Wave 5 router)*

> Source: `2026-06-19-agent-deployment-and-regression-gating.md`. New: `AgentRelease`/`AgentBudget` entities, `EvalGateRunner`, `promote` endpoint.

- **§Phase 1** (M): `AgentRelease` + CRUD + **shadow mode** (propose-only candidate run) wired to the trace model-comparison view (trace ✅).
- **§Phase 2** (M): **canary** via `feature_toggles` gating the dispatch `TaskRouter`; gradual-autonomy ramp worker from override-rate metrics (uses F2 rollups ✅).
- **§Phase 3** (M): `AgentBudget` + enforcement via `ai_assistant` `loop.budget`; `budget.exceeded` event + notifications; model routing via `AiModelFactory`. *(Overlaps #15's per-provider LLM budgets — reconcile.)*
- **§Phase 4** (M): eval harness gate + `EvalGateRunner`; regression-gated `promote` endpoint + CI step over the eval-case export.

**Exit:** new agent versions ship shadow → canary → ramp, gated by eval regressions and budget.

---

### Wave 7 — Compliance / AI-Act / DSAR / Fairness (P1–P4)

> Source: `2026-06-19-agent-decision-transparency-and-ai-act.md`. New: `AgentDecisionRecord`/`AgentContestCase`/`AgentFairnessMetric`, portal `decisions` pages. **Pull forward when a person-affecting agent goes live.** Crypto-shredding builds on F5 ✅.

- **§Phase 1** (L): `AgentDecisionRecord` + claimant explanation service + portal `decisions` pages + nav + `decision.recorded` (GDPR Art. 22 / AI Act Art. 86 minimum).
- **§Phase 2** (L): contest/appeal — `AgentContestCase`, `business_rules` ACTION, review workflow with mandatory reviewer, overturn → `AgentCorrection`, optimistic-locked resolve, portal contest endpoint.
- **§Phase 3** (M): GDPR DSAR exporter + audit-preserving erasure command + lawful-basis/consent flags.
- **§Phase 4** (L): bias/fairness rollup worker + fairness API + system-card generator + post-market monitoring dashboards + serious-incident workflow.

**Exit:** affected persons get explanation + contest + erasure; fairness monitored; conformity evidence generated.

---

### Cross-cutting — Operations UI completion (spec 3)

- ~~**Trace-inspector guard panel**~~ — ✅ done 2026-07-12 (F10): `GuardrailsCard` in `backend/traces/[id]/page.tsx`.
- ~~**Real Processes backing**~~ — ✅ done 2026-07-12 (#11): the pages read `api/processes*`; `buildSampleProcessList`/`buildSampleProcess` remain exported but unused.
- **Model-comparison card** — the last Sample-labeled surface; blocked on #9 Phase 1 shadow runs.
- Optional: migrate the standalone cockpit pages to the specced **widget-injection + perspectives** model onto `workflows` My-Tasks/dashboards — only if the standalone pages prove duplicative; otherwise keep as-is and update the spec to match reality.

---

### One-line sequencing summary

Waves 0–4 ✅ (+ overlays #11, #13 P1–P4, #15 P1–P2, #17 ✅ 2026-07-12) → next on the chain is **Dispatch P1–P7** → **Deployment P1–P4** → **Compliance P1–P4**; remaining independent overlays (**native runtime #15 P3+**, **file plane #12**, **role taxonomy #16**) can be pulled forward by workload — #15's OpenCode decommission is the standing maintainer decision for the execution path and should be sequenced before/with anything OpenCode-coupled (including #12).

## Notes

- **Biggest divergence from the specs now:** the execution path. `2026-07-07-lightweight-agent-runtime.md` (#15)
  decommissions OpenCode entirely; #12 (file plane) and any remaining OpenCode-scaling work should be reconciled
  against it before implementation.
- Suggested next pickups by dependency/value: the **workflows task-assignment signal** (small core follow-up
  that turns on #11's `my_team`/assignee/SLA fields), **#15 Phase 3+** (file agents → `native`, OpenCode
  decommission + F3 partitioning, then `AgentDefinition` + builder UI), **#13 Phase 5** (cross-module
  "Run agentic task" launch widget), then **#12 / #16** by workload; **Wave 5 dispatch** when external/pull
  agent fleets become real; **#9 Phase 1 shadow runs** whenever the model-comparison card should go real.
- The Processes cockpit pages read **live projection data** as of 2026-07-12; the old sample builders in
  `components/processTypes.ts` are exported-but-unused.
- Uncommitted on this branch (outside this folder): the **agent web-search tool**
  (`.ai/specs/enterprise/2026-07-11-agent-web-search-tool.md`, `lib/webSearch/`,
  `packages/search-provider-searxng/`) — part of the same effort, not a `next/` overlay.
- Historical audit details from the 2026-06-24 generation (per-row evidence for specs 1–13 as they were then)
  are preserved in git history of this file.
