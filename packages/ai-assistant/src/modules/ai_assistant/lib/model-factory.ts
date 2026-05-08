/**
 * Shared AI model factory.
 *
 * Consolidates the previously-per-module model-creation plumbing (inbox_ops's
 * `llmProvider.ts`, the agent-runtime's inline `resolveAgentModel`) behind a
 * single DI-friendly port. Every AI-runtime caller (chat, object, inbox-ops
 * extraction, future agents) resolves the `LanguageModelV1` it hands to the
 * Vercel AI SDK through `createModelFactory(container).resolveModel(...)` so
 * all of them share one resolution order:
 *
 *   1. `callerOverride` (non-empty string) — highest precedence, e.g. the
 *      `modelOverride` field on `runAiAgentText`/`runAiAgentObject`.
 *   2. Env variable `<MODULE>_AI_MODEL` (uppercased `moduleId`) when
 *      `moduleId` is provided. Example: `INBOX_OPS_AI_MODEL=claude-haiku-4-5`,
 *      `CATALOG_AI_MODEL=gpt-4o-mini`.
 *   3. `agentDefaultModel` — typically `AiAgentDefinition.defaultModel`.
 *   4. Global env `AI_DEFAULT_MODEL` (Phase 0 of spec
 *      `2026-04-27-ai-agents-provider-model-baseurl-overrides.md`). Accepts
 *      either a plain model id (`gpt-5-mini`) or a slash-qualified id
 *      (`openai/gpt-5-mini`). Slash qualifiers consume the provider axis at
 *      the same step — a higher-priority provider source still wins, but a
 *      lower-priority one cannot overwrite a slash-qualified model.
 *   5. The configured provider's own default model id
 *      (`provider.defaultModel`).
 *
 * Resolution walks the `llmProviderRegistry`'s `resolveFirstConfigured()`
 * output. The walk's `order` argument is seeded from (in priority order):
 *
 *   1. The slash-qualified provider hint extracted from `AI_DEFAULT_MODEL` —
 *      consumes the provider axis for this resolution.
 *   2. `AI_DEFAULT_PROVIDER` (Phase 0 of the same spec) — names a registered
 *      provider id; falls through transparently when the named provider is
 *      registered-but-unconfigured.
 *
 * Both env knobs are deliberately decoupled from the legacy
 * `OPENCODE_PROVIDER` / `OPENCODE_MODEL` vars (which remain bound to the
 * OpenCode Code Mode stack) — see "Coexistence with OpenCode Code Mode" in
 * `packages/ai-assistant/AGENTS.md`.
 *
 * The factory throws {@link AiModelFactoryError} when no provider is
 * configured — every current call site already expects the throw (see the
 * bare `throw new Error('No LLM provider is configured...')` in
 * `agent-runtime.ts` prior to the consolidation).
 *
 * @see packages/shared/src/lib/ai/llm-provider-registry.ts
 * @see packages/ai-assistant/src/modules/ai_assistant/lib/agent-runtime.ts
 * @see packages/core/src/modules/inbox_ops/lib/llmProvider.ts
 */

import type { AwilixContainer } from 'awilix'
import type { EnvLookup, LlmProvider } from '@open-mercato/shared/lib/ai/llm-provider'
import { llmProviderRegistry } from '@open-mercato/shared/lib/ai/llm-provider-registry'

/**
 * Minimal AI SDK LanguageModel shape — the factory exposes the protocol-
 * agnostic `unknown`-typed return from {@link LlmProvider.createModel} under a
 * dedicated alias so callers can document intent without importing the AI SDK
 * here. Call sites that hand the result to `generateText` / `streamText` /
 * `generateObject` / `streamObject` continue to cast to the SDK's
 * `LanguageModelV1` / `LanguageModel` union exactly as they already do.
 */
export type AiModelInstance = unknown

/**
 * Input accepted by {@link AiModelFactory.resolveModel}. All fields are
 * optional — passing an empty input resolves the provider default.
 */
