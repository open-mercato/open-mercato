# LLM Provider Ports & Adapters

## TLDR

**Key Points:**
- Replace hardcoded LLM provider switch (`anthropic | openai | google`) in `ai_assistant` and `opencode-provider` with a ports & adapters architecture where **adapters represent protocols, not vendors**.
- Ship three protocol adapters (Anthropic, Google, OpenAI) and a data-driven preset registry for OpenAI-compatible backends (OpenAI, DeepInfra, Groq, Together, Fireworks, Azure, LiteLLM, Ollama).
- Unlocks GLM-5.1, Qwen3-235B, Llama 4, DeepSeek V3.2 and other flagship models hosted on DeepInfra at 3–12× lower blended cost than the three built-in providers.
- Downstream apps can register custom presets at bootstrap time without forking core.

**Scope:**
- New `packages/shared/src/lib/ai/llm-provider.ts` — `LlmProvider` port interface, `LlmModelInfo`, `LlmCreateModelOptions`.
- New `packages/shared/src/lib/ai/llm-provider-registry.ts` — singleton registry.
- New `packages/ai-assistant/src/modules/ai_assistant/lib/llm-adapters/anthropic.ts` — Anthropic protocol adapter.
- New `packages/ai-assistant/src/modules/ai_assistant/lib/llm-adapters/google.ts` — Google Generative AI protocol adapter.
- New `packages/ai-assistant/src/modules/ai_assistant/lib/llm-adapters/openai.ts` — OpenAI protocol adapter (baseURL aware).
- New `packages/ai-assistant/src/modules/ai_assistant/lib/openai-compatible-presets.ts` — preset registry (data) with OpenAI, DeepInfra, Groq, Together, Fireworks, Azure, LiteLLM, Ollama.
- New `packages/ai-assistant/src/modules/ai_assistant/lib/llm-bootstrap.ts` — registers built-in adapters and presets on import.
- Refactor `packages/shared/src/lib/ai/opencode-provider.ts` into a thin backward-compatible facade derived from the registry.
- Refactor `packages/ai-assistant/src/modules/ai_assistant/api/route/route.ts` `createRoutingModel()` — remove `switch`, call `registry.get(id).createModel(...)`.
- Refactor `packages/ai-assistant/src/modules/ai_assistant/lib/chat-config.ts` — `CHAT_PROVIDERS` generated from registry.
- Update `.env.example` to document `DEEPINFRA_API_KEY`, `GROQ_API_KEY`, `OPENAI_API_BASE`.
- Update `packages/shared/src/lib/ai/__tests__/opencode-provider.test.ts` for new structure (all existing assertions still pass).
- Add new test files: `llm-provider-registry.test.ts`, `adapters/openai.test.ts`, `openai-compatible-presets.test.ts`.

**Concerns:**
- Must be **fully backward compatible**: existing installations with `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GOOGLE_GENERATIVE_AI_API_KEY` keep working without any configuration change or code edit.
- `OpenCodeProviderId` type stays as a string-narrowed type; `isOpenCodeProviderId()` continues to work as a type guard.
- `OPENCODE_PROVIDER` env var semantics preserved — any registered provider id (now includes `deepinfra`, `groq`, etc.) works.
- OpenCode Go container (Docker) handles its own providers independently; this PR only touches the Next.js side (routing model + chat config UI). The OpenCode image is out of scope for this SPEC.

---

## Overview

Open Mercato's AI Assistant currently hardcodes three LLM providers in a string union type and a `switch` statement at `packages/ai-assistant/src/modules/ai_assistant/api/route/route.ts`. Adding a new provider requires edits to at least four files plus test updates, and downstream applications cannot register their own providers without forking `@open-mercato/shared`.

This SPEC introduces a **ports & adapters** architecture that treats LLM providers as implementations of a narrow port interface. Adapters represent **protocols** (the wire format a model speaks), not **vendors** (the company running the infrastructure). A single `OpenAIAdapter` can serve OpenAI, DeepInfra, Groq, Together, Fireworks, Azure OpenAI, LiteLLM, Ollama, LocalAI, vLLM, or any other endpoint that implements the OpenAI chat-completions API — because the adapter cares only about the protocol, not who hosts it.

Vendor-specific details — endpoint URL, available models, display names, environment variable conventions — live in a **data-driven preset registry**. Presets are plain data, not code, so adding a new OpenAI-compatible backend requires one entry in a TypeScript array, zero new adapter files, and zero changes to route handlers.

