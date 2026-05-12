# AI Agents — Per-Agent Provider, Model, and Base URL Overrides

> Scope: the unified AI framework introduced by `2026-04-11-unified-ai-tooling-and-subagents.md` and the LLM ports introduced by `2026-04-14-llm-provider-ports-and-adapters.md`.
> Out of scope (explicitly): the OpenCode Code Mode stack (Docker `opencode-mvp`, `docker/opencode/opencode.json`, `mcp:serve`, `mcp:dev`, `/api/chat` SSE). OpenCode keeps its current configuration verbatim; this spec touches only the new typed-agent runtime, the `model-factory`, and the LLM provider registry.

## TLDR

The new typed-agent framework currently picks a model the only way it knows how — "first provider with an API key, then `agent.defaultModel`, then the provider's hardcoded default." That is too rigid for three real use cases that already exist in the codebase or are being asked for now:

1. **Per-agent provider + model selection.** A `customers.account_assistant` may want `anthropic/claude-haiku-4-5-20251001` while `catalog.merchandising_assistant` wants `openai/gpt-5-mini`. Today the agent definition only carries a model id, and the provider is implicit ("first configured wins"), so two agents that need different providers cannot coexist in the same deployment unless one provider is unconfigured.
2. **Operator-level default in `.env`.** When several provider keys are set (Anthropic + OpenAI + Google + DeepInfra), there is no way for an operator to say "default to OpenAI." The picker walks registration order. The legacy `OPENCODE_PROVIDER` / `OPENCODE_MODEL` envs are honored only by `inbox_ops`'s shim — `createModelFactory` ignores them.
3. **Custom base URLs.** OpenRouter, LM Studio, vLLM, and self-hosted Anthropic/Gemini relays all rely on overriding the upstream `baseURL`. The OpenAI adapter only honors per-preset `baseURLEnvKeys` (Azure, LiteLLM, Ollama declare them; OpenAI/DeepInfra/Groq/Together/Fireworks do not). The Anthropic and Google adapters do not honor a base URL override at all. Agents cannot pin a base URL per-agent.

The fix is incremental and additive — every existing call site keeps working with no env changes. We add:

- **Phase 0** — a single `.env` knob (`OM_AI_PROVIDER` + `OM_AI_MODEL`) that selects the default provider/model used by `createModelFactory` when no caller / module / agent override is in play. Land this independently so ops can pin defaults today.
- **Phase 1** — `defaultProvider` on `AiAgentDefinition` plus a `<provider>/<model>` shorthand for `defaultModel`, threaded through `createModelFactory` via a new `agentDefaultProvider` resolution input. Per-module `<MODULE>_AI_PROVIDER` joins the existing `<MODULE>_AI_MODEL`.
- **Phase 2** — generic `baseURLEnvKeys` on every OpenAI-compatible preset (close the OpenAI/DeepInfra/Groq/Together/Fireworks gap), new built-in OpenRouter and LM Studio presets, and per-agent `baseURL` override threaded through `LlmCreateModelOptions` (already present on the port). Anthropic adapter gets `baseURL` support; Google stays as-is until the SDK ships an option.
- **Phase 3** — call-site cleanup: `agent-runtime.resolveAgentModel` migrates to `createModelFactory` (already flagged as a follow-up in the AI Assistant AGENTS.md), the routing route in `api/route/route.ts` honors `OM_AI_PROVIDER`, and the `inbox_ops` legacy path's order-of-preference lines up with the new factory.
- **Phase 4** — UX/docs: settings page becomes editable (per-tenant defaults stored in `ai_agent_runtime_overrides`), `<AiChat>` gains an inline provider/model picker, the agent dispatcher API accepts `provider` / `model` / `baseURL` query params, AGENTS.md and `.env.example` are updated, agent playground shows the resolved provider+model+baseURL per turn.

OpenCode is not touched.

### Runtime override surfaces (added in Phase 4)

Three new override surfaces sit on top of the env-driven defaults from Phases 0–2 so an operator can change provider/model/baseURL **without redeploying** and a power user can pick a model **per chat turn** without touching settings:

1. **Settings UI (per-tenant default)** — `/backend/config/ai-assistant` becomes editable. An admin with `ai_assistant.settings.manage` picks a default provider, model, and (optional) baseURL from the registered providers + their curated `defaultModels` catalogs. Stored in a new `ai_agent_runtime_overrides` row scoped per tenant (and optionally per agent). Sits between `<MODULE>_AI_PROVIDER` env (step 2) and `agent.defaultProvider` (step 3) in the resolution chain.
2. **Chat UI picker (per-turn override)** — `<AiChat>` exposes a small dropdown next to the input that lists the providers configured for the current tenant + each provider's curated models. The picker's selection is sent on every `POST /api/ai_assistant/ai/chat` call as `provider` / `model` query params. Highest priority — wins over everything else for that one turn. The picker is opt-in per agent via a new `AiAgentDefinition.allowRuntimeModelOverride?: boolean` flag (default `true`; agents that pin a specific model for correctness reasons opt out).
3. **API parameters** — `POST /api/ai_assistant/ai/chat?agent=<id>&provider=<id>&model=<id>&baseUrl=<url>` accepts the three override query params. They are validated against the tenant's allowlist (provider must be registered and configured; baseURL must match an env-allowlisted host pattern when set). Same flag (`allowRuntimeModelOverride`) gates this. Used by the chat UI picker, the playground, and any custom embedder.

## Overview

This spec extends the existing model-resolution chain in
`packages/ai-assistant/src/modules/ai_assistant/lib/model-factory.ts` from a 4-step
chain (caller → `<MODULE>_AI_MODEL` → `agentDefaultModel` → provider default)
into a 5-axis chain that resolves three things — **provider**, **model**, and
**base URL** — independently, with a clear precedence per axis.

The factory's current resolution chain is preserved for the model-id axis; the
new provider and baseURL axes follow the same precedence shape so future
contributors only learn one rule.

## Problem Statement

### P1 — Provider is implicit, not selectable per agent

`AiAgentDefinition` has `defaultModel?: string` but no `defaultProvider`. The
runtime calls `llmProviderRegistry.resolveFirstConfigured()` which iterates
registration order:

```
anthropic → google → openai → deepinfra → groq → together → fireworks → azure → litellm → ollama
```

If both `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` are set, every agent gets
Anthropic — even one whose `defaultModel` is `gpt-4o-mini`. The factory then
hands `'gpt-4o-mini'` to the Anthropic SDK, which rejects it. The current
inline `resolveAgentModel` in `agent-runtime.ts` has the same bug.

### P2 — No `.env` knob for the new framework's default provider

`OPENCODE_PROVIDER` is read by `resolveExtractionProviderId` (inbox_ops legacy
shim) and the AI Assistant settings page. It is **not** read by:

- `model-factory.ts` `createModelFactory(...)`
- `agent-runtime.ts` `resolveAgentModel(...)` (inline duplicate)
- `api/route/route.ts` (chat routing handler — uses
  `resolveFirstConfigured({ order: ['anthropic', 'openai', 'google'] })` with a
  hardcoded order)

So an operator who sets `OPENCODE_PROVIDER=openai` while keeping all keys
configured sees the legacy stack honor it and the new stack ignore it. This is
a foot-gun that we keep stepping on every time someone asks "why didn't my
default switch?"

### P3 — `<provider>/<model>` shorthand only works in legacy `inbox_ops`

