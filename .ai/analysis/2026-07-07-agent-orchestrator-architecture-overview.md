# Agent Orchestrator — Architecture Overview

> Client-facing architecture overview of the Open Mercato **Agent Orchestrator** (enterprise module).
> Sources: module code on `feat/agent-orchestrator-mvp` (`packages/enterprise/src/modules/agent_orchestrator/`), the spec corpus (`.ai/specs/enterprise/agent-orchestrator/`, baseline in `00-IMPLEMENTED-BASELINE.md`, roadmap in `next/`), and the 2026-07-07 security gap review.
>
> **Status caveat:** the internal status matrix (`next/IMPLEMENTATION-TRACE.md`, dated 2026-06-24) is stale. Guardrails, context/TDCR, agent identity, metric rollups, and performance hardening have all shipped since. Everything below is marked **✅ Built** / **🔜 Roadmap** based on verified code, not the stale spec banners.

---

## 1. General overview

**The one-sentence model:** agents are **propose-only** — an agent never writes business data. It returns a typed, schema-validated result; any state change flows through `proposal → disposition (auto-approve or human task) → effector (audited command)`.

### Component schema

```
 Triggers                     Runtime core                        Governance overlays
┌──────────────────┐   ┌───────────────────────────────┐   ┌──────────────────────────┐
│ Playground (UI)  │   │  Agent Registry (SDK)         │   │ Identity: AgentPrincipal │
│ Workflow step:   │──▶│   code agents + file agents   │   │  + no-bypass enforcer    │
│  INVOKE_AGENT    │   │            │                  │   │ Guardrails: injection,   │
│ (Roadmap:        │   │  AgentRuntimeService.run()    │◀──│  grounding, schema,      │
│  Agentic Tasks — │   │   ├ admission control         │   │  tool-scope backstop     │
│  cron/event/API) │   │   ├ in-process runtime ✅     │   │ Context/TDCR bundles     │
└──────────────────┘   │   ├ OpenCode runtime  ✅      │   │ ACL (caller-scoped)      │
                       │   └ native runtime    🔜      │   └──────────────────────────┘
                       └───────────┬───────────────────┘
                                   ▼
                  AgentRun (immutable) ── informative → done
                                   │ actionable
                                   ▼
                  AgentProposal ──▶ Disposition
                       │  confidence ≥ threshold → auto-approved (audited)
                       │  else → USER_TASK, workflow parks at WAIT_FOR_SIGNAL
                       ▼
                  Human verdict (Caseload UI): approve / edit / reject (+reason)
                       ▼
                  Effector → Command bus (audit, undo, events, cache, index)
                       ▼
     Traces (spans/tool calls) · Evals · Corrections flywheel · Metric rollups
```

### Core design principles (all ✅ Built)

- **Propose-only, structurally enforced** — not a prompt instruction. In-process agents run with all mutating tools stripped; file agents get a deny-by-default tool allowlist plus per-call ACL checks; a fail-closed ORM-level interceptor rejects any agent write outside the audited command path.
- **Human-in-the-loop as a first-class workflow state** — low-confidence proposals become `USER_TASK`s in the deterministic workflow engine; missing confidence never auto-approves (fail-closed).
- **One write path** — agents reuse the platform's existing Command bus, so audit, undo, events, and cache invalidation are identical to a human user's actions. There is deliberately no parallel "agent permission system."
- **Strict multi-tenancy** — every row (runs, proposals, traces, evals, guardrail checks, principals) is scoped by tenant **and** organization.
- **Append-only audit records** — runs, spans, tool calls, guardrail checks, corrections, and context bundles are immutable.
- **Deterministic orchestration, agentic steps** — the existing `workflows` engine is the flow controller; the agent is one step (`INVOKE_AGENT`). LangGraph-style agent-as-orchestrator was explicitly rejected.
- **Open standards at the seams** — MCP for tools, OTel-GenAI span shape for traces, JSON-Schema/Zod for contracts, `SKILL.md` conventions, A2A reserved for cross-runtime dispatch.

### Best advantages

