> 🗂️ **Reorg 2026-06-22 · Status: NOT STARTED (roadmap overlay).** Build this ON TOP of the implemented Agent Orchestrator. Treat the in-process + OpenCode runtimes, the registry/SDK, proposal/disposition, and the data model as already-shipped substrate — align new entities/APIs/events with the live module before implementing. Baseline: `.ai/specs/enterprise/agent-orchestrator/00-IMPLEMENTED-BASELINE.md` · live OpenCode spec: `.ai/specs/2026-06-22-opencode-file-defined-agents.md` · code: `packages/enterprise/src/modules/agent_orchestrator/`.

# DISPATCH: Runtime-Adapter Interface, Provider Adapters & A2A — Design Analysis

> **Status:** Design analysis · **Owner:** (architecture) · **Created:** 2026-06-19
> **Gap:** GAP-15 · **Priority:** P2 · **Related:** [`2026-06-19-agent-dispatch.md`](../2026-06-19-agent-dispatch.md), [`2026-06-19-agent-trace-eval-capture.md`](../2026-06-19-agent-trace-eval-capture.md), [`2026-06-19-agent-runtime-options-opencode-vs-in-process.md`](../2026-06-19-agent-runtime-options-opencode-vs-in-process.md)
> **Scope:** focused investigation of one Build gap. Does **not** rewrite the dispatch/trace specs; it designs the seam those specs name but leave undefined.

## 1. Gap statement

The dispatch spec declares two parallel adapter families — **transport adapters** (`internal | pull | a2a push | a2a server`) and **runtime adapters** (selected by `AgentBinding.runtime ∈ internal|a2a|foundry|bedrock|openai|vertex|custom`) — and asserts "one interface, swappable impls … adding a runtime = adding one adapter; nothing else changes." But **the interface itself is never written down.** There is no `RuntimeAdapter` type, no contract for how a runtime's *invoke* + *trace* maps onto `AgentTask`/`AgentRun`, and no concrete impl. A repo audit confirms it: **no `RuntimeAdapter` abstraction and no A2A / `@a2a-js` usage exists today** — both are greenfield.

Three things are named but not designed:
1. **The single adapter contract** behind `internal | pull | a2a-push | provider`, including how each impl normalizes spans to **OTel GenAI** for the trace plane.
2. **Provider adapters** for non-A2A runtimes (OpenAI, custom) — net-new build, no shape defined.
3. **A2A client + server** — and the dispatch spec already flags **A2A TS SDK maturity** as an open risk (a thin in-house shim is the listed fallback). My knowledge cutoff makes SDK maturity an explicit **OPEN QUESTION / spike**, not an assertion.

Two grounding facts shape every option below:
- **The internal runtime already exists:** `runAiAgentObject` (object-mode, typed output) at `packages/ai-assistant/.../lib/agent-runtime.ts:1886`. The internal adapter wraps this (this is GAP-01); it does not build a runtime.
- **Reuse seams exist but two have holes:** `packages/scheduler` has **no native lease/heartbeat** primitive (it schedules jobs; the authoritative lease must be modeled on `AgentTaskLease` + the sweeper job), and `api_keys` has **no OAuth client-credentials** — only opaque keys + `sess_*` session tokens. "Worker auth = agent principals (OAuth client-credentials)" is therefore a dependency on **GAP-16**, not something `api_keys` provides today.

## 2. Architectural drivers