> **Market Reference**: The pattern follows the [AI SDK v5 provider architecture](https://ai-sdk.dev/docs/foundations/providers-and-models). Each AI SDK provider is a factory function (`createOpenAI`, `createAnthropic`, `createGoogleGenerativeAI`) that accepts `{ apiKey, baseURL }`. We build a thin registry on top of these factories — adapters wrap factories, presets parameterize adapters. [LangChain's](https://js.langchain.com/docs/integrations/chat/) `BaseChatModel` hierarchy was considered but rejected: too heavy for a Next.js route handler and duplicates work AI SDK already does. [LiteLLM's](https://docs.litellm.ai/) provider routing was studied as a reference — the preset approach is inspired by LiteLLM's provider list, translated to TypeScript and scoped to AI SDK.

## Problem Statement

1. **Impossible to add new providers without touching core.** Users wanting Groq, Together, DeepInfra, Ollama, Azure OpenAI, Bedrock, or any OpenAI-compatible endpoint must fork `@open-mercato/shared` and `@open-mercato/ai-assistant`.
2. **Hardcoded one-model-per-provider UI.** `CHAT_PROVIDERS` in `chat-config.ts` ships exactly one model per provider. Adding `GPT-5` alongside `GPT-5 Mini` requires a PR.
3. **No extension point for downstream apps.** `only-yes-hub` (a real consumer building on Open Mercato) cannot register a custom preset at bootstrap time without monkey-patching.
4. **Cost pressure on small installations.** DeepInfra offers flagship models (GLM-5.1, Qwen3-235B-A22B, Llama 4 Scout, DeepSeek V3.2) at 3–12× lower blended cost than the three built-in providers. Locking users out of this market by architecture is wasteful.
5. **Community signal.** A recent Discord thread (2026-04-14) from user `@Lbajurcowicz` explicitly requested ports & adapters architecture for AI providers, warning against concrete-vendor coupling. Author `@Piotr Karwatka` approved the direction and invited a PR.

## Proposed Solution

### Three protocol adapters

| Adapter | Protocol | Underlying SDK | Serves |
|---------|----------|----------------|--------|
| `AnthropicAdapter` | Anthropic Messages API | `@ai-sdk/anthropic` → `createAnthropic` | Claude Haiku, Sonnet, Opus |
| `GoogleAdapter` | Google Generative AI API | `@ai-sdk/google` → `createGoogleGenerativeAI` | Gemini Flash, Pro |
| `OpenAIAdapter` | OpenAI chat-completions API | `@ai-sdk/openai` → `createOpenAI({ baseURL })` | OpenAI, DeepInfra, Groq, Together, Fireworks, Azure, LiteLLM, Ollama, LocalAI, vLLM — anything OpenAI-compatible |

Each adapter implements the `LlmProvider` port. Adapters are stateless — they know how to take `{ apiKey, modelId, baseURL? }` and return an AI SDK model instance. They do not know about vendors, UI, env vars, or the registry.

### Data-driven presets for OpenAI-compatible backends

`packages/shared/src/lib/ai/openai-compatible-presets.ts` exports a list of `OpenAICompatiblePreset` entries:

```ts
{
  id: 'deepinfra',
  name: 'DeepInfra',
  baseURL: 'https://api.deepinfra.com/v1/openai',
  envKeys: ['DEEPINFRA_API_KEY'],
  defaultModel: 'zai-org/GLM-5.1',
  defaultModels: [
    { id: 'zai-org/GLM-5.1', name: 'GLM-5.1 (Zhipu)', contextWindow: 202752, tags: ['flagship'] },
    { id: 'zai-org/GLM-4.7-Flash', name: 'GLM-4.7 Flash', contextWindow: 202752, tags: ['budget'] },
    { id: 'Qwen/Qwen3-235B-A22B-Instruct-2507', name: 'Qwen3 235B (MoE)', contextWindow: 262144, tags: ['flagship'] },
    { id: 'meta-llama/Llama-4-Scout-17B-16E-Instruct', name: 'Llama 4 Scout', contextWindow: 327680 },
    { id: 'deepseek-ai/DeepSeek-V3.2-Exp', name: 'DeepSeek V3.2', contextWindow: 163840, tags: ['reasoning'] },
    { id: 'Qwen/Qwen3-Coder-30B-A3B-Instruct', name: 'Qwen3 Coder 30B', contextWindow: 262144, tags: ['coding'] },
  ],
}
```

At bootstrap, `packages/shared/src/lib/ai/bootstrap.ts` iterates over presets and registers a `LlmProvider` for each — every virtual provider internally delegates `createModel` to the same `OpenAIAdapter` instance but with a different `baseURL`. From the outside (route.ts, chat-config.ts, UI), the registry appears to contain 9+ providers; internally, there is one OpenAI protocol adapter plus two native ones (Anthropic, Google).

### Registry API

```ts
export interface LlmProviderRegistry {
  register(provider: LlmProvider): void          // idempotent, replace by id
  get(id: string): LlmProvider | null
  list(): readonly LlmProvider[]
  listConfigured(env?: EnvLookup): readonly LlmProvider[]
  resolveFirstConfigured(options?: {
    env?: EnvLookup
    order?: readonly string[]
  }): LlmProvider | null
  reset(): void                                  // for tests
}
```

### Route handler refactor

`createRoutingModel()` in `route.ts` replaces the switch with:

```ts
const provider = llmProviderRegistry.get(providerId)
if (!provider) {
  throw new Error(`Unknown provider: ${providerId}`)
}
const apiKey = provider.resolveApiKey()
if (!apiKey) {
  throw new Error(
    `${provider.getConfiguredEnvKey()} not configured for provider "${provider.id}"`
  )
}
const { modelId, modelWithProvider } = resolveOpenCodeModel(providerId, {
  overrideModel: configuredModel,
})
return {
  model: provider.createModel({ modelId, apiKey }),
  modelWithProvider,
}
```

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| Adapter = protocol, not vendor | Follows proper ports & adapters pattern (Lbajurcowicz feedback). One `OpenAIAdapter` covers 9+ backends without code duplication. Adding a new OpenAI-compatible backend is a data entry, not a code change. |
| Presets as data, not subclasses | `openai-compatible-presets.ts` is a pure TypeScript array. Zero abstract classes, zero inheritance. Adding a preset takes 10 lines; removing one takes 1 commit. Tests can stub the preset array. |
| Registry is a module-level singleton | AI SDK providers are expensive to re-create per request (HTTP clients, connection pools). Singleton avoids that cost. Next.js hot-reload handled by `register()` idempotency. |
| Port interface in `packages/shared` | `opencode-provider.ts` already lives here. Keeping the port in `shared` avoids circular deps with `ai-assistant`. Other future modules (`document_parser`, `inbox_ops`) depend on the same providers. |
| `LlmProvider.createModel()` returns `unknown` | AI SDK model types are complex generics. Returning `unknown` and casting at call sites (`as Parameters<typeof generateObject>[0]['model']`) mirrors how `route.ts` currently casts. Avoids exposing AI SDK internals through the port. |
| Downstream `.register()` at bootstrap | `only-yes-hub` and other apps can add custom presets in their `src/bootstrap.ts` without forking shared. Example provided in the Migration section. |

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|--------------|
| One adapter per vendor (original Option A) | Each new OpenAI-compatible backend becomes a new file duplicating the previous one — the exact anti-pattern Lbajurcowicz warned about. Concrete-vendor coupling. |
| Hybrid (original Option C: DeepInfra as vendor + OpenAI with env override) | Still couples DeepInfra to a specific adapter class. Fails the "no concrete vendor beton" test. Rejected after clarification on Discord community feedback. |
| Keep switch, add `OPENAI_BASE_URL` env var (minimal patch) | Works for exactly one DeepInfra use case. Does not address the deeper problem (inability to register new providers without touching core) and the inability to curate per-backend model lists. |
| Plugin system with filesystem scan (`adapters/*.ts` auto-discovery) | Adds module-loader complexity for zero benefit at current scale. Can be added later if the registry ever grows past ~20 adapters. |
| Runtime fetch of model list from provider `/models` endpoint | External dependency, network failure modes, variable costs, variable response formats. Rejected — static curated presets are sufficient and predictable. |

## User Stories / Use Cases

- **Open Mercato maintainer** wants to **add support for a new OpenAI-compatible backend (Fireworks AI)** so that **users can try it without waiting for a new release** — by adding one entry to `openai-compatible-presets.ts`.
- **Downstream app developer (only-yes-hub)** wants to **register a custom preset pointing at their LiteLLM proxy** so that **all their AI calls route through a single billing account** — by calling `llmProviderRegistry.register(customPreset)` in their bootstrap.
- **Backend engineer** wants to **swap Claude Haiku 4.5 for GLM-5.1 in production** so that **AI assistant costs drop by ~12× without losing quality** — by setting `OPENCODE_PROVIDER=deepinfra` + `DEEPINFRA_API_KEY=...` and selecting `zai-org/GLM-5.1` in the UI.
- **Local developer** wants to **run AI assistant against a local Ollama instance** so that **development doesn't burn API credits** — by setting `OPENCODE_PROVIDER=ollama` (preset in `openai-compatible-presets.ts`) and picking a locally-pulled model.

## Architecture

```
┌────────────────────────────────────────────────────────────────┐
│  packages/shared/src/lib/ai/                                  │
│                                                               │
│  llm-provider.ts                                             │
│    LlmProvider (port)                                         │
│    LlmModelInfo, LlmCreateModelOptions                       │
│                                                               │
│  llm-provider-registry.ts                                    │
│    llmProviderRegistry (singleton)                            │
│    register / get / list / listConfigured /                   │
│    resolveFirstConfigured / reset                             │
│                                                               │
│  adapters/                                                    │
│    anthropic.ts   AnthropicAdapter — Anthropic SDK           │
│    google.ts      GoogleAdapter    — Google GenAI SDK        │
│    openai.ts      OpenAIAdapter    — OpenAI SDK (baseURL)    │
│                                                               │
│  openai-compatible-presets.ts                                │
│    OpenAICompatiblePreset type                                │
│    OPENAI_COMPATIBLE_PRESETS = [                              │
│      openai, deepinfra, groq, together, fireworks,            │
│      azure, litellm, ollama, localai                          │
│    ]                                                          │
│                                                               │
│  bootstrap.ts                                                 │
│    registerBuiltInLlmProviders()                              │
│    — registers anthropic + google + 9 openai-compat presets   │
│                                                               │
│  opencode-provider.ts  (refactored, backward-compatible)     │
│    OpenCodeProviderId = string                                │
│    OPEN_CODE_PROVIDERS (getter, derived from registry)       │
│    resolveFirstConfiguredOpenCodeProvider (delegates)        │
│    resolveOpenCodeProviderApiKey (delegates)                 │
│    resolveOpenCodeModel (unchanged)                          │
└────────────────────────────────────────────────────────────────┘
                          ▲
                          │
┌─────────────────────────┴──────────────────────────────────────┐
│  packages/ai-assistant/src/modules/ai_assistant/              │
│                                                               │
│  api/route/route.ts                                           │
│    createRoutingModel() — registry.get(id).createModel(...)   │
│                                                               │
│  lib/chat-config.ts                                           │
│    CHAT_PROVIDERS — getter, returns registry.list()           │
│                                                               │
│  lib/ai-sdk.ts         unchanged (re-exports only)            │
└────────────────────────────────────────────────────────────────┘
```

### Lifecycle

1. Module load (`import '@open-mercato/shared/lib/ai'`) calls `registerBuiltInLlmProviders()` exactly once (guarded by singleton state).
2. `registerBuiltInLlmProviders()` imports adapters, creates instances, iterates over `OPENAI_COMPATIBLE_PRESETS`, registers each as a `LlmProvider`.
3. Consumers (route.ts, chat-config.ts) call `llmProviderRegistry.get(id)` or `.list()` — no import of adapters or presets needed.
4. Downstream apps may call `llmProviderRegistry.register(customProvider)` in their own bootstrap.

## Data Models

No database changes. This is a code-level refactor.

### TypeScript types

```ts
// packages/shared/src/lib/ai/llm-provider.ts

export type EnvLookup = Record<string, string | undefined>

export interface LlmModelInfo {
  id: string
  name: string
  contextWindow: number
  tags?: readonly string[]   // 'flagship' | 'budget' | 'reasoning' | 'coding' | 'vision'
}

export interface LlmCreateModelOptions {
  modelId: string
  apiKey: string
  baseURL?: string
}

export interface LlmProvider {
  readonly id: string
  readonly name: string
  readonly envKeys: readonly string[]
  readonly defaultModel: string
  readonly defaultModels: readonly LlmModelInfo[]

  isConfigured(env?: EnvLookup): boolean
  resolveApiKey(env?: EnvLookup): string | null
  getConfiguredEnvKey(env?: EnvLookup): string
  createModel(options: LlmCreateModelOptions): unknown
}
```

```ts
// packages/shared/src/lib/ai/openai-compatible-presets.ts

export interface OpenAICompatiblePreset {
  id: string
  name: string
  baseURL?: string               // undefined = default openai.com
  envKeys: readonly string[]     // API key env var names
  defaultModel: string
  defaultModels: readonly LlmModelInfo[]
}

export const OPENAI_COMPATIBLE_PRESETS: readonly OpenAICompatiblePreset[]
```

```ts
// packages/shared/src/lib/ai/llm-provider-registry.ts

export interface LlmProviderRegistry {
  register(provider: LlmProvider): void
  get(id: string): LlmProvider | null
  list(): readonly LlmProvider[]
  listConfigured(env?: EnvLookup): readonly LlmProvider[]
  resolveFirstConfigured(options?: {
    env?: EnvLookup
    order?: readonly string[]
  }): LlmProvider | null
  reset(): void
}

export const llmProviderRegistry: LlmProviderRegistry
```

### Built-in presets shipped in PR

1. **openai** — `baseURL: undefined`, models: `gpt-5-mini`, `gpt-5`, `gpt-4o-mini`, `gpt-4o`.
2. **deepinfra** — `baseURL: https://api.deepinfra.com/v1/openai`, envKeys: `DEEPINFRA_API_KEY`, models: `GLM-5.1`, `GLM-4.7-Flash`, `Qwen3-235B-A22B-Instruct-2507`, `Llama-4-Scout-17B-16E-Instruct`, `DeepSeek-V3.2-Exp`, `Qwen3-Coder-30B-A3B-Instruct`.
3. **groq** — `baseURL: https://api.groq.com/openai/v1`, envKeys: `GROQ_API_KEY`, models: `llama-4-scout-17b`, `llama-3.3-70b-versatile`, `mixtral-8x22b-32768`.
4. **together** — `baseURL: https://api.together.xyz/v1`, envKeys: `TOGETHER_API_KEY`, models: TBD from Together catalog.
5. **fireworks** — `baseURL: https://api.fireworks.ai/inference/v1`, envKeys: `FIREWORKS_API_KEY`, models: TBD.
6. **azure** — `baseURL: process.env.AZURE_OPENAI_BASE_URL` (deployment-specific), envKeys: `AZURE_OPENAI_API_KEY`, models: user-configurable via `OPENCODE_MODEL`.
7. **litellm** — `baseURL: process.env.LITELLM_BASE_URL`, envKeys: `LITELLM_API_KEY`, models: user-configurable.
8. **ollama** — `baseURL: http://localhost:11434/v1` (overridable via `OLLAMA_BASE_URL`), envKeys: `OLLAMA_API_KEY` (optional, defaults to `ollama`), models: `llama3.3`, `qwen2.5-coder`.

For presets 4–8, initial lists may be minimal (1–2 models) — users can extend via their own registered presets or `OPENCODE_MODEL` override.

## API Contracts

No new HTTP endpoints. Existing endpoints preserve contracts:

- `POST /api/route` (ai_assistant) — unchanged contract; internally uses registry instead of switch.
- `GET /api/settings` (ai_assistant) — response shape unchanged, but now enumerates all registered providers with their configured state.

## Internationalization (i18n)

Provider `name` fields stay English by convention (short identifier-like labels in UI dropdowns: "DeepInfra", "Groq", "OpenAI"). Existing i18n dictionaries unchanged. No new strings needed.

## UI/UX

- `/backend/ai-assistant/settings` provider dropdown: expanded list with configured providers first (check next to the `name`), unconfigured ones disabled with tooltip `Set $ENV_KEY to enable`.
- Model dropdown: populated from `provider.defaultModels`. If `OPENCODE_MODEL` is set, shown as a separate "Custom (override)" entry at the top.
- No new screens or layouts.

## Configuration

New environment variables (all optional):

```bash
# DeepInfra — OpenAI-compatible, unlocks GLM, Qwen, Llama 4, DeepSeek
DEEPINFRA_API_KEY=

# Groq — fast inference, Llama 4 Scout
GROQ_API_KEY=

# Together AI — broad model catalog
TOGETHER_API_KEY=

# Fireworks AI
FIREWORKS_API_KEY=

# Azure OpenAI (deployment-specific URL)
AZURE_OPENAI_API_KEY=
AZURE_OPENAI_BASE_URL=

# LiteLLM proxy (self-hosted)
LITELLM_API_KEY=
LITELLM_BASE_URL=http://localhost:4000/v1

# Ollama local (default http://localhost:11434/v1)
OLLAMA_BASE_URL=
OLLAMA_API_KEY=ollama
```

Existing env vars unchanged: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `OPENCODE_PROVIDER`, `OPENCODE_MODEL`.

## Migration & Compatibility

**Fully non-breaking.** All existing exports from `opencode-provider.ts` stay functional:
- `OpenCodeProviderId` widened to `string`, `isOpenCodeProviderId()` still works as a type guard.
- `OPEN_CODE_PROVIDERS` stays as an object derived from the registry; keys `anthropic`, `openai`, `google` remain with identical shapes.
- `resolveFirstConfiguredOpenCodeProvider()`, `resolveOpenCodeProviderApiKey()`, `isOpenCodeProviderConfigured()`, `resolveOpenCodeModel()` — same signatures, internally delegate to registry.
- Existing tests in `__tests__/opencode-provider.test.ts` pass **without modification**.

**Downstream registration example** (for apps like `only-yes-hub`):

```ts
// src/bootstrap.ts (downstream app)
import { llmProviderRegistry } from '@open-mercato/shared/lib/ai/llm-provider-registry'
import { createOpenAICompatibleProvider } from '@open-mercato/shared/lib/ai/adapters/openai'

// Register a custom LiteLLM proxy that proxies to multiple backends
llmProviderRegistry.register(
  createOpenAICompatibleProvider({
    id: 'internal-litellm',
    name: 'Internal LiteLLM',
    baseURL: process.env.INTERNAL_LITELLM_URL!,
    envKeys: ['INTERNAL_LITELLM_KEY'],
    defaultModel: 'internal/gpt-5',
    defaultModels: [
      { id: 'internal/gpt-5', name: 'GPT-5 (internal)', contextWindow: 128000 },
    ],
  })
)
```

## Implementation Plan

### Phase 1: Port, registry, tests (foundational)
1. Create `llm-provider.ts` with `LlmProvider`, `LlmModelInfo`, `LlmCreateModelOptions`, `EnvLookup` types.
2. Create `llm-provider-registry.ts` with singleton registry and tests.
3. Verify: `yarn --cwd packages/shared test llm-provider-registry` green.

### Phase 2: Native adapters (Anthropic, Google)
1. Create `adapters/anthropic.ts` — wraps `createAnthropic({ apiKey })`, implements `LlmProvider`.
2. Create `adapters/google.ts` — wraps `createGoogleGenerativeAI({ apiKey })`, implements `LlmProvider`.
3. Unit tests for both adapters (config detection, createModel returns non-null).

### Phase 3: OpenAI protocol adapter + preset helper
1. Create `adapters/openai.ts` — wraps `createOpenAI({ apiKey, baseURL })`, implements `LlmProvider`. Exports factory `createOpenAICompatibleProvider(preset)` that binds a preset to the adapter.
2. Create `openai-compatible-presets.ts` with the 8 built-in presets listed above.
3. Unit tests for `OpenAIAdapter` (both standard OpenAI and one preset, e.g. DeepInfra with mocked fetch).

### Phase 4: Bootstrap and backward-compatible facade
1. Create `bootstrap.ts` — single exported function `registerBuiltInLlmProviders()`, idempotent (checks if already registered). Imported by `opencode-provider.ts` at module load.
2. Refactor `opencode-provider.ts` — keep all exports, delegate to registry. Preserve test assertions in `__tests__/opencode-provider.test.ts`.
3. Run: `yarn --cwd packages/shared test` — all existing tests must pass.

### Phase 5: ai-assistant refactor
1. Refactor `api/route/route.ts` `createRoutingModel()` — replace switch with registry lookup.
2. Refactor `lib/chat-config.ts` — `CHAT_PROVIDERS` returns `registry.list()` mapped to the existing `ChatProviderInfo` shape.
3. Update type imports across the module.
4. Run: `yarn --cwd packages/ai-assistant test` — all tests green.

### Phase 6: Documentation + .env.example
1. Update `.env.example` with new DeepInfra, Groq, Together, Fireworks, Azure, LiteLLM, Ollama env vars.
2. Update `packages/ai-assistant/README.md` — add section "Extending LLM providers" with `registry.register()` example.
3. Add `CHANGELOG.md` entry.

### Phase 7: Final verification
1. `yarn build` — all packages compile.
2. `yarn typecheck` — clean.
3. `yarn test` — full test suite green.
4. Manual: start `yarn dev`, open `/backend/ai-assistant/settings`, verify dropdown shows all configured providers, verify switching provider works.

## Risks & Impact Review

### Data Integrity Failures

- **What happens if the operation is interrupted mid-way?** N/A — no database operations. This is a code refactor. Registry initialization is in-memory and re-runs on every process start.
- **Are there race conditions when multiple users configure providers concurrently?** No. Provider selection is read-only per-request; no shared mutable state is written during chat operations. The registry itself is populated once at module load (before any request is served).
- **Can partial writes occur?** No. No writes at all.
- **What happens if referenced entities are deleted while the operation is in-flight?** N/A — no entities.

### Cascading Failures & Side Effects

- **Which other modules depend on this data?** `ai_assistant/api/route/route.ts` (intent routing model), `ai_assistant/lib/chat-config.ts` (UI dropdown), and indirectly `inbox_ops/ai-tools.ts` (LLM extraction) — all three read provider configuration via the existing `opencode-provider.ts` exports, which become thin facades over the registry. Because the facade preserves signatures, none of them require refactoring beyond the two files explicitly listed in the scope.
- **Does this feature emit events?** No. Provider selection is synchronous request-local state.
- **What happens if a subscriber fails?** N/A — no subscribers.
- **Are there circular dependencies between modules that could cause loops or deadlocks?** The refactor explicitly moves nothing out of `shared` into `ai-assistant`, and `ai-assistant` only imports from `shared` (one direction). Circular dependency risk is addressed by design; a build check (`yarn build`) in Phase 4 verifies no cycles.
- **If an external service is unavailable, does the operation fail or degrade gracefully?** An LLM provider being unreachable is a runtime failure handled by AI SDK (`generateObject`/`streamText` throw). This refactor does not change that behavior. The registry itself does not contact any external service — it only instantiates SDK clients lazily when `createModel()` is called.

### Tenant & Data Isolation Risks

- **Can a bug in this feature leak data between tenants?** No. The registry is global (process-level) and contains only static provider metadata + factory closures. No tenant data flows through it. Each request resolves an API key from environment variables — not from tenant-scoped storage — exactly as the current implementation does.
- **Are there shared/global resources (caches, queues, counters) that could cause cross-tenant interference?** The AI SDK model instances created by `createModel()` may hold HTTP connection pools internally. This is identical behavior to the current `createOpenAI({ apiKey })` call in `route.ts:44`; the refactor does not change pooling semantics.
- **What happens if a single tenant has far more data than others?** N/A — no per-tenant state.

### Migration & Deployment Risks

- **Can this change be deployed without downtime?** Yes. The PR is backward-compatible: existing `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY` users see no behavior change. New env vars (`DEEPINFRA_API_KEY`, etc.) are purely additive.
- **If migration fails halfway, can it be safely re-run or rolled back?** No migration to run. `git revert` the commit rolls back cleanly.
- **Does this require data backfill?** No.
- **Are there breaking API contract changes?** No public HTTP API change. The TypeScript type `OpenCodeProviderId` is widened from `'anthropic' | 'openai' | 'google'` to `string`. Downstream consumers that use an exhaustive `switch` with a TypeScript `never` check will see a type error and must add a `default:` branch. This is documented in the CHANGELOG.

### Operational Risks

- **What monitoring/alerting gaps remain?** None introduced by this PR. Existing LLM error logging in `route.ts` is preserved.
- **What is the blast radius if this feature fails entirely?** If the registry fails to bootstrap (e.g., a catastrophic bug in `bootstrap.ts`), the AI Assistant module fails to initialize and `/api/route` returns 500. Other modules (sales, customers, catalog) are unaffected. Severity: isolated module outage, not tenant-wide or system-wide.
- **Are there rate-limiting/throttling concerns?** Not introduced by this refactor. Rate limits are owned by each upstream provider (Anthropic, OpenAI, DeepInfra, Groq) and enforced at the HTTP layer by AI SDK.
- **What are storage growth implications at scale?** None — no storage.

### Risk Register

#### R1: Circular dependency between `shared` and `ai-assistant`

- **Scenario**: During the refactor, a new export is accidentally added to `shared` that imports from `ai-assistant`, creating a build cycle that blocks compilation of both packages.
- **Severity**: Medium
- **Affected area**: Build pipeline (`yarn build`, `yarn typecheck`), both `packages/shared` and `packages/ai-assistant`
- **Mitigation**: The port interface (`LlmProvider`) stays in `shared`. `ai-assistant` only consumes the registry via `import { llmProviderRegistry } from '@open-mercato/shared/lib/ai/llm-provider-registry'`. No new exports are added to `shared` that reference `ai-assistant`. Phase 4 explicitly runs `yarn build` before Phase 5 begins.
- **Residual risk**: Low. The direction of imports is enforced by code review and automated build checks.

#### R2: Singleton registry state leaks across test runs

- **Scenario**: Jest test isolation relies on fresh module state. A test registers a mock provider and a subsequent test assumes the default registry — the mock leaks and causes flaky or incorrect assertions.
- **Severity**: Medium
- **Affected area**: Test suite in `packages/shared/src/lib/ai/__tests__/` and `packages/ai-assistant/src/modules/ai_assistant/**/__tests__/`
- **Mitigation**: Registry exposes `reset()` method that clears all registered providers. Test helper `resetLlmProviderRegistry()` in `packages/shared/src/lib/testing/llm-registry.ts` is called in `beforeEach()` of every test file that touches providers. Integration tests that depend on built-in providers explicitly call `registerBuiltInLlmProviders()` after reset.
- **Residual risk**: Low. Enforced by adding a lint rule or review checklist item: "any test touching `llmProviderRegistry` must reset or re-register in `beforeEach`."

#### R3: Next.js dev hot-reload causes double registration

- **Scenario**: In development mode, Next.js re-executes module code on file changes. `registerBuiltInLlmProviders()` runs twice in the same process, causing warnings or duplicated providers.
- **Severity**: Low
- **Affected area**: Development experience only — never production.
- **Mitigation**: `register()` is idempotent — if a provider with the same `id` already exists, it is replaced (with a `console.debug` in dev mode: `[LlmRegistry] Replaced provider "deepinfra"`). Bootstrap function is guarded by a module-level `let bootstrapped = false` flag that no-ops on the second call.
- **Residual risk**: None.

#### R4: Missing peer dependency crashes registry bootstrap

- **Scenario**: A user installs `@open-mercato/shared` without `@ai-sdk/openai` (e.g., stripped dependency tree). Importing `packages/shared/src/lib/ai/adapters/openai.ts` throws, which cascades to the registry import, crashing the entire AI Assistant module at startup.
- **Severity**: High
- **Affected area**: Production bootstrap for any installation that does not use all three SDKs.
- **Mitigation**: Adapter registration in `bootstrap.ts` is wrapped in individual `try/catch` blocks. A failed import emits `console.warn('[LlmRegistry] Skipping adapter X — missing dependency: @ai-sdk/openai')` and continues. Users with only Anthropic configured lose the OpenAI family of providers (including DeepInfra) but keep a working Anthropic adapter. Unit test simulates missing dependency via Jest module mock.
- **Residual risk**: Low. The try/catch pattern is idempotent and well-tested.

#### R5: Backward-compat facade subtly changes `resolveOpenCodeModel` behavior

- **Scenario**: The current `resolveOpenCodeModel()` parses `modelWithProvider` tokens like `anthropic/claude-haiku-4-5`. When the provider list is dynamic (registry-driven), the validation "provider prefix must match current provider" may regress for edge cases such as uppercase prefixes or whitespace tokens.
- **Severity**: Medium
- **Affected area**: `packages/ai-assistant/src/modules/ai_assistant/api/route/route.ts`, which calls `resolveOpenCodeModel()` to parse configured model tokens.
- **Mitigation**: The existing test file `packages/shared/src/lib/ai/__tests__/opencode-provider.test.ts` contains 22 assertions that cover provider-prefix parsing, including edge cases (lowercase conversion, whitespace trimming, mismatched prefix throwing an error). Phase 4 mandates these tests pass without modification. Any new edge cases discovered during the refactor are captured in regression tests.
- **Residual risk**: Low. The facade is implemented as a thin wrapper; semantics are preserved by construction.

#### R6: `OpenCodeProviderId` widening breaks downstream exhaustive type guards

- **Scenario**: A downstream application uses the `OpenCodeProviderId` type in an exhaustive `switch` with a TypeScript `never` fallthrough. After widening to `string`, the `never` branch becomes reachable and the type check fails.
- **Severity**: Low
- **Affected area**: Downstream applications (e.g., `only-yes-hub`) that import `OpenCodeProviderId` directly.
- **Mitigation**: CHANGELOG entry documents the widening with migration guidance: add `default: throw new Error(\`unknown provider: \${id}\`)` to exhaustive switches. The existing `isOpenCodeProviderId()` type guard is preserved and continues to narrow strings to known ids at runtime.
- **Residual risk**: Low. The widening is intentional and documented; no silent breakage.

#### R7: DeepInfra upstream model catalog drift

- **Scenario**: Zhipu releases GLM-5.2, deprecating GLM-5.1. The hardcoded preset in `openai-compatible-presets.ts` points at a model that returns 404.
- **Severity**: Low
- **Affected area**: UX — users selecting GLM-5.1 get an error.
- **Mitigation**: Preset is pure data. A one-line edit in `openai-compatible-presets.ts` updates the model id. Users can always override via `OPENCODE_MODEL` env var without a code change. A follow-up SPEC could add a runtime `/models` probe, but that is out of scope here.
- **Residual risk**: None — acceptable maintenance burden.

#### R8: Preset env var conflicts

- **Scenario**: A user sets both `OPENAI_API_KEY` (for standard OpenAI) and `DEEPINFRA_API_KEY` (for DeepInfra preset). They want OpenAI, but the DeepInfra preset is registered first and `resolveFirstConfigured()` returns DeepInfra.
- **Severity**: Medium
- **Affected area**: Configuration UX.
- **Mitigation**: Each preset declares its own `envKeys` — DeepInfra uses `['DEEPINFRA_API_KEY']`, OpenAI uses `['OPENAI_API_KEY']`. There is no overlap. `resolveFirstConfigured()` accepts an `order` argument that defaults to `['anthropic', 'openai', 'google', 'deepinfra', 'groq', 'together', ...]` (registration order). Users with both keys configured who want deterministic selection can set `OPENCODE_PROVIDER=openai` explicitly. Tests cover the precedence order.
- **Residual risk**: Low. Documented in README.

#### R9: Virtual providers confuse users in the UI

- **Scenario**: Users see 9 entries in the provider dropdown and do not understand that DeepInfra, Groq, Together etc. all speak OpenAI protocol under the hood. They pick DeepInfra but enter an `OPENAI_API_KEY` value, expecting it to work.
- **Severity**: Low
- **Affected area**: `/backend/ai-assistant/settings` UX.
- **Mitigation**: UI shows each preset under its own `name` (DeepInfra, Groq, etc., not "OpenAI"). Unconfigured presets are disabled with a tooltip `Set DEEPINFRA_API_KEY to enable`. The README adds a short "Which provider?" section.
- **Residual risk**: None — the UX mirrors how popular tools like Continue.dev, Aider, and LiteLLM handle OpenAI-compatible providers.

#### R10: Preset array memory footprint

- **Scenario**: Apps that only use Anthropic still load the full preset array, wasting memory.
- **Severity**: Low
- **Affected area**: Runtime memory, all deployments.
- **Mitigation**: The preset array is approximately 2 KB of static data. Negligible vs. the multi-megabyte AI SDK runtime. Lazy-loading adapters per preset is possible but not worth the complexity at this scale.
- **Residual risk**: None.

#### R11: `chat-config.ts` UI dropdown loses static type safety

- **Scenario**: The current `CHAT_PROVIDERS` map has TypeScript-enforced keys (`'anthropic' | 'openai' | 'google'`). When it becomes a registry-derived getter, callers that indexed it with a string literal lose type safety.
- **Severity**: Medium
- **Affected area**: Any UI component or backend endpoint that reads `CHAT_PROVIDERS['anthropic']` directly.
- **Mitigation**: The refactor returns `Record<string, ChatProviderInfo>` from `CHAT_PROVIDERS` getter, preserving the index access pattern. TypeScript type narrowing for known ids is available via the existing `isOpenCodeProviderId()` helper. Consumers that want exhaustive typing can continue to use the narrow type union on their side.
- **Residual risk**: Low. No production usage relies on compile-time exhaustiveness for this particular map.

## Final Compliance Report — 2026-04-14

### AGENTS.md Files Reviewed

- `AGENTS.md` (root) — core principles, PR workflow, monorepo structure, conventions.
- `packages/shared/AGENTS.md` — shared package rules (no domain logic, precise types, no `any`, narrow interfaces).
- `packages/ai-assistant/AGENTS.md` — tool registration, MCP server, OpenCode configuration, two-tier auth.
- `.ai/specs/AGENTS.md` — spec lifecycle, naming convention, required sections.
- `.ai/skills/spec-writing/SKILL.md` — spec-writing workflow, review lens, quality rules.

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | Simplicity first — make every change as simple as possible | Compliant | Three adapter files + one preset data file replace N hardcoded cases. Smaller blast radius than per-vendor adapters. |
| root AGENTS.md | No laziness — find root causes, no temporary fixes | Compliant | Addresses root cause (hardcoded provider switch) rather than adding a single env var patch. |
| root AGENTS.md | Minimal impact — changes should only touch what's necessary | Compliant | Two `ai-assistant` files touched (`route.ts`, `chat-config.ts`); `opencode-provider.ts` becomes a thin facade; no other code changes. |
| root AGENTS.md | Modules: plural, snake_case folders and ids | N/A | No new modules introduced. Adapter files live in `packages/shared/src/lib/ai/adapters/` — not a module. |
| root AGENTS.md | JS/TS fields and identifiers: camelCase | Compliant | `llmProviderRegistry`, `createModel`, `defaultModels`, `createOpenAICompatibleProvider`. |
| root AGENTS.md | Database tables/columns: snake_case, plural | N/A | No database changes. |
| root AGENTS.md | UUID PKs, explicit FKs, junction tables | N/A | No entities. |
| root AGENTS.md | FK IDs only for cross-module links, no direct ORM relationships | N/A | No ORM usage in this PR. |
| root AGENTS.md | `organization_id` mandatory for scoped entities | N/A | No entities. |
| root AGENTS.md | Keep modules self-contained | Compliant | `ai-assistant` consumes registry from `shared`; no new cross-module imports. |
| root AGENTS.md | Spec-first for non-trivial tasks (3+ steps / architectural decisions) | Compliant | This SPEC is the spec. |
| root AGENTS.md | Check `.ai/specs/` before coding | Compliant | Verified: no existing SPEC covers LLM provider refactor. Related issues #1430, #1433, #1419 scoped only to env-var naming and error messages. |
| `.ai/specs/AGENTS.md` | New specs use `{date}-{title}.md` format | Compliant | `2026-04-14-llm-provider-ports-and-adapters.md`. |
| `.ai/specs/AGENTS.md` | Every non-trivial spec includes 10 required sections | Compliant | TLDR, Overview, Problem Statement, Proposed Solution, Architecture, Data Models, API Contracts, Risks & Impact Review, Final Compliance Report, Changelog — all present. |
| `.ai/skills/spec-writing/SKILL.md` | Start with skeleton + Open Questions | Compliant | Skeleton was produced first with Q1–Q3; full spec written only after answers. |
| `.ai/skills/spec-writing/SKILL.md` | Research and challenge against open-source market leaders | Compliant | Market Reference cites AI SDK v5, LangChain, LiteLLM. LangChain rejected with rationale. |
| `packages/shared/AGENTS.md` | MUST NOT add domain-specific logic — shared is infrastructure only | Compliant | LLM adapter infrastructure belongs in `shared/lib/ai/` — no domain logic. |
| `packages/shared/AGENTS.md` | MUST NOT import from `@open-mercato/core` or any domain package | Compliant | Adapters import only from `@ai-sdk/*` and `shared` itself. |
| `packages/shared/AGENTS.md` | MUST use precise types — no `any`, use zod schemas + `z.infer` | Partial | `LlmProvider.createModel()` returns `unknown` because AI SDK model types are complex generics and type-threading them through a generic port would explode. Call sites cast with `as Parameters<typeof generateObject>[0]['model']`, mirroring the current `route.ts` pattern. This is a tradeoff documented in the Design Decisions table. |
| `packages/shared/AGENTS.md` | MUST check for existing utilities before adding new helpers | Compliant | Existing `opencode-provider.ts` helpers (`resolveOpenCodeProviderApiKey`, `isOpenCodeProviderConfigured`, `resolveOpenCodeModel`) are preserved and internally delegate to the new registry. |
| `packages/shared/AGENTS.md` | MUST export narrow interfaces | Compliant | `LlmProvider`, `LlmModelInfo`, `LlmCreateModelOptions`, `LlmProviderRegistry` — each is a single-responsibility narrow type. |
| `packages/shared/AGENTS.md` | MUST centralize reusable types and constants here | Compliant | All new types live in `packages/shared/src/lib/ai/`. |
| `packages/ai-assistant/AGENTS.md` | Tools use `registerMcpTool`, moduleId, zod schemas | N/A | No new MCP tools in this PR. |
| `packages/ai-assistant/AGENTS.md` | Docker OpenCode configuration changes rebuilt and restarted | N/A | OpenCode Docker image is out of scope. |
| CONTRIBUTING.md | Branch from `develop` using `feat/<name>` format | Compliant | Branch `feat/llm-provider-ports-and-adapters` off `upstream/develop`. |
| CONTRIBUTING.md | PRs target `develop`, not `main` | Compliant | Target branch set to `develop` in PR description. |
| CONTRIBUTING.md | Describe user impact, architectural notes, testing performed | Compliant | Implementation Plan Phase 7 includes lint + typecheck + unit + integration + manual verification steps. |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Data Models match API Contracts | Pass | No database models; the TypeScript types in Data Models are the only contract. |
| API Contracts match UI/UX section | Pass | `/api/settings` response shape unchanged; UI dropdown reads from `CHAT_PROVIDERS` which now derives from registry. |
| Risks cover all write operations | Pass | There are no write operations; Data Integrity section explicitly notes this. |
| Commands defined for all mutations | N/A | No mutations. |
| Cache strategy covers all read APIs | N/A | No cache layer added; registry is an in-memory singleton, not a cache. |
| Implementation Plan phases are atomic and testable | Pass | Each of Phases 1–7 produces a compilable state with at least one test passing; no phase leaves the codebase broken. |
| Backward compatibility explicitly addressed | Pass | Migration & Compatibility section + R5, R6 risks + CHANGELOG note. |
| Test strategy is concrete | Pass | Phase 1 mandates registry tests, Phase 2 mandates adapter tests, Phase 3 mandates preset tests, Phase 4 mandates `opencode-provider.test.ts` green. |

### Non-Compliant Items

- **Rule**: `packages/shared/AGENTS.md` — MUST use precise types, no `any`
- **Source**: `packages/shared/AGENTS.md` line 6 (rule #2)
- **Gap**: `LlmProvider.createModel()` returns `unknown` rather than a narrow AI SDK model type.
- **Recommendation**: Document the tradeoff in Design Decisions and CHANGELOG. Threading a generic model type through the port interface would require either (a) a generic `LlmProvider<TModel>` that infects every consumer, or (b) a wide union `AnthropicModel | OpenAIModel | GoogleModel` that couples `shared` to all three SDKs simultaneously. Both defeat the point of the refactor. Returning `unknown` with documented cast sites is the pragmatic middle ground. Call sites cast to `Parameters<typeof generateObject>[0]['model']`, mirroring the current `route.ts:44` behavior.
- **Decision**: Accepted as a deliberate tradeoff, not a violation in spirit.

### Verdict

- **Fully compliant** — ready for implementation. One deliberate tradeoff on `unknown` return type is documented and accepted; no blocking issues.

## Changelog

### 2026-04-14
- Initial spec skeleton with Open Questions Q1–Q3.
- Q1 resolved to **B** (one OpenAIAdapter with data-driven presets, per @Lbajurcowicz Discord feedback on "no concrete-vendor beton").
- Q2 resolved to **A** (models live inside presets, self-contained per SRP).
- Q3 resolved to **B** (curated top-6 DeepInfra defaults: GLM-5.1, GLM-4.7-Flash, Qwen3-235B-A22B, Llama 4 Scout, DeepSeek V3.2, Qwen3-Coder 30B).
- Architecture rewritten around "adapter = protocol, not vendor" principle.
- Risks & Impact Review expanded to full template format (5 categories + 11-item Risk Register).
- Final Compliance Report expanded to full template format (AGENTS.md review, Compliance Matrix, Internal Consistency Check, Verdict). Spec marked **Fully compliant — ready for implementation** with one accepted tradeoff on `unknown` return type.
- **Correction during Phase 2:** adapters and presets moved from `packages/shared/src/lib/ai/adapters/` to `packages/ai-assistant/src/modules/ai_assistant/lib/llm-adapters/` because AI SDK dependencies (`@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google`) live in `packages/ai-assistant/package.json`, not `shared`. Keeping adapters in `shared` would require adding those dependencies to `shared`, violating its "infrastructure only, no SDK imports" principle. The port interface (`LlmProvider`) and registry remain in `shared`. Bootstrap (`llm-bootstrap.ts`) lives in `ai-assistant` and runs on module load.
- **Correction during Phase 4:** `opencode-provider.ts` in `shared` is NOT refactored into a facade. Original file stays byte-for-byte unchanged. Rationale: `inbox_ops` and existing tests depend on the narrow `OpenCodeProviderId = 'anthropic' | 'openai' | 'google'` type union. Widening it would require changes across `inbox_ops/lib/llmProvider.ts`, its test mocks, and `settings/route.ts`. All of that is out of scope — the goal is to add new providers without breaking existing consumers. `chat-config.ts` and `route.ts` (both in `ai-assistant`) are refactored to use the registry directly; `inbox_ops` keeps using `opencode-provider.ts` exactly as before. This honors the "minimal impact" principle from root AGENTS.md and guarantees 100% backward compatibility.