Safety by construction (not by prompt), full auditability down to a named human instigator, tenant-grade isolation, and a learning loop where every human correction becomes regression-test material.

### Main entities (15 tables, ✅ Built)

`agent_runs`, `agent_proposals`, `agent_spans`, `agent_tool_calls`, `agent_corrections`, `agent_eval_cases` / `agent_eval_assertions` / `agent_eval_results`, `agent_metric_rollups`, `agent_guardrail_checks` / `agent_guardrail_sets`, `agent_context_bundles`, `agent_principals`, `agent_delegation_grants`, `agent_run_sessions`.

---

## 2. Agent runtimes

One entry point (`agentRuntime.run()`) dispatches to the runtime declared by the registry entry; all runtimes share the same admission control, identity, guardrails, timeout, and persistence tail — the run/proposal lifecycle is byte-for-byte identical.

| Runtime | Status | What it is |
|---|---|---|
| **In-process** | ✅ Built | Code-defined agents on the Vercel AI SDK (structured object mode + read-only tool loop) inside the Node worker. Fastest path; supports sub-agent delegation (depth 1). |
| **OpenCode** | ✅ Built (transitional) | File-defined agents executed on an external OpenCode server in Docker, calling back into Open Mercato via MCP with a per-run, caller-scoped, 2-hour session token. Battle-tested end-to-end (`REAL-CONTAINER-FINDINGS.md`); works, but per-run cost (container session, SSE, polling) does not scale to hundreds of parallel runs. |
| **Native (lightweight)** | 🔜 Roadmap — spec approved 2026-07-07 | Queue-native runner extracted from the in-process engine: marginal cost per run ≈ one pending LLM promise. Adds always-on full trace capture, per-provider concurrency budgets with 429 retry/backoff, and horizontal scaling (worker replicas × concurrency). **Committed direction: file agents move to native and OpenCode is fully decommissioned** (with the standard one-minor-version deprecation bridge). Authoring conventions stay unchanged — only the executor changes. |
| **External / A2A** | 🔜 Roadmap | Reserved runtime value; the HMAC-authenticated trace-ingest webhook already exists as the landing seam for external-runtime adapters (dispatch/A2A spec not started). |

Positioning: the file-based authoring conventions are stable, OpenCode is the current transitional executor, and native + UI-authored agents are the committed next step.

---

## 3. Agent definitions — file approach first

### File-defined agents (✅ Built, primary model)

An agent is a directory in any module:

```
agents/<agent_id>/
├── AGENT.md           # required: frontmatter (id, label, description,
│                      #   optional provider/model, tools, skills, subAgents,
│                      #   maxSteps) + body = plain-prose instructions
├── OUTCOME.md         # required: kind (informative|actionable) + JSON-Schema
│                      #   of the result (validated subset; compiled to Zod)
├── SAMPLE.json        # optional: playground sample input
├── FACTS.json         # optional: which fields power the approval decision panel
├── skills/<id>/       # SKILL.md + templates, examples, sandboxed scripts/*.ts
├── sub-agents/<id>/   # informative-only sub-agents, delegation depth capped at 1
└── tools/*.ts         # @ref to a registered tool, or a local sandboxed run(args)
```

- `yarn generate` scans these directories, fails loudly on malformed definitions, and emits a committed manifest plus container artifacts.
- Actionable outcomes must fit the envelope `{ actions: [{type, payload}], confidence, rationale }`.
- Local scripts run in an `isolated-vm` sandbox (no filesystem/network, 30s/32MB caps).
- Live committed examples: `deals.health_check_file` and `support.resolution_advisor` in `apps/mercato/src/modules/agent_examples/`.

### Code-defined agents (✅ Built, secondary)

`defineAgent(...)` in `ai-agents.ts` — typed Zod result schema, tools/skills/sub-agents, always registered read-only.

### Tools (✅ Built)

Declared with `defineAiTool` — Zod input schema, `requiredFeatures` (RBAC), `isMutation` flag. Discovered per module via `ai-tools.ts` and exposed both to the in-process loop and to the MCP server. Substantial built-in inventory:

- **customers** pack: get/list people, companies, deals, activities, `analyze_deals`, …
- **catalog** pack: products, prices, search, merchandising
- **search**: `hybrid_search`, record context
- **attachments** and orchestrator meta-tools: `delegate_agent`, `submit_outcome`, `load_skill`, `run_skill_script`

### Tool scoping (✅ Built, layered)

1. Per-agent allowlist (deny-by-default for file agents).
2. All `isMutation: true` tools stripped for propose-only agents.
3. Fail-closed load gate rejecting any agent that declares a mutating or unknown tool.
4. Every tool call checked against the **caller's own** ACL features — never escalated.
5. The ORM no-bypass backstop.

🔜 **Roadmap:** per-workflow-node tool allowlists on `INVOKE_AGENT`; **UI-authored agents** (draft→published versioned `AgentDefinition` entities + a backend builder page) arrive with the native-runtime spec, Phases 4–5.

---

## 4. Data-access restriction (RBAC)

### ✅ Built

- **Agents are first-class principals** — each agent gets a passwordless `kind='agent'` user with a least-privilege scoped role (never super-admin); interactive login is structurally impossible.
- **On-behalf-of attribution** — every action records the agent *and* the human instigator; a dedicated audit page resolves everything a given human triggered through agents.
- **No-bypass invariant, three layers** — structural propose-only, a fail-closed database flush interceptor that rejects any agent write outside the command path, and a release-gate test.
- **14 ACL features** (`agents.view/run`, `proposals.dispose`, `trace.view`, `eval.manage`, `guardrail.manage`, `identity.*`, …) gate every API and page; tools run under the caller's features.
- **Two-column tenancy** on every row; cross-tenant access returns 404, with mandatory two-org isolation tests.
- **External agent auth** — OAuth client-credentials and ID-JAG/`auth.md` self-registration; 5-minute tokens with an `agent` audience (never replayable as a staff session), server-derived scopes, revocable delegation grants.
- **Encryption** — run inputs/outputs, proposal payloads, and eval data are field-level encrypted at rest.

### 🔜 Roadmap

True permission **intersection** for on-behalf-of (today OBO is attribution only — an agent invoked by a low-privilege user still exercises its own full role), credential rotation and periodic access review, opaque handles instead of raw IDs in prompts.

---

## 5. Best practices embodied in the design

- **Fail-closed everywhere** — missing confidence, unknown tools, unreachable issuer registry, invalid output → deny/stop.
- **Deterministic boundaries around a probabilistic core** — "LLM proposes, system disposes."
- **Single source of truth** — existing RBAC/commands/audit; no parallel agent stack.
- **Append-only evidence with redacted summaries** — no raw PII in trace rows.
- **Contract-frozen generation** — schema violations fail the build loudly, never at runtime.
- **Loose coupling** — workflows ↔ orchestrator via optional-peer resolution, never shared entities.
- **Never trust the model** — the active agent is resolved from the server-side session store, not from model claims.
- **Every human correction is captured** as future regression material.

---

## 6. Traceability, observability, cost & model management

### ✅ Built

- **Per run:** model, runtime, tokens in/out, cost, latency, confidence, eval score, context routing; immutable status lifecycle.
- **Trace tree:** append-only OTel-GenAI-shaped spans + tool calls (redacted summaries), rendered as a span waterfall in the trace inspector; HMAC-verified, idempotent trace-ingest webhook for external runtimes; OpenCode runs self-ingest their trace from the live event stream.
- **Metrics:** per-agent KPIs (override rate, eval-pass rate, approve-unchanged, latency, cost) computed live and persisted as idempotent 5-minute rollups by a background worker; org-level overview endpoint feeds the cockpit.
- **Cost:** per-run token/cost fields; platform-wide token-usage events + daily rollups (per tenant/agent/model, including cached and reasoning tokens); runtime loop budgets (max tool calls / wall-clock / tokens) with per-tenant DB overrides that abort in-flight requests; LLM-judge sampling (10%) for cost containment.
- **Model management:** per-agent provider/model declaration with a unified resolution chain (call override → env → agent default → global default), per-tenant/org/agent runtime overrides, and a per-tenant **model allowlist** for governance.