The legacy `resolveOpenCodeModel(...)` parses tokens like
`openai/gpt-4.1-mini` into `{ providerPrefix, modelId }`, validates the prefix
matches the configured provider, and rejects mismatches. The new framework
does **not** parse `defaultModel` strings — it passes them straight to
`provider.createModel({ modelId })`. So a downstream module that copy-pastes
`defaultModel: 'openai/gpt-5-mini'` from an inbox_ops example silently sends
the literal string `openai/gpt-5-mini` to whatever provider happens to be
first.

### P4 — Base URL overrides are inconsistent

In `openai-compatible-presets.ts`:

| Preset    | `baseURL`                                    | `baseURLEnvKeys`              |
|-----------|----------------------------------------------|-------------------------------|
| openai    | `undefined` (uses SDK default)               | **none**                      |
| deepinfra | `https://api.deepinfra.com/v1/openai`        | **none**                      |
| groq      | `https://api.groq.com/openai/v1`             | **none**                      |
| together  | `https://api.together.xyz/v1`                | **none**                      |
| fireworks | `https://api.fireworks.ai/inference/v1`      | **none**                      |
| azure     | `undefined` (deployment-specific)            | `AZURE_OPENAI_BASE_URL` ✓     |
| litellm   | `http://localhost:4000/v1`                   | `LITELLM_BASE_URL` ✓          |
| ollama    | `http://localhost:11434/v1`                  | `OLLAMA_BASE_URL` ✓           |

So an operator who wants to point the OpenAI preset at OpenRouter
(`https://openrouter.ai/api/v1`) cannot — they must set `LITELLM_BASE_URL`
and `LITELLM_API_KEY` and pretend OpenRouter is LiteLLM. That is exactly the
kind of indirection we are supposed to be saving people from.

The Anthropic and Google adapters do not accept a `baseURL` argument at all —
so Anthropic-compatible relays (e.g., `claude-via-vercel-ai-gateway`,
`fireworks` Anthropic-format endpoints) cannot be used.

There is also no per-agent `baseURL`, so two agents in the same process
cannot point at different upstreams.

### P5 — Two slightly different default-provider walks coexist

- `model-factory.ts` does `registry.resolveFirstConfigured({ env })` with no
  order argument, falling through registration order.
- `api/route/route.ts` does `registry.resolveFirstConfigured({ order:
  ['anthropic', 'openai', 'google'] })` with a hardcoded order that excludes
  every OpenAI-compatible preset.
- `inbox_ops/lib/llmProvider.ts` does `resolveOpenCodeProviderId(process.env.OPENCODE_PROVIDER)`
  first, then falls back to `resolveFirstConfiguredOpenCodeProvider()` with
  the legacy 3-provider universe.

Three handlers, three answers. Phase 3 collapses them onto one rule.

## Proposed Solution

### Resolution chain — per axis

Each axis (provider, model, baseURL) walks the same precedence in priority
order. "None of the above" falls back to the provider's hardcoded default
(`provider.id`, `provider.defaultModel`, `provider.baseURL` respectively).

| # | Source                     | Provider axis | Model axis              | BaseURL axis              |
|---|----------------------------|---------------|-------------------------|---------------------------|
| 1 | Per-request HTTP query / chat-UI picker | `provider` query param (NEW Phase 4) | `model` query param (NEW Phase 4) | `baseUrl` query param (NEW Phase 4) |
| 2 | Caller override (programmatic) | `providerOverride` (NEW Phase 1) | `callerOverride` / `modelOverride` (existing) | `baseUrlOverride` (NEW Phase 2) |
| 3 | Per-tenant settings override (DB) | `ai_agent_runtime_overrides.provider_id` (NEW Phase 4) | `ai_agent_runtime_overrides.model_id` (NEW Phase 4) | `ai_agent_runtime_overrides.base_url` (NEW Phase 4) |
| 4 | `<MODULE>_AI_PROVIDER` env | NEW Phase 1   | `<MODULE>_AI_MODEL` (existing) | `<MODULE>_AI_BASE_URL` (NEW Phase 2) |
| 5 | Agent definition           | `agent.defaultProvider` (NEW Phase 1) | `agent.defaultModel` (existing — also accepts `<provider>/<model>`) | `agent.defaultBaseUrl` (NEW Phase 2) |
| 6 | Global `.env`              | `OM_AI_PROVIDER` (NEW Phase 0) | `OM_AI_MODEL` (NEW Phase 0) | per-preset `baseURLEnvKeys` (existing; expanded in Phase 2) |
| 7 | Provider hardcoded default | first configured (existing) | `provider.defaultModel` (existing) | `preset.baseURL` (existing) |

Steps 1 and 3 are gated by `AiAgentDefinition.allowRuntimeModelOverride` (default `true`). When the flag is `false`, steps 1 and 3 are skipped and the chain resumes at step 2 — agents that pin a specific model for correctness reasons (e.g., a structured-output agent whose JSON-mode schema only works with one model) opt out.

The `<provider>/<model>` shorthand is recognized at every model-axis source.
When present, it sets the provider for the same step and "consumes" the
provider axis for that step (a higher-priority provider source still wins,
but a lower-priority one cannot overwrite a slash-qualified model). This
matches the legacy opencode-provider mismatch check, but soft-fails by
preferring the higher-priority axis instead of throwing.

### Phasing rationale

Each phase ships independently and is reversible. The seams between phases
match the existing module boundaries — `shared/lib/ai/*` for the registry,
`packages/ai-assistant/src/modules/ai_assistant/lib/*` for the factory and
adapters — so a phase can be reverted by removing one diff without leaving
the others in an inconsistent state.

- **Phase 0** is the smallest deliverable that gives ops what they keep
  asking for: pin a default provider in `.env`. It costs ~30 lines in
  `model-factory.ts` and `llm-provider-registry.ts`. Land it first so the
  rest of the spec can build on a consistent default.
- **Phase 1** adds per-agent provider selection. This is the first
  user-visible feature. It lights up multi-provider deployments without
  touching base URLs.
- **Phase 2** adds base URL overrides and the OpenRouter / LM Studio
  presets. Independent of Phase 1 — an Anthropic-only deployment still
  wants OpenRouter for cost.
- **Phase 3** retires duplicate code paths. Pure refactor — no new behavior,
  no new envs.
- **Phase 4** is documentation and UX polish, lands last because it
  describes the state we just built.

## Architecture

### Phase 0 — `.env`-driven default provider/model (smallest unit)

Files touched:

| File | Change |
|------|--------|
| `packages/ai-assistant/src/modules/ai_assistant/lib/model-factory.ts` | (a) Read `OM_AI_PROVIDER` from env → if set, prepend it to the registry walk order. (b) Read `OM_AI_MODEL` → use as fallback model id (priority below `agentDefaultModel`, above `provider.defaultModel`). |
| `packages/shared/src/lib/ai/llm-provider-registry.ts` | No code change. The existing `resolveFirstConfigured({ env, order })` already accepts an order argument; the factory just supplies it from env. |
| `apps/mercato/.env.example` | Add commented `# OM_AI_PROVIDER=` and `# OM_AI_MODEL=` block with the same 8 examples already shown for `OPENCODE_MODEL`. |
| `packages/create-app/template/.env.example` | Same addition. |
| `packages/ai-assistant/src/modules/ai_assistant/api/route/route.ts` | Replace the hardcoded `order: ['anthropic', 'openai', 'google']` with the same env-aware resolver — single source of truth. |
| `packages/ai-assistant/AGENTS.md` | "How to Configure AI Providers" table gains the two new env vars. |
| `apps/docs/docs/framework/ai-assistant/overview.mdx` | Same. |

