# Agent Orchestrator `next/` — Implementation Trace

> **Generated:** 2026-06-24 · **Branch:** `feat/agent-orchestrator-mvp` · **Method:** code-grounded audit of
> `packages/enterprise/src/modules/agent_orchestrator/` (entities, `di.ts`, `lib/`, `api/`, `backend/`, `events.ts`,
> migrations) cross-checked against each `next/` spec's signature entities/services/APIs.
> **Authoritative source for "what shipped":** `2026-06-24-trace-eval-pr4b-and-followups.md` §1 (PR #3532).

## Status legend

- ✅ **Implemented** — the spec's core entities/services/APIs/UI exist in the working tree.
- 🟡 **Partial** — substantial pieces exist; meaningful scope still missing or built differently than specced.
- ⬜ **Not started** — no signature artifact found in code.

## Trace matrix

| # | Spec | Status | Primary evidence (or absence) |
|---|------|--------|-------------------------------|
| 1 | `2026-06-19-agent-trace-eval-capture.md` | ✅ Implemented | `AgentSpan`/`AgentToolCall`/`AgentRunSession` entities; `lib/trace/{ingestAuth,traceIngestionService,correctionService}.ts`; `api/trace/ingest`, `api/runs/[id]`; `backend/traces/{page,[id]/page}.tsx`; events `run.ingested`/`run.evaluated`; migration `…20260623072052` |
| 2 | `2026-06-20-agent-eval-harness-and-metrics.md` | ✅ Implemented | `AgentEvalCase`/`AgentEvalAssertion`/`AgentEvalResult`/`AgentCorrection` entities; `lib/eval/{scorers,evalRuntimeService,llmJudge,sampling,defaultAssertions}.ts`; `workers/llm-judge.ts`; `api/{corrections,eval-cases/[id]/approve,eval-cases/export,agents/[id]/metrics}`; events `proposal.corrected`/`eval_case.created`/`eval_case.approved`; migrations `…20260623153336`,`…20260623155649` |
| 3 | `2026-06-19-agent-operations-ui.md` | 🟡 Partial | Operator caseload + engineer trace inspector + admin KPI tiles exist as **standalone `backend/` pages** (`overview`, `caseload`, `traces`, `agents`, `playground`), **not** as widget-injection overlays into `workflows` My-Tasks/dashboards/perspectives as specced. Guard-results panel missing (blocked on guardrails). Admin KPIs computed live (no rollups). |
| 4 | `2026-06-24-trace-eval-pr4b-and-followups.md` | ⬜ Not started | This is the **deferred-work backlog** for #3532 (F1–F10). None of F1–F10 implemented: no `agent_metric_rollups` (F2), no S3 artifact offload (F1 — `outputArtifactKey`/`request|responseArtifactKey` columns exist but unpopulated), no partitioning (F3), no `encryption.ts` (F5), etc. |
| 5 | `2026-06-19-agent-runtime-guardrails.md` | ⬜ Not started | No `AgentGuardrailCheck` entity, no `lib/guardrails`, no pre/post-call injection/PII/grounding gate. (F10 confirms the overlay is unbuilt.) |
| 6 | `2026-06-19-agent-context-knowledge-plane.md` | ⬜ Not started | No `agent_context_bundles` table, no `lib/context`, no TDCR resolver, no attachment/OCR ingest. Agent input remains plain JSON. |
| 7 | `2026-06-19-agent-identity-and-on-behalf-of.md` | ⬜ Not started | No `AgentIdentity`/on-behalf-of principal model. **Note:** `agent_run_sessions` (`AgentRunSession`) is the OpenCode per-run session-token correlation store in `openCodeAgentRunner.ts` — unrelated to this spec. |
| 8 | `2026-06-19-agent-dispatch.md` | ⬜ Not started | No dispatch service, adapters, or A2A routing in `lib/`. |
| 9 | `2026-06-19-agent-deployment-and-regression-gating.md` | ⬜ Not started | No shadow/canary/autonomy-ramp or eval-gated promotion. ("shadow" hits in code are incidental — seed copy + a sandbox comment.) Depends on #2 (now available). |
| 10 | `2026-06-19-agent-decision-transparency-and-ai-act.md` | ⬜ Not started | No DSAR/erasure/explanation/contestability surfaces. Precursors only: `AgentCorrection` (audit trail) + anti-rubber-stamp KPI tiles on `backend/overview`. |
| 11 | `2026-06-25-agent-process-subject-and-caseload-projection.md` | ⬜ Not started | No `agent_processes` projection entity, no `subject` reference on the `INVOKE_AGENT` boundary, no claim-anchored Processes list/detail backing. The cockpit's caseload (#3) keys off single proposals/runs, not a per-process indexed row. |
| 12 | `2026-06-26-agent-attachments-and-artifacts.md` | ⬜ Not started | No `AgentRunArtifact` entity; no `lib/runtime/{agentWorkspaceManager,artifactCollector,attachmentStager}.ts`; OpenCode frontmatter still hard-denies `write/edit/bash` (`defineFileAgent.ts:257-261`) and inputs are text-only (`openCodeAgentRunner.ts:229-232`). Reuses Wave 0 **F1** (S3 artifact offload) + **F5** (`encryption.ts`). Distinct from #6's context-fact ingest: this is the OpenCode **sandbox file plane** (raw file staging + artifact authoring), not read-only context assembly. |
| 13 | `../2026-07-03-agentic-tasks.md` | ⬜ Not started (newly specced) | No `AgentTaskDefinition`/`AgentTaskRun`/`AgentTaskEventTrigger` entities, no `agent-task-runs` queue/worker, no `backend/tasks` UI. **Prereqs largely met on this branch:** the identity overlay it reuses (`provisionAgentPrincipal` + `agentRuntime.run` `ctx.runAs` with fail-closed no-bypass) is **shipped** here (contra this matrix's stale #7 ⬜ — see note below); the `@open-mercato/scheduler` seam it reuses is already wired in `setup.ts`. **The one hard gap:** the workflow-target completion subscriber depends on `workflows.instance.completed/failed` being **emitted to the bus**, which they are **not** today (`workflow-executor.ts` sets `completedAt` but never calls `.emit(`) → blocked on prerequisite [`2026-06-26-workflows-emit-instance-lifecycle-events.md`]. |

## Summary

- **Shipped (PR #3532):** the **trace · eval · correction loop** (specs 1 + 2) plus the **operator/engineer cockpit
  surfaces** (spec 3, as standalone pages). This is the bulk of `next/`'s observability layer.
- **Not started:** guardrails (5), context/knowledge plane (6), identity (7), dispatch (8), deployment gating (9),
  AI-Act compliance (10), process-subject projection (11), the agent file plane (12), and the PR-4b infra
  backlog (4 / F1–F10).

## Deferred follow-ups on the shipped work (from spec 4, F1–F10)

> **Status re-audited 2026-07-09** against code on `feat/agent-orchestrator-mvp`. Most of this table
> was stale — only **F1** and **F3** remain genuine code gaps; **F8** is partial and folds into the
> lightweight-runtime spec. The `Status` column reflects the re-audit; the original effort/priority is kept.

| ID | Item | Effort · priority | Status (2026-07-09) |
|----|------|-------------------|---------------------|
| F1 | Encrypted S3 artifact offload (artifact-key columns exist, unpopulated) | M · medium | ⬜ **Open** — no `lib/trace/artifactStore.ts`, no `storage-s3` wiring |
| F2 | `AgentMetricRollup` + scheduler + persisted anti-rubber-stamp signals | M · medium | ✅ **Shipped** — `AgentMetricRollup` entity + `lib/metrics/` |
| F3 | Span/tool-call partitioning + tiered retention + archival worker | L · low (risk-high) | ⬜ **Open** — no `PARTITION` in any migration; re-prioritized alongside the native-runtime rollout |
| F4 | `/runs` ACL gate rollout safety (`agents.view`→`trace.view` needs `auth sync-role-acls`) | S · **high** | ✅ **Done** — route gates `trace.view`, `setup.ts` grants it, `runs-acl-rollout.test.ts` encodes the invariant; deploy note added to the scaling runbook (§ ACL sync) + RELEASE_NOTES (2026-07-09) |
| F5 | Module `encryption.ts` + route reads via decryption helpers | S · medium | ✅ **Shipped** — `encryption.ts` declares `AgentRun.input/output`, `AgentProposal.payload`, `AgentEvalCase.input/expected` |
| F6 | Dispose→correction hook test | S · medium | ✅ **Done** — `__tests__/dispose-correction-hook.test.ts` covers edit/reject → correction+draft eval case, approve/auto_approve → none (4 tests, passing) |
| F7 | i18n flatten + de/es/pl locales (pre-existing; partially advanced this session for new trace keys) | M · low | ✅ **Present** — `i18n/{en,es,de,pl}.json` all exist (run `i18n:check-sync` to confirm parity) |
| F8 | Runner stamps `runtime` + `externalRunId` for cross-correlation | S · low | 🟡 **Partial** — OpenCode stamps both; in-process leaves `externalRunId` null by design. Subsumed by the native-runtime spec's Phase 1 (`createRun` stamps `externalRunId=runId`) — do it there |
| F9 | `llm_judge` assertion management (CRUD or seed) | M · low | ✅ **Shipped** — `api/eval-assertions` route + `backend/eval-assertions` page |
| F10 | Cockpit guard-results panel (**blocked** on guardrails overlay #5) | M · low | ⬜ **Open** — guardrails P1 shipped (`lib/guardrails/`); the cockpit panel itself is still unbuilt |

## Implementation Plan

A dependency-ordered roadmap to take the remaining `next/` scope from the current branch to a complete agent
platform. Each **Wave** is independently shippable; phases inside a wave are the owning spec's own phase numbers
(cited as *spec §Phase N*). Effort: S ≤ 2d, M ≈ 3–6d, L ≈ 1–2wk (one engineer).

### Dependency graph (what must precede what)

```
Wave 0  Stabilize shipped trace/eval (F4,F5,F6,F8,F7 → F2,F1,F9,F3)
            │  (F5 encryption.ts unblocks F1 + Compliance crypto)
            ▼
Wave 1  Guardrails P1–P2 (schema/tool-scope, moderation/PII)  ──► unblocks Ops-UI guard panel (F10)
            ▼
Wave 2  Context & Knowledge Plane P1–P4 (TDCR, retrieval, doc-ingest, redaction)  ──► "agents read attachments"
            ▼
Wave 3  Guardrails P3–P4 (injection isolation, grounding)      ◄── needs Context retrieval()
            ▼
Wave 4  Identity & On-Behalf-Of P1–P4                          ──► prerequisite for Dispatch pull/A2A
            ▼
Wave 5  Dispatch + A2A P1–P7 (internal+pull critical path 1→2→3→4, then A2A 5→6→7)
            ▼
Wave 6  Deployment & Regression Gating P1–P4 (needs eval ✅ + Dispatch router for canary)
            ▼
Wave 7  Compliance / AI-Act P1–P4 (mostly independent; pull earlier if a person-affecting agent ships)

Cross-cutting: Operations-UI completion threads through Waves 1–6 (guard panel after W1, KPI rollups after F2).
```

> **Rationale for the order:** safety and correctness on already-shipped surfaces first (Wave 0), then the
> blocking pre/post-call guardrails (Wave 1) since they gate every agent run, then the context substrate (Wave 2)
> that both improves answer quality *and* is required by the grounding/injection guardrails (Wave 3). Identity
> (Wave 4) is the principal model that Dispatch's pull/A2A adapters (Wave 5) require. Deployment gating (Wave 6)
> needs the eval harness (done) plus Dispatch's router for canary. Compliance (Wave 7) is regulatory-driven and can
> be pulled forward the moment a person-affecting agent goes live.

---

### Wave 0 — Stabilize the shipped trace/eval before new overlays

> Source: `2026-06-24-trace-eval-pr4b-and-followups.md` (F1–F10). Finish the branch for QA/production first.

| Step | Item | Effort | Notes / exit criteria |
|------|------|--------|------------------------|
| 0.1 | **F4** `/runs` ACL rollout safety | S · **high** | Deploy runbook runs `yarn mercato auth sync-role-acls`; existing-tenant operators retain run-list access. **Do first — it's a live 403 risk.** |
| 0.2 | **F5** module `encryption.ts` + decryption reads | S | `defaultEncryptionMaps` for `AgentRun.input/output`, `AgentProposal.payload`, `AgentEvalCase.input/expected`, `AgentToolCall.*Summary`; route reads through `findWithDecryption`. **Prereq for F1 + Compliance.** |
| 0.3 | **F8** runner stamps `runtime`+`externalRunId` | S | Runner-created runs become re-correlatable by a later trace POST. |
| 0.4 | **F6** dispose→correction hook test | S | `__integration__/TC-AGENT-TRACE-004.spec.ts`: edited/rejected verdict writes `AgentCorrection`+draft `AgentEvalCase`; approved does not. |
| 0.5 | **F7** i18n flatten + de/es/pl | M | `yarn i18n:check-sync` passes for the module. (Partially advanced this session for new trace keys.) |
| 0.6 | **F2** `AgentMetricRollup` + scheduler + worker | M | Append-only rollups on an interval; metrics endpoint + Overview tiles prefer rollups with live fallback. Unblocks Wave 6 autonomy ramp. |
| 0.7 | **F1** encrypted S3 artifact offload | M | `lib/trace/artifactStore.ts`; large payloads → `storage-s3` (key on row, redacted summary inline), degrades inline when storage absent. Needs F5. |
| 0.8 | **F9** `llm_judge` assertion management | M | CRUD route (`makeCrudRoute`, gate `eval.manage`) + page, or seed examples, so the dormant judge worker has assertions. |
| 0.9 | **F3** span/tool-call partitioning + tiered retention | L · risk-high | Hand-authored monthly range partitioning + archival worker (drop+recreate the brand-new tables). Confirm no env has live span data. Do last. |

**Exit:** branch is QA-ready, PII reads encrypted, metrics stable on rollups, audit tiers retained.

---

### Wave 1 — Runtime Guardrails (P1–P2)

> Source: `2026-06-19-agent-runtime-guardrails.md`. New: `AgentGuardrailCheck` entity, `guardrail.tripped` event, `lib/guardrails/`, ACL `guardrails.*`.

- **§Phase 1 — Output-schema + tool-scope** (M): validate every result against the per-capability Zod contract; reuse `ai_assistant` allowlist/mutation-policy. Ship `AgentGuardrailCheck`, `guardrail.tripped`, the no-bypass tie-in. *Highest value/cost ratio — do first.*
- **§Phase 2 — Input moderation + outbound PII** (M): pre-call moderation behind a provider-agnostic DI seam (default OpenAI moderations) + `endUserIdentifier` HMAC; PII detection/redaction on outbound payloads/summaries via `TenantDataEncryptionService`. Persist verdicts as `AgentGuardrailCheck(kind='moderation')`.

**Unblocks:** Ops-UI **F10** guard-results panel (add a guard section to `components/ProposalCard.tsx` + trace inspector once `AgentGuardrailCheck` exists).
**Exit:** schema/tool-scope + moderation/PII gates block or warn on every run; verdicts queryable and surfaced in the cockpit.

---

### Wave 2 — Context & Knowledge Plane (P1–P4)

> Source: `2026-06-19-agent-context-knowledge-plane.md`. New: `AgentContextBundle` entity, `lib/context/`, `agentContextResolver` DI, additive read-only CRUD for the trace "context assembled" panel. **This is the "agents read attachments" capability.**

- **§Phase 1 — `ContextModule` registry + structured TDCR** (M): code-first typed registry, per-capability allowlist + mandatory floor; assemble over `entities`/custom fields via `queryEngine`/`query_index`; persist `AgentContextBundle`; wire into `INVOKE_AGENT`.
- **§Phase 2 — Retrieval source** (M): wrap `searchService` (RRF) + `query_index`; citable snippets; expose `retrieve()` (consumed by Wave 3 grounding).
- **§Phase 3 — Document ingest / extraction** (L): elevate the existing OpenAI vision-OCR path into a typed swappable-provider OCR/classification/field-extraction pipeline; facts carry provenance. *Delivers attachment reading.*
- **§Phase 4 — Redaction + token budget** (M): `findWithDecryption`/`TenantDataEncryptionService` + PII redaction (least-privilege); packer enforces budget (mandatory floor first, routed vs pruned).

**Exit:** one append-only `AgentContextBundle` per run; trace "context assembled" panel renders routed/pruned/tokens; every snippet citable; document facts carry lineage; no cross-tenant assembly.

---

### Wave 3 — Guardrails (P3–P4)  *(needs Wave 2 `retrieve()`)*

- **§Phase 3 — Prompt-injection / untrusted-content isolation** (M) for attachment-derived context (Wave 2 doc-ingest).
- **§Phase 4 — Grounding (cite-or-abstain)** (M) for factual capabilities; versioned sets per capability (YAML→DB sync); rejects ungrounded factual proposals using Context `retrieve()`.

**Exit:** injected document content can never act as instructions; factual proposals without a cited source are blocked/abstained.

---

### Wave 4 — Identity & On-Behalf-Of (P1–P4)

> Source: `2026-06-19-agent-identity-and-on-behalf-of.md`. Touches `auth`, `audit_logs`, `api_keys`. **Prerequisite for Dispatch pull/A2A.**

- **§Phase 1** (M): `User.kind` + `AgentPrincipal` provisioning (agent `User` + scoped `Role`) — internal agents fully attributed.
- **§Phase 2** (M): `ActionLog.onBehalfOfUserId` + `'agent'` source + `runAs` propagation through `INVOKE_AGENT`/dispatch/trace + audit UI chain ("Agent X on behalf of Y").
- **§Phase 3** (L): external-agent OAuth client-credentials `/token` server + `AgentDelegationGrant` + three-layer no-bypass enforcement (flush-time write-interceptor + structural propose-only + release-gate test).
- **§Phase 4** (M): ID-JAG self-registration (`/.well-known` + `/agent/auth`) for external onboarding (additive).

**Exit:** every agent action attributed to a principal (and the human it acts for); external agents get scoped, audited, revocable credentials.

---

### Wave 5 — Dispatch + A2A (P1–P7)  *(needs Wave 4 for pull/A2A)*

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
- **§Phase 2** (M): **canary** via `feature_toggles` gating the dispatch `TaskRouter`; gradual-autonomy ramp worker from override-rate metrics (uses F2 rollups).
- **§Phase 3** (M): `AgentBudget` + enforcement via `ai_assistant` `loop.budget`; `budget.exceeded` event + notifications; model routing via `AiModelFactory`.
- **§Phase 4** (M): eval harness gate + `EvalGateRunner`; regression-gated `promote` endpoint + CI step over the eval-case export.

**Exit:** new agent versions ship shadow → canary → ramp, gated by eval regressions and budget.

---

### Wave 7 — Compliance / AI-Act / DSAR / Fairness (P1–P4)

> Source: `2026-06-19-agent-decision-transparency-and-ai-act.md`. New: `AgentDecisionRecord`/`AgentContestCase`/`AgentFairnessMetric`, portal `decisions` pages. **Pull forward when a person-affecting agent goes live.** Crypto-shredding (gap-12) builds on Wave 0 **F5**.

- **§Phase 1** (L): `AgentDecisionRecord` + claimant explanation service + portal `decisions` pages + nav + `decision.recorded` (GDPR Art. 22 / AI Act Art. 86 minimum).
- **§Phase 2** (L): contest/appeal — `AgentContestCase`, `business_rules` ACTION, review workflow with mandatory reviewer, overturn → `AgentCorrection`, optimistic-locked resolve, portal contest endpoint.
- **§Phase 3** (M): GDPR DSAR exporter + audit-preserving erasure command + lawful-basis/consent flags.
- **§Phase 4** (L): bias/fairness rollup worker + fairness API + system-card generator + post-market monitoring dashboards + serious-incident workflow.

**Exit:** affected persons get explanation + contest + erasure; fairness monitored; conformity evidence generated.

---

### Cross-cutting — Operations UI completion (spec 3)

Thread these into the waves above rather than as a standalone wave:

- After **Wave 1**: add the **guard-results panel** (F10) to `ProposalCard` + trace inspector.
- After **Wave 0 F2**: repoint Admin KPI tiles to **persisted rollups** (stable windows, no 5000-row cap).
- Optional: migrate the standalone cockpit pages to the specced **widget-injection + perspectives** model onto `workflows` My-Tasks/dashboards — only if the standalone pages prove duplicative; otherwise keep as-is and update the spec to match reality.

---

### One-line sequencing summary

**Wave 0 (F4→F5→F8→F6→F7→F2→F1→F9→F3)** → **Guardrails P1–2** → **Context P1–4** → **Guardrails P3–4** → **Identity P1–4** → **Dispatch P1–7** → **Deployment P1–4** → **Compliance P1–4**, with Ops-UI guard panel + rollup tie-in folded in after Guardrails P1 and F2 respectively.

## Notes

- The `README.md` suggested implementation order (1 = guardrails) does **not** match reality: the **trace + eval**
  overlay (README #2) shipped first; guardrails (README #1) is unbuilt.
- Suggested next pickups by dependency/value: **F4** (operational, high — existing-tenant 403 risk), then **F5**
  (PII reads), then the **guardrails overlay (#5)** which unblocks F10 and the disposition-card guard panel.
- Recent same-branch hardening (not a spec): `proposal.created`/`proposal.disposed` now `clientBroadcast` →
  live caseload/overview refresh; trace detail now renders tool request/response, tool/run errors, and eval evidence.
- **Branch drift on this matrix (2026-06-24 vs. current):** this trace was generated on `feat/agent-orchestrator-mvp`. On the current working branch the **identity overlay (#7) has since shipped** — `lib/identity/{agentPrincipalService,agentTokenService,agentDelegationGrantService,agentAuthMdService,agentNoBypassSubscriber,agentWriteScope}.ts`, the `AgentPrincipal`/`AgentDelegationGrant` entities, `api/identity/*`, and `agentRuntime.run`'s `ctx.runAs` fail-closed enforcement all exist. Re-audit #7 (and any other row) against the current tree before trusting a ⬜ here.
- **Spec 13 (Agentic Tasks) sequencing:** an **independent user-facing launcher overlay** — like spec 12, it is **not** gated behind the guardrails→context→dispatch dependency chain. It adds no new execution engine; every run is still `agentRuntime.run()` (agent target) or `workflowExecutor.startWorkflow()` (workflow target). Two-part sequencing: (1) the **agent-target path is unblocked today** — the identity overlay it needs for its per-task execution principal is shipped on this branch (see the branch-drift note above), and `@open-mercato/scheduler` is already wired in `setup.ts`; (2) the **workflow-target completion path is blocked on prerequisite [`2026-06-26-workflows-emit-instance-lifecycle-events.md`]** — `workflows.instance.completed/failed` are declared but never emitted to the bus, so the `AgentTaskRun` for a workflow target could never leave `'running'` until that core-module prerequisite lands. Deliberately named `AgentTaskDefinition`/`AgentTaskRun` (tables `agent_task_definitions`/`agent_task_runs`) to avoid a collision with Dispatch's (#8) `AgentTask`/`agent_tasks`, which is a different concept (external-fleet routing). Pull it forward whenever a self-service "launch this agent/workflow" surface (or an API/scheduled/event trigger for one) is the next workload; ship the agent-target phases first, land the workflows-lifecycle prerequisite before the workflow-target phases.
- **Spec 12 (agent file plane) sequencing:** an independent overlay that builds directly on the shipped OpenCode
  runtime; it is **not** gated behind the dependency waves. Its only hard prerequisites are Wave 0 **F5**
  (`encryption.ts`, for the `caption` column + encrypted artifact bytes) and **F1** (the `storage-s3` artifact
  store it reuses for output bytes). It is **complementary to, not a substitute for, Wave 2 (Context, gap-06/10):**
  Context assembles attachments into read-only `AgentContextBundle` *facts*; spec 12 stages the *raw file* into a
  tool-enabled OpenCode sandbox and captures agent-authored *artifacts* back out. Pull it forward whenever a
  file-shaped OpenCode agent (document processing, report/quote generation) is the next workload. **Phase 0 is
  resolved** (`…-phase0-findings.md`): OpenCode permission config is static and can't scope per-run, so cross-run
  isolation is by exclusive single-run container lease + subdir wipe over a shared-volume workspace (path-glob
  confines writes from OpenCode internals); per-run ephemeral containers are the Phase-4 escalation.