### 🔜 Roadmap

S3 offload of full prompts/payloads (columns exist, unpopulated), span-table partitioning + tiered ≥6-year retention, optional OTel exporter for Grafana/Tempo, `AgentBudget` caps (warn/gate/block on token or cost per tenant/process/agent), and cost-aware model routing. Known trace gap the native runtime fixes: in-process runs currently record the run envelope but not per-step spans.

---

## 7. Evaluation & learning loop

### ✅ Built

- Deterministic **gate-tier assertions** run inline at ingest (output-present, required-keys, min-confidence, no-PII; seeded by default, managed via admin UI + CRUD API).
- A **sampled, async, warn-only LLM judge** worker.
- The **corrections flywheel** — every human Edit/Reject automatically records an `AgentCorrection` (mandatory reason) and drafts an `AgentEvalCase`, which an engineer approves into the regression set; a versioned export endpoint emits the approved case suite.
- Anti-rubber-stamp signal (approve-unchanged rate) live on the cockpit.

### 🔜 Roadmap

Offline regression gate in CI replaying the eval export against a candidate release; `AgentRelease` with shadow → canary → active promotion blocked on safety-assertion regression; **gradual autonomy ramp** (gated → review → auto, widened only when the override rate stays low, with hysteresis and human confirmation for the final step).

---

## 8. Admin UI (operations cockpit)

### ✅ Built

Standalone pages under the "Agents" nav group, all feature-gated, live-updating over SSE:

| Page | Purpose |
|---|---|
| **Overview** | KPI tiles (auto-completed %, needs-a-decision, oldest pending), agent trust/health rows, stuck-and-breaching queue — server-aggregated from rollups |
| **Caseload** + decision panel | The human-approval queue: server-paginated pending/approved/rejected tabs; per-proposal facts grid (FACTS.json-driven), confidence, guardrail verdicts, Approve/Edit/Reject, link to full trace |
| **Traces** + trace inspector | Filterable run list (errors / needs-review / low-confidence); span waterfall, tool calls, eval evidence |
| **Agents** + detail | Fleet registry with runtime and autonomy tags, per-agent metrics |
| **Playground** | Run any agent ad hoc with sample inputs (never auto-executes proposals) |
| **Eval assertions** | Manage deterministic/LLM-judge assertions |
| **Audit** + by-instigator | Disposition audit and the "everything agent X did on behalf of human Y" chain |
| **Processes** | Page exists but is sample-data backed — the claim-anchored process projection is 🔜 roadmap |

### 🔜 Roadmap

The process/caseload projection read-model, widget-injection overlays onto workflow My-Tasks/dashboards, a real "context assembled" panel on the trace detail (API exists, panel currently shows illustrative data), SLA/operator-ratio tiles, and the agent **builder UI** for UI-authored agents.

> **Demo tip:** avoid drilling into the Processes page and the trace-detail context panel — both render sample data today.

---

## 9. Human in the loop

### ✅ Built (central to the design)

- Every actionable result becomes a proposal; per-workflow-node policy is either `autoApproveThreshold` or `alwaysAsk`.
- Above-threshold confidence → audited auto-approval; anything else → a `USER_TASK` and the workflow parks until a human decides.
- Verdicts: approve / **edit (modified payload + mandatory reason)** / **reject (mandatory reason)** — optimistically locked, idempotent, audited; rejection resumes the workflow without executing anything.
- Edits and rejections feed the eval flywheel automatically.

### 🔜 Roadmap

