> 🗂️ **Reorg 2026-06-22 · Status: SUPERSEDED (historical).** Decided or replaced by the implementation and the 2026-06-22 OpenCode specs. Kept for provenance only — do not use as a plan. Current: `.ai/specs/enterprise/agent-orchestrator/00-IMPLEMENTED-BASELINE.md`.

# Agent SDK — Simplification Audit

> **Status:** Audit / proposal · **Owner:** Patryk Lewczuk (Comerito) · **Created:** 2026-06-20
> **Supersedes the framing of:** `SPEC-00`, `ADR-001`, and the nine `2026-06-19-agent-*` specs (kept as the *optional overlay* library; not deleted).
> **Companion:** [`runtime-options`](2026-06-19-agent-runtime-options-opencode-vs-in-process.md), [`build-gaps-tracking`](2026-06-19-build-gaps-tracking.md), [`conventions`](2026-06-19-agent-orchestrator-conventions.md).

## Verdict

The current design is **over-engineered for the actual need**. It made *workflow orchestration + regulated AI-Act decisioning + multi-runtime A2A dispatch* the **foundation**, so every agent inherited dispatch, identity-OAuth, compliance, lifecycle, eval, metrics, and cockpit machinery before it could run once. That's backwards.

**Root cause:** "workflow is the spine, the agent is a step" made the heaviest consumer the base layer. One hypothetical high-risk use case (insurance claims) drove the whole foundation.

**The fix:** invert it. The **agent is the primitive** — a thing you author once and **call like a function**. Workflow, gating, dispatch, compliance, trace are **optional callers/overlays** that wrap the primitive *when a use case needs them*. Nothing gets deleted; it gets **re-tiered**.

## The actual need (restated)

1. **Author** an agent in a Claude-Agent-SDK-like pattern: instructions + tools + skills + loop + a typed output. (Inspiration only — not coupled to Claude Agent SDK.)
2. **Run** it from application code as a plain function — `await runAgent(id, input, ctx)`.
3. **Optionally** run it from a workflow (a workflow step is just one caller). Not mandatory.
4. **Get back** a typed **Result** that is either **actionable** (a proposal the app/gate can execute) or **informative** (an answer).

That's the whole core. Everything else is optional.

## The core primitive — "Agent SDK" (three small things)

Built entirely on what OM already ships (`ai_assistant` `runAiAgentObject` object-mode, `defineAiTool`, `AiModelFactory`, `SKILL.md` packs). No new runtime engine.

### 1. Authoring — `defineAgent` (Claude-Agent-SDK-shaped, OM-native)