`OM_AI_PROVIDER` semantics: when set and resolves to a registered provider id, the factory passes it as the first element of `resolveFirstConfigured`'s `order` array; if the named provider is registered but unconfigured, the factory falls through to the next-best as today. When unset, behavior is unchanged. We deliberately do NOT alias `OPENCODE_PROVIDER` to the new var — the legacy var stays bound to the OpenCode stack so the two systems remain decoupled (see "Coexistence with OpenCode Code Mode" in `packages/ai-assistant/AGENTS.md`).

`OM_AI_MODEL` semantics: a plain model id (`gpt-5-mini`) is interpreted under the resolved provider; a slash-qualified id (`openai/gpt-5-mini`) overrides the resolved provider for that resolution only, just like Phase 1's per-agent slash form.

Tests:

- `model-factory.test.ts` (existing) — add cases for `OM_AI_PROVIDER` only, `OM_AI_MODEL` only, both, both with the named provider unconfigured (must fall through), and slash-qualified `OM_AI_MODEL` (must reset provider).
- `model-factory.integration.test.ts` — extend the integration smoke to assert resolution source = `'env_default'` (new enum member) when only the global env is set.

### Phase 1 — per-agent provider + `<provider>/<model>` shorthand

Files touched:

| File | Change |
|------|--------|
| `packages/ai-assistant/src/modules/ai_assistant/lib/ai-agent-definition.ts` | Add `defaultProvider?: string` to `AiAgentDefinition`. Doc-comment the slash-shorthand semantics for `defaultModel`. |
| `packages/core/src/modules/customers/ai-agents.ts` (and `catalog/ai-agents.ts`) | Local copies of `AiAgentDefinition` need the new field too — the type is duplicated in each module. Refactor candidate (Phase 3) to import from `@open-mercato/ai-assistant` instead. |
| `packages/ai-assistant/src/modules/ai_assistant/lib/model-factory.ts` | (a) Add `agentDefaultProvider?: string` to `AiModelFactoryInput`. (b) Add `<MODULE>_AI_PROVIDER` env axis. (c) Parse `<provider>/<model>` from any model-axis source and split into `{ providerHint, modelId }`. (d) The provider axis chooses the provider; if the chosen provider's `id` does not match a slash-qualified model's `providerHint` and the slash came from a higher-priority axis, the slash wins (logged at info level). |
| `packages/ai-assistant/src/modules/ai_assistant/lib/agent-runtime.ts` | `runAiAgentText` / `runAiAgentObject` accept optional `providerOverride?: string`. The Step-5.2 follow-up (migrate `resolveAgentModel` to `createModelFactory`) lands here. |
| `packages/ai-assistant/AGENTS.md` | "How to Add a New AI Agent" gets a one-line note about `defaultProvider` + slash shorthand. |
| `apps/docs/docs/framework/ai-assistant/agents.mdx` | Same. |

Backward compatibility: every existing field/env var keeps the same meaning. An agent that does not set `defaultProvider` and does not slash-qualify `defaultModel` resolves exactly as today.

Validation: `defaultProvider`, when set, must match a registered provider id at agent registration time (not at `defineAiAgent` call time — the registry is populated by `llm-bootstrap.ts` which runs before agents are loaded). The agent registry's existing `aggregateAiAgents` step validates this and logs an actionable warning when a provider id is unknown; the agent is registered with `defaultProvider: undefined` so the resolution chain still works.

Tests:

- `model-factory.test.ts` — add per-axis precedence cases for `<MODULE>_AI_PROVIDER`, `agentDefaultProvider`, slash-shorthand parsing, and the cross-axis tie-break (slash-qualified higher-priority model wins over lower-priority provider source).
- `agent-runtime.test.ts` (existing) — add a case where `agent.defaultProvider = 'openai'` and `agent.defaultModel = 'gpt-5-mini'` and only Anthropic is registration-first; the resolved model id and provider id must come from OpenAI.

### Phase 2 — base URL overrides + OpenRouter / LM Studio presets

Files touched:

| File | Change |
|------|--------|
| `packages/ai-assistant/src/modules/ai_assistant/lib/openai-compatible-presets.ts` | (a) Add `baseURLEnvKeys` to OPENAI/DEEPINFRA/GROQ/TOGETHER/FIREWORKS presets — `OPENAI_BASE_URL`, `DEEPINFRA_BASE_URL`, etc. The existing per-preset env conventions stay; the new one is additive. (b) Add `OPENROUTER_PRESET` (`baseURL: 'https://openrouter.ai/api/v1'`, `envKeys: ['OPENROUTER_API_KEY']`, `baseURLEnvKeys: ['OPENROUTER_BASE_URL']`, default model `meta-llama/llama-3.3-70b-instruct`). (c) Add `LM_STUDIO_PRESET` (`baseURL: 'http://localhost:1234/v1'`, `envKeys: ['LM_STUDIO_API_KEY']`, `baseURLEnvKeys: ['LM_STUDIO_BASE_URL']`, default model whatever the local user has loaded — empty default with a doc-comment). (d) Append both to `OPENAI_COMPATIBLE_PRESETS`. |
| `packages/ai-assistant/src/modules/ai_assistant/lib/llm-adapters/anthropic.ts` | Accept `baseURL` from `LlmCreateModelOptions` and forward to `createAnthropic({ apiKey, baseURL })`. `@ai-sdk/anthropic` already accepts `baseURL`. |
| `packages/ai-assistant/src/modules/ai_assistant/lib/llm-adapters/google.ts` | If `@ai-sdk/google` v1.x exposes `baseURL`, wire it. If not, document the limitation in the spec and the adapter file with a TODO comment that names the SDK version that ships it. |
| `packages/shared/src/lib/ai/llm-provider.ts` | `LlmCreateModelOptions.baseURL` already exists; doc-comment becomes prescriptive (every OpenAI-compatible adapter MUST honor it; Anthropic now also honors it; Google honors when SDK supports). |
| `packages/ai-assistant/src/modules/ai_assistant/lib/ai-agent-definition.ts` | Add `defaultBaseUrl?: string` (mirrors `defaultProvider`/`defaultModel`). |
| `packages/ai-assistant/src/modules/ai_assistant/lib/model-factory.ts` | Resolve baseURL through the same 5-step chain; pass it to `provider.createModel({ modelId, apiKey, baseURL })`. |
| `packages/ai-assistant/src/modules/ai_assistant/lib/agent-runtime.ts` | Optional `baseUrlOverride?: string` on `RunAiAgentTextInput` / `RunAiAgentObjectInput`. |
| `apps/mercato/.env.example` | Add `# OPENROUTER_API_KEY=` / `# OPENROUTER_BASE_URL=` / `# LM_STUDIO_API_KEY=` / `# LM_STUDIO_BASE_URL=` blocks; add `# OPENAI_BASE_URL=` next to `OPENAI_API_KEY` (and the same for DeepInfra / Groq / Together / Fireworks). |
| `packages/create-app/template/.env.example` | Same. |
| `packages/ai-assistant/AGENTS.md` | "How to Configure AI Providers" table gains baseURL columns; new presets are added to the matrix. |

