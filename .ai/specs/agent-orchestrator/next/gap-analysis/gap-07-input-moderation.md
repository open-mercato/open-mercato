> 🗂️ **Reorg 2026-06-22 · Status: NOT STARTED (roadmap overlay).** Build this ON TOP of the implemented Agent Orchestrator. Treat the in-process + OpenCode runtimes, the registry/SDK, proposal/disposition, and the data model as already-shipped substrate — align new entities/APIs/events with the live module before implementing. Baseline: `.ai/specs/agent-orchestrator/00-IMPLEMENTED-BASELINE.md` · live OpenCode spec: `.ai/specs/2026-06-22-opencode-file-defined-agents.md` · code: `packages/core/src/modules/agent_orchestrator/`.

# Input Moderation & Safety Identifiers — Design Analysis

> **Category:** Build · **Gap:** GAP-07 · **Priority:** P1
> **Related:** `2026-06-19-agent-runtime-guardrails.md` (GUARD spec — owns input/output guardrails, `AgentGuardrailCheck` with `kind='moderation'` already declared) · `2026-06-04-ai-input-moderation-and-safety-identifiers.md` (DRAFT, NOT implemented — its `endUserIdentifier` + pre-moderation gate ideas are *built here*, not extended) · `2026-06-19-agent-orchestrator-conventions.md` (normative house style)
> **Status:** Design analysis · **Created:** 2026-06-19

## 1. Gap statement

The agent runtime has strong **authorization** guardrails (ACL features, per-step tool allowlists re-asserted by the security-critical `prepareStep` wrapper in `agent-runtime.ts`, mutation approval via `prepareMutation`, model/baseURL allowlists) but **zero content guardrails**. No call to any moderation API exists in the repo; `LlmCreateModelOptions` (`packages/shared/src/lib/ai/llm-provider.ts`) carries only `{ modelId, apiKey, baseURL }` — no per-user attribution reaches the provider, so provider-side abuse enforcement targets the whole org key. For an insurance-domain orchestrator that ingests attacker-controllable claim attachments and may expose portal/customer-facing agents, this leaves two holes: (a) abusive end-user input is neither screened nor traceable to an individual, and (b) the instance owner's provider account carries the full enforcement blast radius (warning → suspension → termination). The GUARD spec already declares `AgentGuardrailCheck.kind='moderation'` but does not yet implement a moderation provider, a gate, or safety identifiers. This gap builds them.

## 2. Architectural drivers