| Driver | Why it matters here |
|--------|---------------------|
| **Interop / standards-conformance** | A2A (Linux Foundation, Apache-2.0) is the external wire; MCP is tools. The promise is "any A2A runtime plugs in via its Agent Card, zero bespoke connector." That only holds if the adapter contract is spec-faithful. |
| **Maintenance burden** | A hand-rolled A2A client+server is protocol surface we own forever (Agent Card schema drift, state-machine, push-notification). An SDK amortizes that — *if* it is real. |
| **SDK maturity / risk** | If the TS SDK is incomplete (no server, no push-notification, weak types) adopting it is worse than a thin shim. Inconclusive at cutoff → must be a spike, not a bet. |
| **Trace-normalization fidelity** | Every adapter must emit `AgentRun/AgentSpan/AgentToolCall` normalized to OTel GenAI (trace spec's *target*, not a dependency). Heterogeneous runtimes expose wildly different trace shapes; the normalizer is where fidelity is won or lost. `telemetry-and-otel` and `eval-runner` **do not exist** — normalization is owned here. |
| **Security / tenant isolation** | An adapter touches credentials, pre-signed payload URLs, and external endpoints. A leaky adapter = cross-tenant leak. Tenant scoping must live in the contract, not each impl. |
| **Time-to-first-external-agent** | Business value is "register an external agent, it claims a task." Internal + pull deliver that without A2A; A2A is the third step. Sequencing matters. |

## 3. Approaches

### Approach A — Define `RuntimeAdapter` now; adopt the A2A TS SDK for the a2a impl
Write the single contract; implement `internal` (wraps `runAiAgentObject`) and `pull` directly; back the `a2a` impl with `@a2a-js` (or equivalent) for Agent Card resolve, task delegate, push-notification, state mapping. Least bespoke protocol code **iff** the SDK is mature.

### Approach B — Define `RuntimeAdapter` now; hand-roll a minimal A2A client+server
Same contract; the `a2a` impl is an in-house shim over the A2A spec: Agent Card resolve, `tasks/send` delegate, push-notification callback received through the `webhooks` outbound/inbound path, A2A-state→`AgentTask`-state mapping. Maximum control, no SDK risk; we own the protocol surface and track spec changes ourselves.

### Approach C — Provider adapters first; defer A2A entirely
Define the contract; ship `internal` + `pull` + a `provider` adapter that wraps a non-A2A runtime's invoke+trace (OpenAI / custom). A2A (client and server) is a later phase. Fastest to first-external-agent over the pull transport; postpones all A2A risk and the SDK decision.

> These are **not mutually exclusive on the contract** — all three define the *same* `RuntimeAdapter`. They differ only in **what fills the `a2a` slot and when**. That is the whole point of the seam.

## 4. Trade-off matrix

| Criterion | A — adopt SDK | B — hand-roll A2A | C — providers first, defer A2A |
|---|---|---|---|
| Standards conformance (A2A) | High (if SDK tracks spec) | Medium-High (we track spec) | N/A until later |
| Maintenance burden | Low (if SDK lives) / High (if abandoned) | High (own the protocol) | Lowest near-term |
| SDK-maturity risk | **High & unresolved** | None | None |
| Trace-normalization fidelity | Same (normalizer is ours either way) | Same | Same |
| Tenant isolation | Same (contract-level) | Same | Same |
| Time-to-first-external-agent | Slow (gated on spike) | Medium | **Fast** (pull/provider) |
| Control over wire behavior | Low | High | N/A yet |
| Lock-in / reversibility | SDK lock-in | None | None |

**Reading:** the contract is free; the cost lives entirely in the `a2a` slot. C front-loads value and defers the only genuinely risky decision. A is best-case-cheapest but rests on an unverified assumption. B is the safe A2A path if/when A2A is required and the SDK fails the spike.

## 5. Recommendation

**Verdict: INCONCLUSIVE on the A2A-SDK question — by design — with a clear default everywhere else.**

1. **Define our own `RuntimeAdapter` interface now, regardless of the A2A outcome.** It is the load-bearing seam; nothing downstream should know which runtime answered. This is unconditional.
2. **Build `internal` (wraps `runAiAgentObject`) + `pull` adapters first** (Approach C's near-term shape). These deliver the original ask (OM-hosted + firewalled/BYO workers) and first-external-agent over `pull`, with **zero A2A risk**.
3. **For A2A, run a spike before committing** (the deciding question): *Evaluate the A2A TS SDK at the current target version — does it provide a usable **server** (publish Agent Card + accept inbound tasks), **client** (resolve card, delegate task), **push-notification** support, and real **TypeScript types**?*
   - **Spike passes → Approach A:** adopt the SDK for the `a2a` impl.
   - **Spike fails / partial → Approach B:** ship a thin hand-rolled A2A client first (Agent Card resolve + delegate + push-notification callback via `webhooks`), defer the A2A *server* to a later phase.
4. **Either way the `a2a` slot is just one impl of the same contract** — internal/pull never change, and the trace normalizer is ours in all cases.

This matches the dispatch spec's own phasing (1→2→3→4 critical path is internal+pull; A2A is phases 5–6) and its stated fallback ("thin in-house protocol shim for v1").

## 6. Effort, risks, dependencies

**Effort: M** (contract + internal + pull + trace-normalizer). A2A adds **S** (SDK path) or **M** (hand-rolled client; +M for the server). Provider adapter per runtime ≈ **S** each.

| Risk | Severity | Mitigation |
|---|---|---|
| A2A TS SDK immature/abandoned at target version | Medium | Spike-gated; hand-rolled shim fallback already designed; `a2a` is isolated behind the contract |
| Trace shapes too heterogeneous to normalize cleanly | Medium | Normalizer maps to OTel GenAI per-adapter; start with internal (we control the shape) and pull, generalize from there |
| Worker auth assumed present but isn't (no OAuth CC in `api_keys`) | Medium | Treat as **GAP-16 dependency**; pull adapter uses agent-principal credentials minted there, not bespoke tokens |
| Scheduler has no lease/heartbeat | Low | Authoritative claim is `AgentTaskLease` (unique active-lease index) + scheduler-driven **sweeper job**, exactly as dispatch spec models it |
| Cross-tenant leak via adapter (creds / pre-signed URLs) | High | Tenancy + scoped, time-limited `storage-s3` URLs enforced in the contract envelope, not per-impl; cross-tenant denial test |

**Dependencies:** GAP-01 (`runAiAgentObject` internal runtime) · GAP-16 (agent-principal OAuth client-credentials) · trace spec (`AgentRun/Span/ToolCall` + ingestion webhook) · `packages/queue` (transport) · `packages/scheduler` (sweeper) · `webhooks` (A2A push callbacks) · `storage-s3` (payload-by-ref).

## 7. Deliverables

### 7.1 `RuntimeAdapter` — the single contract
One interface behind `internal | pull | a2a-push | provider`. Lives at `lib/dispatch/adapters/`.

```typescript
// lib/dispatch/adapters/runtime-adapter.ts
export type RuntimeKind = 'internal' | 'a2a' | 'foundry' | 'bedrock' | 'openai' | 'vertex' | 'custom'
export type TransportKind = 'internal' | 'pull' | 'a2a'

export interface DispatchEnvelope {
  taskId: string
  tenantId: string
  organizationId: string          // every read/dispatch filters by this
  requiredCapability: string
  idempotencyKey: string          // at-least-once dedupe
  payloadSummary?: unknown        // inline; full payload by reference
  payloadArtifactUrl?: string     // time-limited, scoped storage-s3 pre-signed URL
  contextRef?: string | null
  deadlineAt?: string | null
}

export type AdapterOutcome =
  | { kind: 'accepted'; externalTaskId?: string }      // async; result arrives later
  | { kind: 'completed'; run: NormalizedAgentRun }     // sync completion
  | { kind: 'input_required'; prompt: unknown }
  | { kind: 'failed'; retryable: boolean; reason: string }

export interface RuntimeAdapter {
  readonly runtime: RuntimeKind
  readonly transport: TransportKind
  // dispatch one task to the bound runtime; principal carries agent-principal auth (GAP-16)
  dispatch(envelope: DispatchEnvelope, principal: AgentPrincipalRef): Promise<AdapterOutcome>
  // normalize a runtime-native trace/result into the trace-plane contract (OTel GenAI naming)
  normalizeTrace(raw: unknown): NormalizedAgentRun
  // optional liveness for AgentBinding.healthStatus
  health?(binding: AgentBindingRef): Promise<'healthy' | 'degraded' | 'unreachable'>
}
```

### 7.2 `internal` adapter
Wraps `runAiAgentObject` (`packages/ai-assistant/.../agent-runtime.ts:1886`) in object-mode; passes `authContext` from the envelope; returns `{ kind:'completed', run }`. Side effects do **not** execute here — it returns a typed proposal/run; OM disposes. (GAP-01.)

### 7.3 `pull` adapter
Publishes the task to a capability-scoped view/queue; firewalled/BYO workers `claim → heartbeat → result` over HTTP authenticated as **agent principals** (GAP-16). The active **`AgentTaskLease`** is authoritative; the **scheduler sweeper** re-dispatches on expiry. Result for a non-active lease is rejected. Returns `{ kind:'accepted' }`, result lands via the result endpoint.

### 7.4 `a2a` adapter (push + server) — spike-gated
- **Client (push):** resolve partner Agent Card → delegate task → receive artifacts via **push-notification callback delivered through `webhooks`** (no held connection) → `normalizeTrace`. Map A2A `input-required`/`auth-required` → `AgentTask` `input_required`. Returns `{ kind:'accepted', externalTaskId }`.
- **Server (node):** publish `/.well-known/agent-card.json`; inbound A2A task → `AgentTask` (`origin='inbound_a2a'`) runs via internal/pull.
- **Impl chosen by the spike:** `@a2a-js` SDK if it passes; otherwise a thin hand-rolled client (server deferred).

### 7.5 Provider-adapter contract
A `provider` adapter is a `RuntimeAdapter` whose `dispatch` calls a non-A2A runtime's native invoke API and whose `normalizeTrace` maps that runtime's trace shape to `NormalizedAgentRun`. Adding OpenAI/custom = one file under `lib/dispatch/adapters/<runtime>/`; the router selects it by `AgentBinding.runtime`. Net-new build.

### 7.6 Trace normalizer
`normalizeTrace(raw) → NormalizedAgentRun` shared helper that maps span attributes to **OTel GenAI** semantic conventions (the trace spec's normalization target) and POSTs to the HMAC-verified `/trace/ingest` endpoint, idempotent by `(runtime, externalRunId)`. Owned here because no telemetry/eval module exists.

### Acceptance
- One `RuntimeAdapter` interface; `internal` and `pull` impls pass an end-to-end claim→complete test through the single `AgentTask` contract.
- A task whose worker dies is re-dispatched after lease expiry (sweeper); a stale result for the expired lease is rejected.
- An external worker **cannot** read another tenant's task or payload (explicit cross-tenant denial test); payload reached only via a scoped, time-limited pre-signed URL.
- Every adapter emits a `NormalizedAgentRun` whose span attributes follow OTel GenAI naming; ingestion is idempotent by `(runtime, externalRunId)`.
- **A2A spike report exists** answering: server completeness, client completeness, push-notification support, TS types — with a recorded adopt-SDK / hand-roll decision.
- A2A agent (whichever impl) integrates via its Agent Card with no bespoke per-agent connector code.

## Changelog

- **2026-06-19:** Initial design analysis for GAP-15. Defined the single `RuntimeAdapter` contract (envelope + outcome + normalizeTrace), grounded internal-adapter reuse on the existing `runAiAgentObject` (GAP-01) and pull/lease/sweeper reuse on `packages/queue`+`packages/scheduler`+`AgentTaskLease`. Confirmed via repo audit that no `RuntimeAdapter` or A2A usage exists today, that `api_keys` lacks OAuth client-credentials (→ GAP-16 dependency for agent-principal worker auth), and that the scheduler has no native lease/heartbeat (authoritative lease modeled on `AgentTaskLease`). Recommended: define the contract unconditionally + ship internal+pull first; gate the A2A path on a spike (adopt `@a2a-js` if mature, else a thin hand-rolled client with the server deferred). Marked the A2A-SDK decision INCONCLUSIVE pending the spike.
