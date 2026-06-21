# Internal-Agent Runtime — Design Analysis

> **Status:** Analysis · **Owner:** Patryk Lewczuk (Comerito) · **Created:** 2026-06-19 · **Gap:** GAP-01 · **Priority:** P0
> **Related:** [`2026-06-19-agent-orchestration-step-and-proposal.md`](../2026-06-19-agent-orchestration-step-and-proposal.md) (orchestration/Proposal), [`2026-06-19-agent-dispatch.md`](../2026-06-19-agent-dispatch.md) (dispatch/transport), [`2026-06-19-agent-identity-and-on-behalf-of.md`](../2026-06-19-agent-identity-and-on-behalf-of.md) (identity), [`2026-06-19-agent-runtime-options-opencode-vs-in-process.md`](../2026-06-19-agent-runtime-options-opencode-vs-in-process.md) (runtime evaluation), guardrails spec (GUARD-01), conventions doc (normative)

## 1. Gap statement

The orchestration spec defines the keystone (`workflows` step → `DispatchService.enqueue` → `AgentTask` → "agent runs" → `AgentRun`/`AgentProposal` → resume signal → `business_rules` disposes). Every sibling spec stops at **"agent runs"**. No spec defines the component that, **given an `AgentTask {capability, contextRef}`, actually runs an LLM with tools and emits a typed `AgentProposal`.** This is the `internal` transport's executor in DISPATCH — the thing the `internal` adapter (DISPATCH Phase 3, the critical-path "original ask") invokes.

Without it there is no walking skeleton: dispatch can lease a task and identity can attribute the actor, but nothing turns a leased internal task into a validated `AgentProposal` row that fires `agent_orchestrator.proposal.ready`. Everything downstream — disposition (`business_rules`), the cockpit, trace capture, eval export, arbitration, and the entire propose-only safety claim — depends on a runtime that produces a **schema-valid, propose-only** artifact. DISPATCH 1→2→**3** cannot complete, and ORCHESTRATION Phase 1 acceptance ("runs an internal agent, produces an `AgentProposal`") is unmet, until this exists.

## 2. Architectural drivers

1. **Typed-output fidelity** — the Proposal is the agent's `output` schema (per-capability Zod). The runtime MUST return a schema-validated object, not free-form text to be re-parsed.
2. **Propose-only safety** — an orchestrated agent carries READ tools + a structured output ONLY; NO mutating tools. Execution is OM effector activities *after* the disposition gate. Enforced, not trusted.
3. **Tenant isolation + audit** — runs under the agent principal `authContext` (`{tenantId, organizationId, agentUserId, onBehalfOfUserId, sourceKey:'agent'}`); reads stay org-scoped; the no-bypass invariant holds (no agent write outside the audited Command path).
4. **Latency / single-call cost** — a Proposal is a single decision artifact; a heavy multi-agent loop is over-engineered for most capabilities. Cheapest path that satisfies fidelity wins.
5. **OM-fit / reuse** — must reuse `ai_assistant` object-mode (`runAiAgentObject`), `AiModelFactory`, allowedTools, mutation-policy, loop controls, per-tenant prompt/model/allowlist overrides — not reinvent a loop engine.
6. **Contract stability** — the `AgentProposal` (Zod/JSON Schema) is the runtime-agnostic contract; the same Proposal must be producible by an external runtime (A2A) without changing disposition. The runtime registers as one DISPATCH `runtime`/transport, not a hard-wired path.
7. **Workflow-as-controller** — "LLM proposes, OM disposes, OM executes after the gate." The runtime is a *step executor*, never a flow controller (no LLM-spawned subagents driving sequencing).

## 3. Approaches considered

A load-bearing codebase fact shapes every option: **today's `runAiAgentObject` resolves the agent's tools but does NOT pass them to `generateObject`/`streamObject`** (`agent-runtime.ts:1956` — `void tools`). Object-mode is a single structured-output model call with **zero tool execution**. That is *exactly* the propose-only posture (a model that cannot call any tool cannot mutate), but it means READ context must arrive **pre-fetched in the prompt** (via ContextBundle / `resolvePageContext`), unless object-mode is additively extended to loop over read-only tools.