Anthropic baseURL caveat: `@ai-sdk/anthropic`'s `baseURL` rewrites the API host but expects an Anthropic Messages-format wire protocol on the other side. This works for Anthropic-protocol relays (e.g., Cloudflare AI Gateway in Anthropic mode, Helicone proxy) but **not** for OpenRouter or LiteLLM in their default OpenAI mode — those need the OpenAI adapter and the OpenRouter preset. The doc-comment makes this explicit.

LM Studio specifics: the spec ships `LM_STUDIO_PRESET.defaultModel = ''` (empty string) plus a doc-comment that the local LM Studio HTTP API auto-detects the loaded model when the request body's `model` field is empty. The factory's slash-parser short-circuits empty model ids to "use provider default," so the existing chain already handles this without changes.

Tests:

- `openai.test.ts` adapter test — assert `baseURL` from the preset env override beats the preset default; per-call `baseURL` beats both.
- `anthropic.test.ts` — assert the adapter forwards `baseURL` to `createAnthropic`.
- New preset tests for OpenRouter and LM Studio that hit `isConfigured`, `getConfiguredEnvKey`, and `createModel` with both default and overridden base URLs.

### Phase 3 — call-site cleanup (no new behavior)

Files touched:

| File | Change |
|------|--------|
| `packages/ai-assistant/src/modules/ai_assistant/lib/agent-runtime.ts` | Replace inline `resolveAgentModel(...)` with `createModelFactory(container).resolveModel(...)`. The existing comment ("The agent-runtime.ts inline `resolveAgentModel` will migrate to `createModelFactory` in a follow-up Step (5.2+)") is removed because that follow-up is now done. |
| `packages/ai-assistant/src/modules/ai_assistant/api/route/route.ts` | Replace `resolveFirstConfigured({ order: ['anthropic', 'openai', 'google'] })` with a `createModelFactory`-driven helper that respects `OM_AI_PROVIDER`. |
| `packages/core/src/modules/inbox_ops/lib/llmProvider.ts` | The `tryFactoryResolution` short-circuit becomes the primary path; the legacy `resolveExtractionProviderId`/`resolveOpenCodeModel` fallback is preserved for backward compatibility with `OPENCODE_PROVIDER` / `OPENCODE_MODEL` consumers but its preference order is unified with the factory's (caller → `INBOX_OPS_AI_PROVIDER`/`INBOX_OPS_AI_MODEL` → agent default → `OM_AI_PROVIDER`/`OM_AI_MODEL` → `OPENCODE_*` legacy → first configured). |
| `packages/ai-assistant/AGENTS.md` | Remove the "will migrate in Step 5.2+" sentence; mark the migration as done in the changelog. |

This is the riskiest phase from a regression perspective because it changes the model-instantiation path for every existing agent. Mitigations are listed in Risks & Impact Review.

### Phase 4 — settings UI + chat picker + API + docs

Phase 4 ships in two PRs because it spans backend + frontend + docs and the data-model change benefits from landing first so the UI work has a stable target.

#### Phase 4a — backend (settings persistence + dispatcher API)

Files touched:

| File | Change |
|------|--------|
| `packages/ai-assistant/src/modules/ai_assistant/data/entities.ts` | Add `AiAgentRuntimeOverride` entity (table `ai_agent_runtime_overrides`). Columns below in **Data Models**. |
| `packages/ai-assistant/src/modules/ai_assistant/migrations/<date>_ai_agent_runtime_overrides.ts` | Auto-generated by `yarn db:generate`. |
| `packages/ai-assistant/src/modules/ai_assistant/data/repositories/AiAgentRuntimeOverrideRepository.ts` | `getDefault({ tenantId, organizationId, agentId? })`, `upsertDefault(...)`, `clearDefault(...)`. Tenant-scoped reads always intersect `tenant_id` to prevent cross-tenant leakage. |
| `packages/ai-assistant/src/modules/ai_assistant/lib/model-factory.ts` | New `tenantOverride?: { providerId?: string; modelId?: string; baseURL?: string }` input — wired by callers that have already loaded the override row. The factory does NOT load it itself (no DI dependency on `em`); the agent runtime is responsible for hydration. |
| `packages/ai-assistant/src/modules/ai_assistant/lib/agent-runtime.ts` | Hydrate the tenant override from `AiAgentRuntimeOverrideRepository` (best-effort, log + fall through on failure exactly like the existing prompt-override hydration), then pass it to `createModelFactory(...).resolveModel({ tenantOverride })`. Add `requestOverride?: { providerId, modelId, baseURL }` for HTTP-driven overrides — fed by the dispatcher route below. |
| `packages/ai-assistant/src/modules/ai_assistant/lib/ai-agent-definition.ts` | Add `allowRuntimeModelOverride?: boolean` (default `true` when omitted; falsy values disable steps 1 and 3 of the resolution chain). |
| `packages/ai-assistant/src/modules/ai_assistant/api/ai/chat/route.ts` (the typed-agent dispatcher introduced by `2026-04-11-unified-ai-tooling-and-subagents`) | Accept `provider`, `model`, `baseUrl` as **query params** (not body fields, so an SSE GET can use them too). Validate: provider must be in `llmProviderRegistry.list()` AND `isConfigured()` for the current env; model is a free-form string but logged when not in the provider's curated `defaultModels`; baseURL must (a) parse as a URL and (b) match the comma-separated allowlist `AI_RUNTIME_BASEURL_ALLOWLIST` when set (omitted → only providers' built-in baseURLs are reachable; the only way to send a baseURL value is to set the allowlist). Reject with `400` and a typed error code (`provider_not_configured` / `provider_unknown` / `baseurl_not_allowlisted` / `runtime_override_disabled`) when validation fails. |
| `packages/ai-assistant/src/modules/ai_assistant/api/settings/route.ts` | Add `PUT` and `DELETE` methods. `PUT` accepts a Zod-validated body `{ providerId?, modelId?, baseURL?, agentId? }` and upserts an `AiAgentRuntimeOverride`. `DELETE` clears it. Both gated by `ai_assistant.settings.manage`. The existing `GET` response is extended with `tenantOverride: { providerId?, modelId?, baseURL?, agentId? } | null` and `availableProviders[].defaultModels` (already on the registry, just not currently surfaced). |
| `packages/ai-assistant/src/modules/ai_assistant/api/settings/route.openapi.ts` (or inline `openApi` export) | Document the new methods + body schema. |
| `packages/ai-assistant/src/modules/ai_assistant/api/ai/agents/[agentId]/models/route.ts` | NEW. `GET /api/ai_assistant/ai/agents/:agentId/models` returns the providers + curated models the **chat UI picker** is allowed to show for this agent: filtered to providers that are `isConfigured()`, scoped to whatever `allowRuntimeModelOverride` permits, and including the agent's `defaultProvider`/`defaultModel` so the picker can show "(default)" next to the right row. RBAC: requires the same features as the agent itself. |
| `packages/ai-assistant/src/modules/ai_assistant/acl.ts` | No new feature (re-uses `ai_assistant.settings.manage` for write paths and `ai_assistant.view` for read paths). |

#### Phase 4b — frontend (chat picker + editable settings + playground panel)

Files touched:

| File | Change |
|------|--------|
| `packages/ui/src/ai/AiChat/AiChat.tsx` (or wherever the `<AiChat>` component lives) | Add a `<ModelPicker>` slot rendered inline next to the input. The picker fetches `/api/ai_assistant/ai/agents/:agentId/models`, shows providers as a header row + curated models as nested options, persists the selection in `localStorage` per `agentId`, and forwards `provider` / `model` / `baseUrl` query params on every chat-call. When `allowRuntimeModelOverride === false` (signaled by the agent metadata response), the picker hides itself entirely. |
| `packages/ui/src/ai/AiChat/ModelPicker.tsx` | NEW. Stateless dropdown component. Props: `agentId`, `value`, `onChange`, `availableProviders` (typed). Renders provider name + model id + "(default)" badge for the agent's resolved default. Keyboard-accessible (`Cmd+M` to open). |
| `packages/ai-assistant/src/modules/ai_assistant/frontend/components/AiAssistantSettingsPageClient.tsx` | Replaces today's read-only display with a `<CrudForm>` that lets `ai_assistant.settings.manage` users pick a default provider + model + (optional) baseURL for the tenant, and a per-agent override list ("agent X uses provider Y / model Z"). Saves via the new `PUT`. Shows the resolved per-agent table from Phase 4a's `GET` response so operators see the effective resolution after their save. |
| `packages/ai-assistant/src/modules/ai_assistant/backend/config/ai-assistant/playground/page.tsx` | Playground turn-summary panel adds "Provider/Model/BaseURL: x / y / z (source: Σ)" so operators can debug overrides without grepping logs. The playground also gets the same `<ModelPicker>` so operators can A/B-test models without leaving the page. |
| `packages/ai-assistant/src/modules/ai_assistant/i18n/<locale>.json` | Translation keys for picker labels, settings copy, and the new error codes from the dispatcher. |
| `apps/docs/docs/framework/ai-assistant/overview.mdx` | New section "Provider, model, and base URL resolution" with the 7-step table from this spec and worked examples covering all three runtime override surfaces. |
| `apps/docs/docs/framework/ai-assistant/agents.mdx` | New "Selecting a provider per agent" subsection + a "Letting users pick a model in chat" subsection that documents `allowRuntimeModelOverride` and the `<ModelPicker>` slot. |
| `apps/docs/docs/framework/ai-assistant/settings.mdx` | Update "What admins can change" to include the new editable provider/model/baseURL fields. |

Tests:

- `AiAgentRuntimeOverrideRepository.test.ts` — get/upsert/clear with cross-tenant isolation assertions.
- `model-factory.test.ts` — add cases for `tenantOverride` and `requestOverride`, including the `allowRuntimeModelOverride: false` short-circuit.
- `agent-runtime.test.ts` — runtime hydrates the override row exactly once per turn (caching is not needed because the row is tiny and chat turns are infrequent — measure first if this turns out to be hot).
- `api/ai/chat/route.test.ts` — query-param validation matrix for `provider`, `model`, `baseUrl`, including all four `400` error codes.
- `api/settings/route.test.ts` — `PUT` + `DELETE` happy path and ACL fail-closed.
- `AiAssistantSettingsPageClient.test.tsx` — admin user sees editable form; non-admin sees read-only view.
- `ModelPicker.test.tsx` — picker hides when `allowRuntimeModelOverride: false`; picker filters to configured providers.
- One Playwright integration test under `.ai/qa/`: "operator changes default provider in settings, then sends a chat turn, then sees the new provider in the playground summary."

## Data Models

Phases 0–3 introduce no schema changes — every change is in code, env, or
in-memory config.

Phase 4a adds **one additive table** for the editable per-tenant default,
sized to match the existing `ai_agent_prompt_overrides` /
`ai_agent_mutation_policy_overrides` tables introduced by
`2026-04-11-unified-ai-tooling-and-subagents`:

```
Table: ai_agent_runtime_overrides
- id                  uuid primary key
- tenant_id           uuid not null            -- always required
- organization_id     uuid null                -- null = tenant-wide
- agent_id            varchar(128) null        -- null = tenant default for ALL agents; non-null = agent-specific
- provider_id         varchar(64) null         -- null = inherit from lower-priority source
- model_id            varchar(256) null        -- null = inherit
- base_url            varchar(2048) null       -- null = inherit
- updated_by_user_id  uuid null
- created_at          timestamptz default now()
- updated_at          timestamptz default now()
- deleted_at          timestamptz null         -- soft delete
- unique (tenant_id, organization_id, agent_id) where deleted_at is null
```

All three value columns are nullable so an admin can override just the
provider, just the model, or any subset. `agent_id = null` means "tenant
default applied to every agent that does not have its own row." Resolution
prefers a non-null agent-specific row over the tenant-default row at lookup
time.

We deliberately do NOT extend the existing `ai_agent_prompt_overrides`
table because (a) prompt overrides are versioned + additive-merged and
provider/model selections are not, (b) the audit/visibility surface is
different (settings UI vs prompt editor), and (c) keeping them separate
makes deletes simple.

The Phase 1.4 agent-registry validation (provider id must match a
registered provider) is re-applied at write time in
`AiAgentRuntimeOverrideRepository.upsertDefault(...)` so an admin cannot
save a typo.

## API Contracts

Phases 0–3 add no new HTTP routes. Phase 4a adds three contract surfaces:

### 1. `GET /api/ai_assistant/settings` — additive response fields

```ts
{
  // existing fields untouched
  provider: { id, name, model, defaultModel, envKey, configured },
  availableProviders: Array<{
    id, name, defaultModel, envKey, configured,
    defaultModels: Array<{ id, name, contextWindow, tags? }>,  // NEW (already on registry, just surfaced)
  }>,
  mcpKeyConfigured: boolean,

  // NEW
  resolvedDefault: {
    providerId: string,
    modelId: string,
    baseURL: string | null,
    sources: { provider: 'request'|'caller'|'tenant_override'|'module_env'|'agent_default'|'env_default'|'first_configured', model: '...', baseURL: '...' },
  },
  tenantOverride: {
    providerId: string | null,
    modelId: string | null,
    baseURL: string | null,
    agentId: string | null,
    updatedAt: string,
  } | null,
  agents: Array<{
    agentId: string,
    moduleId: string,
    allowRuntimeModelOverride: boolean,
    providerId: string,
    modelId: string,
    baseURL: string | null,
    sources: { provider: '...', model: '...', baseURL: '...' },
  }>,
}
```

### 2. `PUT /api/ai_assistant/settings` — NEW

Body (Zod-validated):

```ts
{
  providerId?: string | null,   // null = clear this axis
  modelId?: string | null,
  baseURL?: string | null,
  agentId?: string | null,      // null = tenant default
}
```

Returns the updated `tenantOverride` row + the recomputed `resolvedDefault`
and `agents` arrays. Gated by `ai_assistant.settings.manage`.

### 3. `DELETE /api/ai_assistant/settings?agentId=<id>` — NEW

Clears the override row matching `(tenantId, organizationId, agentId)`. Returns
the recomputed resolution matrix. Gated by `ai_assistant.settings.manage`.

### 4. `GET /api/ai_assistant/ai/agents/:agentId/models` — NEW

Returns the providers + curated models the chat-UI picker may show:

```ts
{
  agentId: string,
  allowRuntimeModelOverride: boolean,
  providers: Array<{
    id: string,
    name: string,
    isDefault: boolean,           // matches resolved default for this agent
    models: Array<{ id, name, contextWindow, tags?, isDefault: boolean }>,
  }>,
}
```

ACL: requires the same features as the agent it describes (so a user who
cannot use the agent cannot enumerate its models).