export interface AiModelFactoryInput {
  /**
   * Owning module id (matches `Module.id`). When set, the factory checks
   * `<MODULE>_AI_MODEL` (uppercased) as the env-override source. Example:
   * `moduleId: 'inbox_ops'` → env var `INBOX_OPS_AI_MODEL`.
   */
  moduleId?: string
  /**
   * Agent-level default, typically `AiAgentDefinition.defaultModel`. Used
   * when neither `callerOverride` nor the module env override is present.
   */
  agentDefaultModel?: string
  /**
   * Per-call override (e.g. `runAiAgentText({ modelOverride })`). Wins over
   * every other source when it is a non-empty trimmed string. Empty strings
   * are treated as "no override" so the next source in the chain wins —
   * callers MUST NOT need a separate "clear override" API.
   */
  callerOverride?: string
}

/**
 * Materialized output returned by {@link AiModelFactory.resolveModel}.
 */
export interface AiModelResolution {
  /**
   * Concrete AI SDK model instance ready to pass to
   * `generateText`/`streamText`/`generateObject`/`streamObject`. Typed as
   * {@link AiModelInstance} to avoid coupling this port to a specific SDK
   * major version.
   */
  model: AiModelInstance
  /** Resolved upstream model id (e.g. `claude-haiku-4-5-20251001`). */
  modelId: string
  /** Stable provider id from {@link LlmProvider.id}. */
  providerId: string
  /**
   * Which source won resolution. Useful for logs and tests; never exposed
   * as a public contract beyond these enum values.
   */
  source:
    | 'caller_override'
    | 'module_env'
    | 'agent_default'
    | 'env_default'
    | 'provider_default'
}

/**
 * Port exposed by {@link createModelFactory}. Stateless — the factory
 * re-reads the registry + env on every `resolveModel` call so hot-reload
 * and test overrides work without needing factory re-creation.
 */
export interface AiModelFactory {
  resolveModel(input: AiModelFactoryInput): AiModelResolution
}

/**
 * Typed error thrown by the factory when it cannot materialize a model.
 *
 * `code` is a stable string union so downstream callers can branch without
 * parsing error messages. `AiModelFactoryError`s bubble through
 * `runAiAgentText`/`runAiAgentObject` unchanged — the agent runtime does
 * NOT catch them, matching the pre-consolidation behavior of the inline
 * resolver.
 */
export type AiModelFactoryErrorCode =
  | 'no_provider_configured'
  | 'api_key_missing'

export class AiModelFactoryError extends Error {
  readonly code: AiModelFactoryErrorCode

  constructor(code: AiModelFactoryErrorCode, message: string) {
    super(message)
    this.name = 'AiModelFactoryError'
    this.code = code
  }
}

/**
 * Subset of {@link import('@open-mercato/shared/lib/ai/llm-provider-registry').LlmProviderRegistry}
 * the factory consumes. Defined locally so test doubles only need to mock
 * the methods the factory actually calls.
 */
export interface AiModelFactoryRegistry {
  resolveFirstConfigured(options?: {
    env?: EnvLookup
    order?: readonly string[]
  }): LlmProvider | null
  /**
   * Optional registry lookup used by the slash-shorthand parser to validate
   * a provider hint. When absent, slash parsing is disabled and the entire
   * model token is treated as a model id (mirrors the pre-Phase-0
   * behavior).
   */
  get?(id: string): LlmProvider | null
}

/**
 * Internal dependencies of the factory. Exposed for tests only; production
 * callers rely on the defaults wired by {@link createModelFactory}.
 */
export interface CreateModelFactoryDependencies {
  /**
   * Registry used to resolve the first configured provider. Defaults to the
   * singleton `llmProviderRegistry`.
   */
  registry?: AiModelFactoryRegistry
  /** Env lookup for `<MODULE>_AI_MODEL` + provider credentials. */
  env?: EnvLookup
}

const GLOBAL_DEFAULT_PROVIDER_ENV = 'AI_DEFAULT_PROVIDER'
const GLOBAL_DEFAULT_MODEL_ENV = 'AI_DEFAULT_MODEL'