### (a) Thin `InternalAgentRuntimeAdapter` over `runAiAgentObject` object-mode — RECOMMENDED PRIMARY
- **Shape:** capability → an `AiAgentDefinition` (`executionMode:'object'`, `output.schema` = the per-capability Proposal Zod, `readOnly:true`, `mutationPolicy:'read-only'`, READ-only `allowedTools`). Adapter builds `input`/`pageContext` from the ContextBundle (`contextRef`), resolves the agent principal `authContext` (IDENTITY), calls `runAiAgentObject`, GUARD pre (input/tool-scope) + post (output) check, persists `AgentRun` + `AgentProposal`, signals `agent_orchestrator.proposal.ready`.
- **Maps to OM primitives:** `runAiAgentObject` (loop engine + typed output + `AiModelFactory` + tenant overrides + allowlist), CONTEXT-01 (ContextBundle), IDENTITY-01 (`runAs`), GUARD-01 (pre/post), TRACE-01 (`AgentRun`), ORCHESTRATION (`AgentProposal` + signal), DISPATCH (`runtime:'internal'`).
- **Pros:** Zero new loop engine; typed output is native; propose-only is *structural* (object-mode passes no tools today, so it physically cannot mutate); reuses every governance seam; smallest surface; the codebase already "intends" this (`POST /api/ai_assistant/ai/chat-object`, the `run-object` route).
- **Cons:** Read tools aren't executed in object-mode today, so the agent reasons over **pre-fetched** context, not interactive retrieval. For capabilities that genuinely need iterative read-then-read, either (a1) the adapter pre-fetches via ContextBundle enrichers, or (a2) `ai_assistant` gains an additive **read-only tool loop in object-mode** (pass `tools` + `prepareStep` filtered to `isMutation:false`, then a final `generateObject`). (a2) is a clean, contract-safe `ai_assistant` enhancement and is the recommended follow-on, not a blocker for the skeleton.

### (b) Bespoke Vercel AI SDK loop (don't reuse `ai_assistant`)
- **Maps to:** raw `generateObject` + hand-rolled tool/mutation/allowlist/model wiring.
- **Pros:** full control over a read-tool loop now.
- **Cons:** re-implements `buildWrapperPrepareStep` (mutation-approval gate), allowlist intersection, `AiModelFactory` precedence, tenant overrides/allowlist, budget/loop controls, token-usage recording — i.e. re-derives the exact governance `runAiAgentObject` already enforces, and drifts from it. Violates driver 5 and risks driver 2/3. **Reject.**

### (c) `ai_assistant` CHAT-mode + an `emit_proposal` tool to coerce structure
- **Maps to:** `runAiAgentText` (chat loop with tools) + a terminal `emit_proposal(Zod)` tool / `hasToolCall` stop.
- **Pros:** gives an interactive read-tool loop today without changing object-mode.
- **Cons:** structure is *coerced*, not native — the model may skip/garble the final tool; chat mode admits the full mutation surface (must be clamped to `read-only` + read-only allowlist to stay propose-only); two ways to end a turn. Strictly worse fidelity than (a) for the typed-Proposal contract. **Keep only as a fallback** for a capability that needs a tool loop *before* (a2) ships.
- **Not the disposition path:** chat mode's mutation route is `prepareMutation`/`ai_pending_actions` — a *different* mechanism (per-tool approval card for a live operator). Orchestration owns `AgentProposal` + `dispose` (auto-approve via `business_rules` or `USER_TASK`). The runtime MUST NOT use `ai_pending_actions` as the disposition path; see §below.

### (d) External runtime via A2A
- **Maps to:** DISPATCH `runtime:'a2a'` / provider adapters; the external agent returns an artifact normalized to `AgentProposal` (JSON Schema validated); OTel GenAI → `AgentRun`.
- **Pros:** the generalization of (a) — any compliant runtime (Bedrock/Vertex/Foundry/OpenAI) plugs in via Agent Card with no bespoke connector; same Proposal contract, same disposition.
- **Cons:** transport weight, SDK maturity (DISPATCH open question), external trust. Not needed for the in-house skeleton. **Adopt as the external generalization, later.**