- **Provider-agnosticism / no lock-in.** OM runs OpenAI, Anthropic, and OpenAI-compatible proxies (`createOpenAICompatibleProvider`). The moderation mechanism must not hard-bind the orchestrator to OpenAI; tenants on Anthropic/Google still need a path (their server-side filtering, or a self-hosted classifier later).
- **Latency on the request path.** Moderation is a **pre-call gate** on the synchronous turn. The OpenAI `/v1/moderations` endpoint is ~100–300 ms and free; an LLM-judge adds a full generation round-trip (token cost + variable latency) per turn. The gate must run **once per turn (pre-loop)**, never per step — mid-loop content is trusted tool output, not new user input.
- **$/call.** Moderations endpoint is free; LLM-judge bills tokens on every turn on every enabled surface. Cost discipline favors the free classifier as default.
- **False-block cost.** A false `block` stalls a legitimate agent run. Behavior must distinguish `block` (enforced/untrusted surfaces, fail-closed) from `warn` (opt-in surfaces, proceed + flag), and route blocks to retry/escalate/`USER_TASK` rather than hard-fail (consistent with GUARD's verdict model).
- **PII in moderation calls.** The moderated text may contain claimant PII. Sending it to a third-party classifier is a data-flow that must be acknowledged; the **stored** flag must hold categories + scores only — never prompt content (data minimization, GDPR Art. 5(1)(c)).
- **AI Act / abuse-tracing.** A stable, non-reversible per-user identifier lets the provider act on one abuser instead of the org, and supports auditability obligations. It must be an HMAC (no PII leaves the platform) and tenant-salted.
- **OM-fit.** Reuse `AiModelFactory`/`LlmProvider` (provider resolution + capability flags), the `deriveJwtAudienceSecret` memoized-HMAC pattern (`packages/shared/src/lib/auth/jwt.ts`), and GUARD's existing `AgentGuardrailCheck` storage — rather than inventing parallel registries, secrets, or audit tables.

## 3. Approaches considered

**(a) OpenAI moderations endpoint as a fixed default.** Wire `/v1/moderations` (`omni-moderation-latest`) directly into the pre-loop gate. Free, fast, battle-tested (LibreChat ships exactly this). Downside: binds the gate to OpenAI; tenants without an OpenAI key get no moderation.

**(b) Provider-agnostic moderation adapter (recommended).** A small `ModerationProvider` contract — `checkInput(text, ctx): Promise<ModerationVerdict>` + a `supportsInputModeration` capability flag — with swappable implementations: an OpenAI impl (default), and room for Azure Content Safety / self-hosted classifiers. Resolved via DI in the `agent_orchestrator` module, gated by the provider capability flag (skip when unsupported). Two sub-variants for *where* the contract lives: (b1) a lightweight `ModerationProvider` interface inside `agent_orchestrator/lib/guardrails/` (or `ai_assistant`), or (b2) a full `integrations` IntegrationDefinition adapter (health checks, credential UI, bundle wiring, enable/disable state). Investigation shows (b2) is **~80–200 LOC of boilerplate** (health-check service + DI + credential schema + state entity) for a singleton gate that needs none of it — moderation is not a per-tenant enable/disable connector and its credentials ride the already-resolved LLM provider key. (b1) is ~200 LOC total. **Choose (b1).**

**(c) LLM-judge moderation via `AiModelFactory`.** Call a model with a moderation system prompt to classify the input. Maximally flexible (custom policy, any provider, multilingual nuance) and naturally provider-agnostic since it reuses `resolveModel`. But it costs a full generation per turn (tokens + latency), is non-deterministic, and is the wrong default for a high-volume request-path gate. Best reserved as an *optional* `ModerationProvider` impl for tenants who want policy beyond the classifier — i.e., it composes *under* approach (b), it is not a competing top-level choice.

## 4. Trade-off matrix

| Dimension | (a) Fixed OpenAI | (b1) Agnostic adapter (light) | (b2) Agnostic via integrations | (c) LLM-judge |
|---|---|---|---|---|
| Provider lock-in | High (OpenAI only) | **None** | None | None |
| Latency / turn | Low (~100–300 ms) | **Low (default impl)** | Low | High (full generation) |
| $/call | Free | **Free (default)** | Free | Token-billed |
| False-block tunability | Scores+threshold | **Scores+threshold; pluggable** | Same | Prompt-tunable, noisy |
| Multi-provider tenants | Unserved | **Served (skip or alt impl)** | Served | Served |
| OM boilerplate | Low | **Low (~200 LOC)** | High (~+150 LOC) | Medium |
| Extensibility (Azure/self-host) | None | **Add an impl** | Add an integration | Swap prompt/model |
| Fit for singleton gate | OK | **Best** | Over-engineered | Over-engineered as default |

## 5. Recommendation

**Build a provider-agnostic `ModerationProvider` contract (approach b1) defaulting to the OpenAI moderations endpoint, add a tenant-salted `endUserIdentifier` HMAC on every model call, and store every moderation verdict as a GUARD `AgentGuardrailCheck` with `kind='moderation'`.**

Rationale:
- **(b1) over (a):** the contract is one small interface + a capability flag; it removes lock-in for ~zero extra cost and lets LLM-judge (c) and Azure/self-hosted impls drop in later additively. (a) is the *default implementation* of (b1), so we get its free/fast properties without its lock-in.
- **(b1) over (b2):** moderation is a singleton runtime gate, not a per-tenant pluggable connector — the `integrations` adapter's health-check/credential-UI/bundle/state machinery is dead weight here, and its credentials would duplicate the LLM provider key already resolved by `AiModelFactory`.
- **(c) as a pluggable impl, not the default:** a full generation per turn on the request path is the wrong default for cost and latency; keep it available behind the same contract for tenants who need richer policy.
- **`endUserIdentifier`:** reuse the proven `deriveJwtAudienceSecret` memoized-HMAC pattern with a new purpose label (`open-mercato:ai-safety-identifier:v1`), keyed off the existing auth secret — no new secret to provision, tenant-salted so identical users across tenants never collide, never reversible. Map per provider via an additive `LlmProvider.mapEndUserIdentifier?(id)` (OpenAI → `safety_identifier`, Anthropic → `metadata.user_id`); adapters without a mapping ignore it.
- **Storage reuse:** GUARD already declares `AgentGuardrailCheck.kind='moderation'` (append-only, dual-tenancy, redacted `evidence` jsonb). Reuse it. Do **not** add the draft's separate `AiModerationFlag` table — a second audit log of the same event fragments querying and duplicates tenancy/ACL plumbing. The `evidence` column carries `{ categories, scores }` only (no prompt content), satisfying the draft's data-minimization decision within the existing schema.

This means the 2026-06-04 draft's two ideas are **realized inside the GUARD/orchestrator surface**: the pre-moderation gate becomes GUARD `checkInput`'s `moderation` kind, and `endUserIdentifier` becomes a shared-contract addition consumed by the orchestrator's `INVOKE_AGENT` model call. The draft's standalone `ai_moderation_flags` table and `ai_assistant`-only framing are superseded.

## 6. Effort, risks, dependencies

**Effort: M.** `ModerationProvider` contract + OpenAI impl (~120 LOC); `endUserIdentifier` HMAC helper + per-provider mapping + threading through `resolveModel`/model call (~80 LOC + adapter touches); gate wiring into the GUARD `checkInput` `moderation` kind (~40 LOC); reuse `AgentGuardrailCheck` (no new entity); i18n + policy-resolution precedence + tests. No new table, no new secret.

**Risks:**
- *Moderation outage degrades enforced surfaces* (Med) — fail-closed on `untrustedInput`/enforced surfaces is correct (silently skipping on an untrusted surface is worse); short timeout (2–3 s) + one retry; distinct "temporarily unavailable" message vs "blocked".
- *False positives block legitimate runs* (Med) — default off for trusted backoffice; per-capability `warn` vs `block` thresholds (GUARD set config); route blocks to retry/escalate/`USER_TASK`; audit scores let operators tune before widening.
- *PII sent to third-party classifier* (Med) — unavoidable for input screening; mitigate by storing categories+scores only, documenting the data flow, and allowing a self-hosted `ModerationProvider` impl for tenants who cannot egress PII.
- *Identifier secret rotation breaks provider abuse-history continuity* (Low) — advisory metadata only, not a security control; document.
- *Cross-tenant leak* (Critical if it occurred) — HMAC is tenant-salted; `AgentGuardrailCheck` reads filter `organizationId`; isolation probe in integration tests.

**Dependencies:** GUARD spec's `GuardrailService` + `AgentGuardrailCheck` entity (the gate is a `kind='moderation'` check). `AiModelFactory`/`LlmProvider` shared contract (additive members). `deriveJwtAudienceSecret` pattern (`packages/shared/src/lib/auth/jwt.ts`). Auth context (`McpAuthSuccess.{userId,tenantId}`). No dependency on `telemetry-and-otel` (does not exist).

## 7. Deliverables & acceptance

**Deliverables:**
1. **Moderation provider adapter** — `ModerationProvider` contract (`checkInput(text, ctx): Promise<ModerationVerdict>` + `supportsInputModeration` capability) in `agent_orchestrator/lib/guardrails/`, with an OpenAI moderations impl (`omni-moderation-latest`, configurable via `OM_AI_MODERATION_MODEL`) as the default; DI-registered; pluggable so Azure/self-hosted/LLM-judge impls drop in additively.
2. **`endUserIdentifier` HMAC** — `computeEndUserIdentifier(tenantId, userId)` reusing the `deriveJwtAudienceSecret` memoized pattern (purpose label `open-mercato:ai-safety-identifier:v1`, keyed off the auth secret); additive `LlmCreateModelOptions.endUserIdentifier?` + `LlmProvider.mapEndUserIdentifier?()` (OpenAI `safety_identifier`, Anthropic `metadata.user_id`); threaded through the orchestrator's model call. No PII, tenant-salted, never logged.
3. **Flag storage** — reuse `AgentGuardrailCheck` (`kind='moderation'`, append-only, dual-tenancy); `evidence` jsonb = `{ categories, scores }` only. No new `AiModerationFlag` table.
4. **Where the gate runs** — pre-call, pre-loop, inside the orchestrator's `INVOKE_AGENT` implementation via GUARD `GuardrailService.checkInput` (the `moderation` kind). Skip when the resolved provider lacks `supportsInputModeration`. `block` → fail step (typed reason) → retry/escalate/`USER_TASK`; `warn` → proceed + flag proposal; both emit `agent_orchestrator.guardrail.tripped` and append a check row. Policy precedence: `untrustedInput` enforced → tenant per-agent → tenant-wide → env default → off.

**Acceptance:**
- Flagged input on an enforced/`untrustedInput` surface is `block`ed before the model call; one `AgentGuardrailCheck{kind:'moderation',result:'block'}` is written with categories+scores and **no** prompt content; `guardrail.tripped` fires.
- On an opt-in surface, flagged input yields `warn`: the run proceeds and the proposal is flagged.
- Every model call carries a stable, tenant-salted `endUserIdentifier`; identical users in different tenants produce unrelated hashes; the raw user id is never sent.
- Tenants on a provider without `supportsInputModeration` skip the gate cleanly (no error); their identifier mapping is simply absent.
- Moderation outage on an enforced surface fails closed with a distinct "temporarily unavailable" message; an opt-in surface fails open with a warn log.
- All check rows carry `tenant_id` + `organization_id`; reads filter `organizationId`; second-tenant isolation probe passes.

## Changelog

- **2026-06-19:** Initial design analysis. Recommends a provider-agnostic `ModerationProvider` adapter defaulting to the free OpenAI moderations endpoint, a tenant-salted `endUserIdentifier` HMAC (reusing the `deriveJwtAudienceSecret` pattern) on every model call, and reuse of GUARD's `AgentGuardrailCheck` (`kind='moderation'`) for storage — superseding the 2026-06-04 draft's standalone `AiModerationFlag` table and `ai_assistant`-only framing. Rejected: fixed-OpenAI (lock-in), `integrations` adapter (boilerplate overkill for a singleton gate), LLM-judge as default (cost/latency — kept as a pluggable impl).