Auto-discovered like `events.ts`/`acl.ts` (a module's `agents.ts`):

```typescript
export const agents = [
  defineAgent({
    id: 'claims.coverage_check',          // module.agent — the addressable key
    instructions: '...',                   // system prompt
    skills: ['claims.policy-reading'],     // SKILL.md packs — progressive disclosure
    tools: ['claims.read_policy', 'context.retrieve'],  // defineAiTool / MCP, allowlisted
    model: { /* AiModelFactory resolution: provider/model/tenant */ },
    loop: { maxSteps: 4, stopWhen, budget },            // ai_assistant loop controls
    result: {                              // THE output contract:
      kind: 'actionable',                  //   'actionable' | 'informative'
      schema: coverageProposalSchema,      //   Zod → runAiAgentObject output.schema
    },
  }),
]
```

This *is* the Claude-Agent-SDK feature set (system prompt, tools, skills, loop, structured output) — mapped onto OM primitives. Subagents, when needed, are just other agents called from a tool or a workflow.

### 2. Invocation — `runAgent` (callable from anywhere)

```typescript
const result = await agentRuntime.run('claims.coverage_check', input, ctx)
// ctx carries tenantId/organizationId/userId (+ optional agent-principal attribution)
```

One function. Callable from an API route, a service, a queue worker — **or** a workflow step. It wraps `runAiAgentObject`: resolves the agent, loads skills, exposes the allowlisted tools, runs the bounded loop under the model factory, validates output against `result.schema`, returns the typed Result. Internal, in-process, synchronous-ish (await). No dispatch, no queue, no A2A required for the common case.

### 3. The Result contract — actionable | informative

```typescript
type AgentResult<T> =
  | { kind: 'informative'; data: T }                       // an answer; caller uses it
  | { kind: 'actionable'; proposal: {                       // proposed action(s)
        actions: ProposedAction[];   // typed, ready to execute
        confidence?: number;
        rationale?: string;
      } }
```

- **Informative** → the caller just reads `data` (summary, classification, extraction, answer).
- **Actionable** → the caller decides what to do with `proposal`: execute immediately, hand to a **gate** (auto-approve vs human task), or surface in UI. The agent **proposes**; execution stays with the caller/app — which preserves "LLM proposes, the app disposes" **without** mandating a workflow or a business-rules engine.

## The inversion: workflow is now OPTIONAL

| Before | After |
|---|---|
| Workflow is the spine; agent is an `INVOKE_AGENT` step; everything flows through `workflows` + `business_rules`. | **`runAgent` is the primitive.** A workflow step is *one* caller of it, for long-running/multi-actor processes. A plain service call is the *default* caller. |

So the GAP-03 "core workflows enum change" stops being on the critical path. You add the workflow step **only when** a process genuinely needs durability/human-tasks/saga.

## Keep / Defer / Cut-from-core

Nothing is deleted — the nine specs become the **optional overlay library**. Re-tiering:

| Area | Existing spec/gap | Decision | Why |
|---|---|---|---|
| **Agent runtime (run as function)** | GAP-01 / orchestration | **KEEP — core** | This is the primitive. |
| **Agent authoring + registry** | GAP-02 / capability registry | **KEEP — core (simplify)** | Becomes `defineAgent` + auto-discovery. Drop the per-capability ACL/context/guardrail/runtime binding ceremony from the core; an agent is just id+tools+skills+result. |
| **Tools** | ai_assistant `defineAiTool` | **KEEP — core (reuse)** | Already exists. |
| **Skills** | SKILL.md concept | **KEEP — core** | The durable win you asked for; runtime-independent. |
| **Result = actionable\|informative** | (new, small) | **KEEP — core** | Replaces the heavy `AgentProposal`+disposition for the common case. |
| **Output-schema validation** | GUARD (schema part) | **KEEP — core (free)** | It's just Zod on the output; keep it. |
| **Workflow step** | GAP-03 / orchestration | **DEFER in general · but MVP-CORE for the hackathon** | A workflow step is *architecturally* one optional caller of `runAgent` — but for the hackathon cut the **one-node "Invoke Agent" step is core** (new-user headline). See [`mvp-hackathon-sketch`](2026-06-20-agent-mvp-hackathon-sketch.md) Pillar 2. |
| **Disposition gate (auto-approve vs human task)** | orchestration + business_rules | **DEFER — optional overlay** | Only for actionable results that need approval. A plain `if (confidence > x)` covers many cases. |
| **Trace / runs** | TRACE / GAP-04-ish | **DEFER — thin in core** | Core logs a basic run record (id, input ref, output, tokens). Full span/eval trace is an overlay. |
| **Guardrails (injection/grounding/moderation)** | GUARD / GAP-07/08/09 | **DEFER — safety overlay** | Add per-agent when inputs are untrusted (attachments). Not every agent needs it. |
| **Context / TDCR plane** | CONTEXT / GAP-10 | **DEFER — caller-supplied or a tool** | Default: the caller passes context, or the agent calls a `retrieve` tool. The full governed TDCR plane is an overlay for evidence-heavy domains. |
| **Eval harness + metrics** | GAP-04/05 | **DEFER — overlay** | Adopt when you need regression gating / KPIs. |
| **Lifecycle (shadow/canary/autonomy)** | LIFECYCLE / GAP-14 | **DEFER — overlay** | Deployment governance, not a prerequisite to run an agent. |
| **Cockpit UI** | COCKPIT | **DEFER — overlay** | Reuse existing admin surfaces first. |
| **Dispatch transports + A2A + provider adapters** | DISPATCH / GAP-15 | **CUT from core** | "Run from the app as a function" = internal only. A2A/pull/external is needed **only** for cross-runtime/firewalled agents — a later, opt-in layer. |
| **Identity OAuth-CC server** | IDENTITY / GAP-16-A | **CUT from core** | Internal agents run under the caller's `ctx` + a lightweight agent-principal attribution. The OAuth server is only for **external** agents (pairs with dispatch/A2A). |
| **Compliance / AI-Act / DSAR / fairness** | COMPLY / GAP-11/12/13 | **CUT from core → domain overlay** | This is *insurance-claims-decisioning* scope, not general-SDK scope. Package it as a "regulated decisioning" overlay applied only to agents that make decisions about people. |
| **Retention/partitioning, seeds** | GAP-18/19 | **DEFER — overlay infra** | Matters at scale + audit tiers, not for the SDK. |

**Net:** core shrinks from ~13 specs + 20 gaps to **one core spec + a few reused primitives**. The rest is a menu you pull from per use case.

## What the collapsed spec set looks like

- **`agent-sdk` (core, new)** — `defineAgent`, `runAgent`, the Result contract, tools+skills wiring, thin run-logging. ~1 spec. (Absorbs GAP-01 + the *simplified* GAP-02; reuses ai_assistant.)
- **Optional overlays** (adopt à la carte, each on top of `runAgent`):
  - `workflow-step` (durable processes) · `gate` (approve actionable results) · `guardrails` (untrusted input) · `context-plane` (governed retrieval/evidence) · `trace+eval+metrics` (observability/regression) · `lifecycle` (rollout governance) · `cockpit` (ops UI) · `external-runtimes` (dispatch + A2A + identity-OAuth) · `regulated-decisioning` (AI-Act/DSAR/fairness/explanation).
- The existing nine `2026-06-19` specs + 20 gap analyses **become the detailed reference for those overlays** — already written, now correctly positioned as optional.

## Why this satisfies the ask

- **Claude-Agent-SDK-like authoring** → `defineAgent` (instructions/tools/skills/loop/output). ✔
- **Run from app as a function** → `runAgent(id, input, ctx)`, in-process, no dispatch. ✔
- **Workflow optional** → workflow step is one caller, not the spine. ✔
- **Tools + skills + full agent-loop** → reuse `defineAiTool` + SKILL.md + `runAiAgentObject` loop. ✔
- **Actionable or informative result** → the `AgentResult` union; actionable = proposal the caller executes/gates, informative = answer. ✔
- **Not coupled to Claude Agent SDK** → it's the *pattern*, implemented on OM's own `ai_assistant`. ✔

## Recommendation & next step

1. **Adopt this re-tiering.** Treat `agent-sdk` as the only must-build; everything else is opt-in.
2. **Author one core spec** — `2026-06-20-agent-sdk.md` — for `defineAgent` / `runAgent` / Result, replacing `SPEC-00`'s "program" framing. The nine specs stay as the overlay reference; add a one-line "OPTIONAL OVERLAY — applies on top of the agent-sdk" banner to each.
3. **Walking skeleton** = define one agent + call it from a service + get a typed actionable result. No workflow, no dispatch, no gate. Prove the primitive first.

## Open questions (small, for you)

- **Actionable execution default:** when a caller gets an `actionable` result with no gate, should the SDK offer a one-line `executeProposal(proposal, ctx)` helper (runs the actions through OM Commands/audit), or always leave execution to the caller? (Recommend: provide the helper, optional to use.)
- **Skills format:** adopt `SKILL.md` verbatim (progressive disclosure, Anthropic's open format) or a lighter OM `skills.ts` declaration? (Recommend: `SKILL.md` for portability.)

## Changelog

- **2026-06-20:** Simplification audit. Proposed inverting the architecture — agent-as-callable-primitive (`defineAgent`/`runAgent`/actionable|informative Result) as the only core; workflow, gating, dispatch/A2A, identity-OAuth, compliance, lifecycle, eval/metrics, cockpit, context-plane re-tiered as optional overlays. Keep/Defer/Cut-from-core table maps all nine specs + 20 gaps onto the new tiers; nothing deleted.