### Why `prepareMutation` / `ai_pending_actions` is NOT the disposition path
`ai_pending_actions` is `ai_assistant`'s **operator-in-the-loop write-approval** primitive: a mutation tool calls `prepareMutation`, a card is shown, a human confirms, the write executes inside the chat turn. Orchestration's disposition is a **different governance plane**: the agent emits NO write at all (propose-only), the `AgentProposal` is persisted, and `business_rules` either auto-approves under threshold or raises a `workflows` `USER_TASK`; the *effector* runs later as a standard `workflows` activity under OM authority. Using `ai_pending_actions` would (1) put write tools in the agent's hand (breaks propose-only), (2) bypass `AgentProposal`/`AgentCorrection`/arbitration, and (3) bind disposition to a synchronous chat operator instead of the async workflow gate. The two coexist; they are not interchangeable.

### How this registers as a DISPATCH runtime
The adapter IS the `internal` transport's runtime: `TaskRouter` resolves an `AgentBinding {transport:'internal', runtime:'internal'}` → the internal adapter (queue worker) calls `InternalAgentRuntimeAdapter.run(task)`. Adding (d) later = add an `a2a`/provider adapter behind the same `AgentTask`→`AgentProposal` contract; nothing in disposition changes. This is the runtime-agnostic seam the evaluation doc mandates.

## 4. Trade-off matrix

| Driver | (a) adapter over `runAiAgentObject` | (b) bespoke AI SDK loop | (c) chat + emit_proposal | (d) external A2A |
|---|---|---|---|---|
| Typed-output fidelity | High (native `output.schema`) | High | Medium (coerced) | Medium-High (validated artifact) |
| Propose-only safety | High (object-mode passes no tools) | Medium (self-built) | Low-Medium (must clamp) | Medium (external trust) |
| Tenant/audit/no-bypass | High (reuses seams + `runAs`) | Low (re-derive) | High | Medium (scoped cred) |
| Latency/cost (single decision) | High (1 call) | High | Medium (loop) | Low (network) |
| OM-fit / reuse | High | Low | High | Medium |
| Contract stability (runtime-agnostic) | High | Medium | Medium | High |
| Workflow-as-controller | High | High | High | High |
| Interactive read-tool loop *today* | No (pre-fetch; a2 adds it) | Yes | Yes | Depends |

## 5. Recommendation

**Conclusive. Adopt (a) — the thin `InternalAgentRuntimeAdapter` over `runAiAgentObject` object-mode — as the primary internal runtime, with (d) A2A as the external generalization behind the identical `AgentProposal` contract.**

Rationale: (a) gets the typed Proposal natively, makes propose-only *structural* (object-mode executes no tools, so the agent cannot mutate by construction), and reuses every governance seam (`AiModelFactory`, allowlist, tenant overrides, loop/budget, the no-bypass posture) instead of re-deriving them. The Proposal Zod is the runtime-agnostic contract, so (d) plugs in later with zero disposition change. (b) is rejected (re-invents governance); (c) is a narrow fallback only for a capability that needs a read-tool loop before (a2) lands.

**The one design decision that needs a spike, not a blocker:** whether v1 capabilities need an *interactive read-tool loop* or are satisfied by **pre-fetched ContextBundle** context.
- **Recommended default:** ship the skeleton with **pre-fetched context** (object-mode, no tool loop) — it satisfies the first capabilities and the acceptance test.
- **Spike (S):** take one real capability (e.g. `damage.estimate`), implement it both ways (pre-fetch vs a read-only tool loop) and measure Proposal quality + token cost. If interactive reads materially help, land **(a2)**: an additive `ai_assistant` change that passes `isMutation:false` tools to object-mode with a `prepareStep` that hard-filters to read-only and ends on `generateObject`. (a2) keeps (a) primary and stays contract-safe.

## 6. Effort, risks, dependencies

**Effort: M.** Adapter + capability→AgentDefinition registry + Proposal persistence + signal + GUARD wiring are S each; the integration (lease → run → trace → proposal → signal) and the no-bypass test push it to M. (a2), if chosen, adds S-M in `ai_assistant`.