### 5. `POST /api/ai_assistant/ai/chat?agent=<id>` — additive query params

Three new optional query params (NOT body fields, so the existing SSE
streaming contract is unchanged):

| Param      | Type    | Validation |
|------------|---------|------------|
| `provider` | string  | Must be a registered provider id AND `isConfigured()` for the current env. |
| `model`    | string  | Free-form. Logged at info level when not in the resolved provider's `defaultModels`. |
| `baseUrl`  | string  | Must parse as a URL AND match `AI_RUNTIME_BASEURL_ALLOWLIST` (comma-separated host patterns). When the env var is empty, any non-empty `baseUrl` query param is rejected with `baseurl_not_allowlisted`. |

Validation failures return `400` with one of:

- `runtime_override_disabled` — agent has `allowRuntimeModelOverride: false`.
- `provider_unknown` — provider id not registered.
- `provider_not_configured` — provider registered but no API key in env.
- `baseurl_not_allowlisted` — baseURL set but not in `AI_RUNTIME_BASEURL_ALLOWLIST`.

Per `BACKWARD_COMPATIBILITY.md` §7 (response fields and query params are
additive-only), all five surfaces are non-breaking.

### Error codes

`AiModelFactoryError` gains no new codes; the existing
`'no_provider_configured'` and `'api_key_missing'` continue to cover every
failure mode. Validation errors live at the dispatcher layer (with the four
codes above) so the factory stays input-validation-free.

## Implementation Tasks

The plan below is intentionally chunked so each task is a small commit and
each phase ends in a working build. Phases 0–4 are sequential; tasks within
a phase are mostly independent.

### Phase 0 — `.env`-driven defaults (1 PR)

- [ ] `0.1` Add `OM_AI_PROVIDER` + `OM_AI_MODEL` resolution to `model-factory.ts`. Add `'env_default'` to `AiModelResolution['source']` enum.
- [ ] `0.2` Update `model-factory.test.ts` with the 5 cases from "Phase 0 — Tests" above.
- [ ] `0.3` Update `model-factory.integration.test.ts` with one end-to-end smoke that sets `OM_AI_PROVIDER=openai` + only `OPENAI_API_KEY` and asserts the resolved model id round-trips.
- [ ] `0.4` Update `apps/mercato/.env.example` and `packages/create-app/template/.env.example`.
- [ ] `0.5` Update `packages/ai-assistant/AGENTS.md` "How to Configure AI Providers" table.
- [ ] `0.6` Update `apps/docs/docs/framework/ai-assistant/overview.mdx`.
- [ ] `0.7` `yarn typecheck && yarn test --selectProjects ai-assistant shared`.

### Phase 1 — per-agent provider + slash shorthand (1 PR)

- [ ] `1.1` Add `defaultProvider?: string` to `AiAgentDefinition` (canonical type).
- [ ] `1.2` Add slash-shorthand parser in `model-factory.ts` (`parseModelToken({ providerHint, modelId })`). Honor it at every model-axis source.
- [ ] `1.3` Add `agentDefaultProvider` and `<MODULE>_AI_PROVIDER` env axis to `AiModelFactoryInput`.
- [ ] `1.4` Wire `agent.defaultProvider` into the agent-registry validation step (`aggregateAiAgents`); log an actionable warning + register with `undefined` if unknown.
- [ ] `1.5` Wire `runAiAgentText` / `runAiAgentObject` to accept `providerOverride?: string` and pass it as `callerOverride` for the provider axis (not the model axis).
- [ ] `1.6` Update `model-factory.test.ts` and `agent-runtime.test.ts` with the cases from "Phase 1 — Tests."
- [ ] `1.7` Update `packages/ai-assistant/AGENTS.md` and `apps/docs/docs/framework/ai-assistant/agents.mdx`.
- [ ] `1.8` Update `customers/ai-agents.ts` and `catalog/ai-agents.ts` local `AiAgentDefinition` copies — track removal of these copies in Phase 3.
- [ ] `1.9` `yarn typecheck && yarn test --selectProjects ai-assistant shared core`.

### Phase 2 — baseURL overrides + OpenRouter / LM Studio (1 PR)

- [ ] `2.1` Add `baseURLEnvKeys` to OPENAI/DEEPINFRA/GROQ/TOGETHER/FIREWORKS presets.
- [ ] `2.2` Add `OPENROUTER_PRESET` and `LM_STUDIO_PRESET` to `openai-compatible-presets.ts`.
- [ ] `2.3` Add `baseURL` plumbing to `anthropic.ts` adapter (forward to `createAnthropic`).
- [ ] `2.4` Investigate `@ai-sdk/google` v1.x `baseURL` support; if present, wire it; if absent, add a TODO comment with the SDK version target.
- [ ] `2.5` Add `defaultBaseUrl?: string` to `AiAgentDefinition`.
- [ ] `2.6` Add baseURL axis to `model-factory.ts` and pass through `provider.createModel({ baseURL })`.
- [ ] `2.7` Add `baseUrlOverride?: string` to `RunAiAgentTextInput` / `RunAiAgentObjectInput`.
- [ ] `2.8` Add adapter tests (openai.test.ts, anthropic.test.ts, openrouter / lm-studio preset tests).
- [ ] `2.9` Update `.env.example` files and `packages/ai-assistant/AGENTS.md`.
- [ ] `2.10` `yarn typecheck && yarn test`.

### Phase 3 — call-site cleanup (1 PR)

- [ ] `3.1` Migrate `agent-runtime.resolveAgentModel` to `createModelFactory`. Delete the inline duplicate.
- [ ] `3.2` Replace `api/route/route.ts`'s hardcoded `order` walk with the factory.
- [ ] `3.3` Unify `inbox_ops/lib/llmProvider.ts` resolution order with the factory; legacy `OPENCODE_PROVIDER` / `OPENCODE_MODEL` move to step 5 (after `AI_DEFAULT_*`) instead of step 1.
- [ ] `3.4` Remove the duplicate `AiAgentDefinition` shapes in `customers/ai-agents.ts` and `catalog/ai-agents.ts`; both import from `@open-mercato/ai-assistant`.
- [ ] `3.5` Update `packages/ai-assistant/AGENTS.md` to mark the Step 5.2 follow-up as done; add changelog entry.
- [ ] `3.6` Run `yarn test` and the integration suite for `inbox_ops`, `agent-runtime`, `agent-runtime-object`, `model-factory`, `chat-config`, and `route` route tests.

### Phase 4a — backend persistence + dispatcher API (1 PR)