function normalizeOverride(value: string | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function moduleEnvVarName(moduleId: string): string {
  return `${moduleId.toUpperCase()}_AI_MODEL`
}

/**
 * Splits a slash-qualified model token (e.g. `openai/gpt-5-mini`) into
 * `{ providerHint, modelId }` when the prefix matches a registered provider
 * id, otherwise returns the entire token as the model id and a null hint.
 *
 * The registry-membership guard avoids mis-splitting model ids that already
 * contain slashes (DeepInfra: `meta-llama/Llama-3.3-70B-Instruct-Turbo`,
 * `zai-org/GLM-5.1`). When the registry does not expose `get`, slash
 * parsing is disabled — callers without a configured registry behave as if
 * the entire token were a plain model id.
 *
 * Exported for test coverage; production callers go through
 * {@link createModelFactory}.
 */
export function parseSlashShorthand(
  token: string,
  registry: Pick<AiModelFactoryRegistry, 'get'>,
): { providerHint: string | null; modelId: string } {
  const slashIndex = token.indexOf('/')
  if (slashIndex < 0) return { providerHint: null, modelId: token }
  const before = token.slice(0, slashIndex)
  const after = token.slice(slashIndex + 1)
  if (!before || !after) return { providerHint: null, modelId: token }
  if (!registry.get) return { providerHint: null, modelId: token }
  const provider = registry.get(before)
  if (!provider) return { providerHint: null, modelId: token }
  return { providerHint: before, modelId: after }
}

/**
 * Creates an {@link AiModelFactory} bound to the DI container. The container
 * reference is accepted for API symmetry with other runtime helpers (and so
 * future work can read provider overrides registered on the container); the
 * current implementation only needs the registry + env. No breaking change
 * when later implementations DO consult the container.
 */
export function createModelFactory(
  _container: AwilixContainer,
  deps: CreateModelFactoryDependencies = {},
): AiModelFactory {
  const registry: AiModelFactoryRegistry = deps.registry ?? llmProviderRegistry
  const env = deps.env ?? process.env

  return {
    resolveModel(input: AiModelFactoryInput): AiModelResolution {
      const globalProviderEnv = normalizeOverride(env[GLOBAL_DEFAULT_PROVIDER_ENV])
      const globalModelEnv = normalizeOverride(env[GLOBAL_DEFAULT_MODEL_ENV])

      // Slash-qualified `AI_DEFAULT_MODEL` consumes the provider axis at
      // step 6 (env default). Phase 1 of the per-axis-overrides spec
      // generalizes the parser to every model-axis source.
      const globalModelParsed = globalModelEnv
        ? parseSlashShorthand(globalModelEnv, registry)
        : null
      const slashProviderHint = globalModelParsed?.providerHint ?? null
      const orderHint = slashProviderHint ?? globalProviderEnv ?? null
      const order = orderHint ? [orderHint] : undefined

      const provider = registry.resolveFirstConfigured({ env, order })
      if (!provider) {
        throw new AiModelFactoryError(
          'no_provider_configured',
          'No LLM provider is configured. Set AI_DEFAULT_PROVIDER (or OPENCODE_PROVIDER for the legacy stack) plus a matching API key such as ANTHROPIC_API_KEY, OPENAI_API_KEY, or GOOGLE_GENERATIVE_AI_API_KEY, then restart the app. See https://docs.openmercato.com/framework/ai-assistant/overview.',
        )
      }
      const apiKey = provider.resolveApiKey(env)
      if (!apiKey) {
        throw new AiModelFactoryError(
          'api_key_missing',
          `LLM provider "${provider.id}" is advertised as configured but resolveApiKey() returned empty.`,
        )
      }

      const callerOverride = normalizeOverride(input.callerOverride)
      const moduleEnvOverride =
        input.moduleId && input.moduleId.length > 0
          ? normalizeOverride(env[moduleEnvVarName(input.moduleId)])
          : null
      const agentDefault = normalizeOverride(input.agentDefaultModel)
      // The slash parser already split the global model token; use the
      // post-parse model id so `AI_DEFAULT_MODEL=openai/gpt-5-mini` resolves
      // model `gpt-5-mini` against provider `openai`.
      const envDefaultModel = globalModelParsed?.modelId ?? globalModelEnv

      let modelId: string
      let source: AiModelResolution['source']
      if (callerOverride) {
        modelId = callerOverride
        source = 'caller_override'
      } else if (moduleEnvOverride) {
        modelId = moduleEnvOverride
        source = 'module_env'
      } else if (agentDefault) {
        modelId = agentDefault
        source = 'agent_default'
      } else if (envDefaultModel) {
        modelId = envDefaultModel
        source = 'env_default'
      } else {
        modelId = provider.defaultModel
        source = 'provider_default'
      }

      const model = provider.createModel({ modelId, apiKey })
      return {
        model,
        modelId,
        providerId: provider.id,
        source,
      }
    },
  }
}