(The spec corpus's most self-aware critique.) Multi-signal disposition (risk category, amount ceilings, guardrail warnings — not just self-reported confidence), decision matrices, confidence calibration from corrections data, sampled re-review of auto-approvals, escalate-after-N-rejections, and SLA escalation on aged tasks.

---

## 10. Performance & scalability

Target from the performance spec: **~12,000 agent runs/day** (~20 concurrent LLM runs steady, 50–100 peak).

### ✅ Built — all six phases of the 2026-07-06 hardening spec shipped (PR #3803)

- **Dedicated invoke-agent queue** (concurrency 5 by default, env-tunable) isolating minute-long LLM jobs from millisecond workflow activities, with a dual-consume drain bridge.
- **Admission control** — global (25) + per-tenant (10) run caps with bounded queueing; overflow returns a retryable capacity error (queue retry) or HTTP 429 + Retry-After (playground).
- **Run timeouts** — 5-minute cancellable deadline on both runtimes.
- **Composite DB indexes** on the hot run/proposal query paths + correct default ordering (fixed a biased 100-row cockpit sample).
- **Cockpit server reads** — server-paginated caseload, rollup-backed overview tiles, coalesced SSE refresh (≤1 reload/5s instead of a query storm per event).
- **Metric-rollup substrate** and a published scaling runbook (sizing math, replica guidance, DB connection budgets: `apps/docs/docs/deployment/agent-orchestration-scaling.mdx`).

### 🔜 Roadmap

The **native runtime** is the big lever (removes the OpenCode per-run container/SSE/polling cost entirely; scale = worker replicas × concurrency), per-provider LLM rate budgets with backoff, non-blocking `INVOKE_AGENT` (worker does not hold a slot during the LLM wait), async trace ingest, S3 payload offload, and table partitioning.

> Honest caveat: the concurrency semaphore is process-local — the fleet-wide cap is per-replica × replicas until a distributed limiter lands.

---

## 11. Security

There is a dedicated design-level security analysis (`agent_orchestration_security_analysis.md`, five pillars: identity, prompt injection, output validation, audit/non-repudiation, confidence-as-risk) and a 2026-07-07 code-verified gap review grading the system against it.

### ✅ Built / mitigated

The analysis's central prescription — deterministic propose/dispose boundaries around the LLM — *is* the shipped architecture. Plus:

- Agent principals with short-lived revocable tokens and audience isolation.
- The fail-closed no-bypass ORM enforcer.
- Guardrails as an independent audited component — **output-schema gate, tool-scope hard backstop ("untrusted document text can never authorize a tool call"), deterministic prompt-injection detector over untrusted spans, and cite-or-abstain grounding gates** — every check logged append-only with redacted evidence and a `guardrail.tripped` event.
- HMAC-signed trace ingest, field-level encryption, tenant-salted identifiers, sandboxed script execution.

### 🔜 Roadmap, by priority (per the gap review)

- **Tier 1 — operational safety:** a **kill switch** (global + per-agent), amount/rate limits per decision type, anti-retry-loop caps, and multi-signal disposition (the single-confidence gate is the one place the built system contradicts its own security analysis). The gap review recommends one "runtime autonomy and operational controls" spec covering exactly this.
- **Tier 2 — hardening:** tamper-evident audit (hash chain/WORM — today immutability is convention + tests, not cryptographic), prompt registry + model-snapshot pinning + drift detection, credential rotation, per-node tool allowlists, guardrail parity for the OpenCode path (moot once native replaces it).
- **Tier 3 — process/compliance:** confidence calibration, sampled re-review, egress controls, OWASP-LLM/DORA control mapping, SIEM correlation.
- **Compliance (specced, not built):** AI-Act decision transparency (plain-language claimant-facing decision records, contest/appeal flow), DSAR export and audit-preserving erasure via crypto-shredding, fairness cohorts. Already supportive today: append-only record-keeping, instigator attribution, encrypted PII, and the anti-rubber-stamp metric (AI Act Art. 14 human-oversight evidence).

---

## Suggested demo narrative

1. Lead with the propose-only + human-disposition loop (Playground → Caseload → approve → trace).
2. Then the file-based authoring story — an agent is a reviewable directory in git.
3. Then governance depth — identity, guardrails, evals, audit-by-instigator.
4. Close with the scale story — hardening already shipped for ~12k runs/day, and an approved spec for the native runtime plus UI-authored agents as the committed roadmap.