**Risks:**
- *Read-tool loop expectation* (Medium): if capabilities assume interactive retrieval, pre-fetch under-serves them → mitigate via the §5 spike + (a2).
- *Propose-only regression* (High→Low): if a future change passes mutating tools to object-mode, the structural guarantee breaks → GUARD post-check + a test asserting object-mode internal agents carry zero `isMutation:true` tools; keep `readOnly:true`+`mutationPolicy:'read-only'`.
- *Schema drift* (Medium): per-capability Proposal Zod must equal `agent.output.schema` → single source in `data/validators.ts`, re-exported; assert equality in the registry.
- *Principal/context plumbing* (Medium): depends on IDENTITY `runAs` + CONTEXT ContextBundle existing.

**Dependencies:** CONTEXT-01 (ContextBundle/`contextRef`), IDENTITY-01 (`AgentPrincipal` + `runAs`), GUARD-01 (pre/post), ORCHESTRATION (`AgentProposal` + `proposal.ready` + capability registry), DISPATCH (`internal` adapter + `AgentBinding.runtime`), TRACE-01 (`AgentRun`). `ai_assistant` is reused as-is for (a); (a2) is an additive enhancement to it.

## 7. Concrete deliverables + acceptance

**Deliverables (OM conventions, module `agent_orchestrator`, code under `lib/orchestration/`):**
- `InternalAgentRuntimeService` (`di.ts` key) — `run({ task }): Promise<{ runId, proposalId }>`: resolve capability→`AgentDefinition`, build input from ContextBundle, resolve principal `authContext` via IDENTITY `runAs`, GUARD pre, call `runAiAgentObject({ executionMode:'object', output:{schema} })`, GUARD post, persist `AgentRun`+`AgentProposal` via the **Command path** (audit/events), emit `agent_orchestrator.proposal.ready`.
- `CapabilityRegistry` (`lib/orchestration/`) — maps `capability` → `{ agentDefinitionId, proposalSchemaName }`; the Proposal Zod lives in `data/validators.ts` and IS the agent's `output.schema`.
- Per-capability **object-mode** `AiAgentDefinition`s (`readOnly:true`, `mutationPolicy:'read-only'`, READ-only `allowedTools`, `output.schema` = Proposal Zod).
- `AgentRun` entity (append-only, dual tenancy) + the existing `AgentProposal` (editable, `updated_at`).
- DISPATCH wiring: the `internal` adapter (queue worker) invokes `InternalAgentRuntimeService.run`.
- Events: `agent_orchestrator.proposal.ready`, `agent_orchestrator.run.completed`/`.failed` (`events.ts`, `as const`). ACL: `agent_orchestrator.invoke`.
- Tests: (1) capability run produces a schema-valid `AgentProposal` + fires the signal; (2) **no `isMutation:true` tool reachable** in an object-mode internal agent (propose-only gate); (3) no-bypass — no `kind='agent'` write outside the Command path; (4) cross-tenant denial on context/run reads.
- *(Optional follow-on (a2))* additive `ai_assistant` read-only object-mode tool loop.

**Acceptance:**
- Given an `AgentTask {capability, contextRef}`, the runtime runs an object-mode LLM under the agent principal and persists a **schema-valid** `AgentProposal`, then emits `agent_orchestrator.proposal.ready` — completing DISPATCH Phase 3 and ORCHESTRATION Phase 1.
- The agent holds NO mutating tool; the only write it causes is the `AgentProposal` row via the audited Command path.
- The same `AgentProposal` is producible by a future (d) A2A runtime with no change to disposition.
- A stale/invalid model output is rejected by GUARD post and recorded as `run.failed`, not a malformed Proposal.

## Changelog

- **2026-06-19:** Created. Analyzed the internal-agent runtime gap; recommended (a) a thin `InternalAgentRuntimeAdapter` over `runAiAgentObject` object-mode as primary, (d) A2A as the external generalization. Documented the load-bearing finding that object-mode passes NO tools today (making propose-only structural) and surfaced the pre-fetch-vs-read-tool-loop spike + the additive (a2) `ai_assistant` enhancement. Explained why `prepareMutation`/`ai_pending_actions` is not the disposition path and how the runtime registers as the DISPATCH `internal` runtime.