- [ ] `4a.1` Add `AiAgentRuntimeOverride` MikroORM entity + `yarn db:generate` migration.
- [ ] `4a.2` `AiAgentRuntimeOverrideRepository` with `getDefault` / `upsertDefault` / `clearDefault` and tenant-scope guards.
- [ ] `4a.3` `model-factory.ts` accepts `tenantOverride` and `requestOverride` inputs; resolution chain steps 1 + 3 honor them; `allowRuntimeModelOverride: false` short-circuits steps 1 + 3.
- [ ] `4a.4` `agent-runtime.ts` hydrates the override row from the repository per turn and threads `requestOverride` from the dispatcher.
- [ ] `4a.5` `AiAgentDefinition.allowRuntimeModelOverride?: boolean` (default `true`).
- [ ] `4a.6` Dispatcher route `api/ai/chat/route.ts` accepts `provider` / `model` / `baseUrl` query params with the four typed `400` error codes.
- [ ] `4a.7` `AI_RUNTIME_BASEURL_ALLOWLIST` env var read in the dispatcher.
- [ ] `4a.8` `PUT` and `DELETE` methods on `/api/ai_assistant/settings` + Zod body schema + `ai_assistant.settings.manage` gate.
- [ ] `4a.9` Extend `GET /api/ai_assistant/settings` response with `resolvedDefault`, `tenantOverride`, `agents[]`, and `availableProviders[].defaultModels`.
- [ ] `4a.10` `GET /api/ai_assistant/ai/agents/:agentId/models` route.
- [ ] `4a.11` Update `openApi` exports for all changed routes.
- [ ] `4a.12` Tests: `AiAgentRuntimeOverrideRepository.test.ts`, `model-factory.test.ts` (override cases), `agent-runtime.test.ts` (hydration + per-turn request override), `api/ai/chat/route.test.ts` (query-param validation), `api/settings/route.test.ts` (PUT/DELETE + ACL).
- [ ] `4a.13` `yarn typecheck && yarn db:migrate && yarn test`.

### Phase 4b — chat picker + editable settings + playground panel + docs (1 PR)

- [ ] `4b.1` `<ModelPicker>` component (stateless, keyboard-accessible, `localStorage`-persisted per agent).
- [ ] `4b.2` Wire `<ModelPicker>` into `<AiChat>` — fetches `/api/ai_assistant/ai/agents/:agentId/models`, sends `provider` / `model` / `baseUrl` on every chat call. Hides itself when `allowRuntimeModelOverride: false`.
- [ ] `4b.3` Editable `AiAssistantSettingsPageClient.tsx` (CrudForm-based) saving via `PUT`.
- [ ] `4b.4` Add per-agent override list in settings UI; add "clear" action that calls `DELETE`.
- [ ] `4b.5` Playground turn-summary panel "Provider/Model/BaseURL: x / y / z (source: Σ)".
- [ ] `4b.6` Add `<ModelPicker>` to the playground.
- [ ] `4b.7` i18n keys for picker + settings + 4 dispatcher error codes.
- [ ] `4b.8` `apps/docs/docs/framework/ai-assistant/overview.mdx` — full 7-step resolution table + worked examples.
- [ ] `4b.9` `apps/docs/docs/framework/ai-assistant/agents.mdx` — "Selecting a provider per agent" + "Letting users pick a model in chat" subsections.
- [ ] `4b.10` `apps/docs/docs/framework/ai-assistant/settings.mdx` — admin-editable provider/model/baseURL.
- [ ] `4b.11` Component tests (`AiAssistantSettingsPageClient.test.tsx`, `ModelPicker.test.tsx`).
- [ ] `4b.12` Playwright integration test under `.ai/qa/`: settings change → chat turn → playground summary reflects new provider.
- [ ] `4b.13` Changelog entry per the `auto-update-changelog` convention.

## Risks & Impact Review

### R1 — Phase 3 silently changes the model picked by an existing agent (HIGH)

**Failure scenario.** A deployment has `ANTHROPIC_API_KEY` set, plus
`OPENCODE_PROVIDER=openai` (because the operator set it years ago for
inbox_ops) and `OPENAI_API_KEY` also set. Before Phase 3, the new framework
ignores `OPENCODE_PROVIDER` and picks Anthropic; after Phase 3, the unified
chain reads `OM_AI_PROVIDER` (unset) and continues to pick Anthropic —
**but** if Phase 0 adds `OM_AI_PROVIDER` aliasing to `OPENCODE_PROVIDER`
(it does not, per the explicit non-aliasing decision above), behavior would
flip to OpenAI for every agent. We catch this by **not** aliasing — the spec
is explicit on this point and Phase 0 keeps the legacy var bound to the
OpenCode stack only. Residual risk: an operator who reads the new env doc
and sets `OM_AI_PROVIDER=openai` deliberately gets the OpenAI default,
which is the intended behavior.

**Mitigation.** (a) Phase 4's settings page surfaces the resolved per-agent
provider so an operator immediately sees a discrepancy. (b) The integration
test smoke in Phase 0.3 asserts the default flips when the env is set. (c) The
release notes paragraph spells this out.

**Severity.** HIGH. **Affected area.** Every agent in the new framework + every
inbox_ops extraction call. **Residual risk.** LOW after the Phase 0 explicit
non-aliasing rule.

### R2 — Slash-shorthand parsing collides with model ids that already contain slashes (MEDIUM)

**Failure scenario.** DeepInfra model ids contain slashes (`zai-org/GLM-5.1`,
`meta-llama/Llama-4-Scout-17B-16E-Instruct`). A naive `String.indexOf('/')`
splits these into `{ providerHint: 'zai-org', modelId: 'GLM-5.1' }` which is
wrong.

**Mitigation.** The parser only treats the segment before the first slash as
a `providerHint` if it matches a registered provider id. Otherwise the entire
string is the modelId. The existing `parseModelToken` in
`opencode-provider.ts` does not have this guard, but its consumers (only
`inbox_ops` legacy) only see Anthropic/OpenAI/Google ids which never contain
slashes — so the bug never manifested. The new parser MUST guard.

**Severity.** MEDIUM. **Affected area.** DeepInfra / Together / Fireworks
users. **Residual risk.** LOW after the registry-membership guard, plus
explicit unit tests for `zai-org/GLM-5.1` and
`meta-llama/Llama-3.3-70B-Instruct-Turbo`.

### R3 — Anthropic adapter `baseURL` works for Messages-protocol relays only (LOW)

**Failure scenario.** An operator sets a custom Anthropic baseURL pointing at
OpenRouter (`https://openrouter.ai/api/v1`). OpenRouter rejects the
Anthropic Messages payload because it expects OpenAI chat-completions JSON.

**Mitigation.** Doc-comment in `anthropic.ts` and a paragraph in the
Phase 4 docs explicitly say "Anthropic baseURL is for Anthropic-protocol
relays only; for OpenAI-format gateways use the OpenAI / OpenRouter presets."

**Severity.** LOW. **Affected area.** Operators who confuse the two. **Residual
risk.** LOW with the doc-comment.

### R4 — `<MODULE>_AI_PROVIDER` collides with future env conventions (LOW)

**Failure scenario.** A future module named `ai_default` would shadow
`AI_DEFAULT_AI_MODEL` and `AI_DEFAULT_AI_PROVIDER` against the global env
var.

**Mitigation.** The spec reserves `AI_DEFAULT_*` as a global namespace; the
module-id-prefixed envs always include the moduleId verbatim, so a module
named `ai_default` would resolve `AI_DEFAULT_AI_PROVIDER` (uppercased
moduleId + `_AI_PROVIDER`), not `OM_AI_PROVIDER`. The collision is only
hypothetical until someone adds such a module; if they do, the global wins
and we revisit.

**Severity.** LOW. **Affected area.** Hypothetical. **Residual risk.** LOW.

### R5 — Phase 1's local `AiAgentDefinition` duplicates drift (LOW, time-limited)

**Failure scenario.** `customers/ai-agents.ts` defines a local
`AiAgentDefinition` shape independently from the canonical one in
`packages/ai-assistant`. Phase 1 adds `defaultProvider` to the canonical type
but a contributor forgets to add it to the local copies; their agent
silently ignores `defaultProvider`.

**Mitigation.** Phase 1.8 updates the duplicates as part of the same PR;
Phase 3.4 removes the duplicates entirely. Until Phase 3 lands, the
duplicates are flagged in `packages/ai-assistant/AGENTS.md` "How to Add a New
AI Agent" with a TODO link to this spec.

**Severity.** LOW. **Affected area.** Modules that fork the type definition.
**Residual risk.** ZERO after Phase 3.4.

### R6 — Per-request `baseUrl` override is a credential-exfiltration vector (HIGH)

**Failure scenario.** A user with chat access sends `?baseUrl=https://attacker.example.com/v1`. The agent's API key (loaded from server-side env) is forwarded to the attacker's host as a Bearer token. This is a classic SSRF-adjacent credential leak.

**Mitigation.** (a) `baseUrl` query param is gated by `AI_RUNTIME_BASEURL_ALLOWLIST` — when the env var is empty, ANY `baseUrl` query value is rejected with `baseurl_not_allowlisted`. (b) The same allowlist is enforced in the `PUT /api/ai_assistant/settings` body validator so an admin cannot save an attacker-controlled host either. (c) The allowlist is host-pattern based (no path / query matching) so a single allowed origin cannot be exploited with path tricks. (d) The `<ModelPicker>` UI does NOT expose a baseURL input — only provider+model — so end users cannot send `baseUrl` from the chat picker by default; the param exists for programmatic embedders that have already vetted the URL.

**Severity.** HIGH. **Affected area.** Any deployment that exposes the chat dispatcher to non-admin users. **Residual risk.** LOW with the env-allowlist guard, ZERO when `AI_RUNTIME_BASEURL_ALLOWLIST` is unset (the default).

### R7 — Per-turn `provider`/`model` override lets users burn budget on expensive flagship models (MEDIUM)

**Failure scenario.** A tenant configures the cheap default `gpt-4o-mini` but a user sends `?model=gpt-5` on every turn. Cost spikes, no audit trail.

**Mitigation.** (a) The `<ModelPicker>` UI only lists models from the providers' curated `defaultModels` arrays — it does not expose a free-form input — so users can only pick from a vetted catalog. (b) The dispatcher logs the resolved `(providerId, modelId, source)` on every turn at info level so a billing audit can attribute spend to overrides. (c) Agents that pin a model for cost reasons set `allowRuntimeModelOverride: false`. (d) A future spec can add per-tenant model allowlists to `ai_agent_runtime_overrides` if (b) + (c) prove insufficient — out of scope here.

**Severity.** MEDIUM. **Affected area.** Tenants who delegate chat access broadly. **Residual risk.** MEDIUM until a per-tenant model allowlist lands; documented as a known limitation in the Phase 4b docs.

### R8 — Backward compatibility (per `BACKWARD_COMPATIBILITY.md`)

This spec is fully additive against all 13 contract surfaces:

- §1 Auto-discovery file conventions: unchanged.
- §2 Type definitions: `AiAgentDefinition`, `AiModelFactoryInput`,
  `AiModelResolution` gain optional fields and a new enum value
  (`'env_default'`). Optional-additive only.
- §3 Function signatures: `createModelFactory` and `provider.createModel`
  signatures unchanged; new optional params on input shapes.
- §4 Import paths: unchanged.
- §5 Event IDs: unchanged.
- §6 Widget injection spot IDs: unchanged.
- §7 API route URLs: `/api/ai_assistant/settings` GET response gains
  additive fields.
- §8 Database schema: Phase 4a adds the additive `ai_agent_runtime_overrides` table. No existing column/table is renamed or removed.
- §9 DI service names: unchanged.
- §10 ACL feature IDs: unchanged.
- §11 Notification type IDs: unchanged.
- §12 CLI commands: unchanged.
- §13 Generated file contracts: `ai-agents.generated.ts` continues to
  re-export `AiAgentDefinition` from each module; once Phase 3.4 collapses
  the duplicates, downstream apps that import the type directly from a core
  module path get a re-export from `@open-mercato/ai-assistant` (still
  named-export `AiAgentDefinition`), so no breakage.

No deprecation protocol is required because nothing is removed or
narrowed. Phase 3 retires duplicate code paths but every public function
keeps its name and input shape.

## Final Compliance Report

- **Spec naming**: file is `2026-04-27-ai-agents-provider-model-baseurl-overrides.md`, in `.ai/specs/` (OSS). Compliant with `.ai/specs/AGENTS.md` rules.
- **Required sections**: TLDR ✓, Overview ✓, Problem Statement ✓, Proposed Solution ✓, Architecture ✓, Data Models ✓, API Contracts ✓, Risks & Impact Review ✓, Final Compliance Report ✓, Changelog ✓.
- **Phasing**: 5 phases, each ships independently. Tasks are checkboxed.
- **Backward compatibility**: all 13 surfaces in `BACKWARD_COMPATIBILITY.md` reviewed; this spec is additive-only.
- **Out of scope**: OpenCode Code Mode (Docker, `mcp:*` CLIs, `/api/chat`, `docker/opencode/opencode.json`) — explicitly preserved verbatim.
- **Pre-implementation analysis recommended**: yes — run the `pre-implement-spec` skill against this file before kicking off Phase 0 to confirm the resolution-chain table matches the contributor's mental model and to surface any missed call sites that grep didn't catch.
- **Integration coverage**: Phase 0 + Phase 1 add unit tests in `model-factory.test.ts` and `agent-runtime.test.ts`. Phase 2 adds adapter tests. Phase 4 adds a settings-route response test. No new HTTP routes, so no new Playwright integration tests are required; the existing AI Assistant suite covers the playground UI.

## Changelog

- **2026-04-27** — Initial draft. Authored after a survey that found three independent gaps in the new typed-agent framework (no per-agent provider, no `.env`-driven default for the new framework, no consistent baseURL story). Phasing chosen so Phase 0 ships value in <30 lines and the riskier call-site unification is deferred to Phase 3 with mitigations.
- **2026-04-27** — Phase 4 expanded into 4a (backend persistence + dispatcher API) and 4b (chat picker + editable settings + playground panel + docs) after feedback that runtime override surfaces (chat-UI picker, editable settings UI, API query params) were missing. Added `ai_agent_runtime_overrides` table, `allowRuntimeModelOverride` flag, `AI_RUNTIME_BASEURL_ALLOWLIST` env, and risks R6 (credential exfiltration via `baseUrl`) and R7 (cost burn via flagship model override). Resolution chain extended from 5 to 7 steps.
- **2026-05-11** — Phase 0 env var names renamed during PR #1856 review. Process-wide knobs are now `OM_AI_PROVIDER` / `OM_AI_MODEL` (legacy `OPENCODE_PROVIDER` / `OPENCODE_MODEL` honored as BC fallbacks) and per-module overrides are `OM_AI_<MODULE>_MODEL` (legacy `<MODULE>_AI_MODEL` honored as BC fallback). Aligns Phase 0 with the existing `OM_*` env convention used by the rest of the runtime (`OM_SEARCH_*`, `OM_SECURITY_*`, `OM_ENABLE_*`). The PR also bumped scope to thread the new vars through `docker-compose.yml`, `docker-compose.fullapp*.yml`, `docker/opencode/entrypoint.sh`, `.devcontainer/devcontainer.json`, and the `create-mercato-app` standalone template so a deployment that only sets `OPENAI_API_KEY` resolves to OpenAI + `gpt-5-mini` out of the box.
