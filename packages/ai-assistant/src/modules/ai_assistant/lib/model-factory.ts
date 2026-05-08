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
 *      Accepts a slash-qualified `<provider>/<model>` shorthand.
 *   4. Global env `AI_DEFAULT_MODEL` (Phase 0 of spec
 *      `2026-04-27-ai-agents-provider-model-baseurl-overrides.md`). Accepts
 *      either a plain model id (`gpt-5-mini`) or a slash-qualified id
 *      (`openai/gpt-5-mini`). Slash qualifiers consume the provider axis at
 *      the same step — a higher-priority provider source still wins, but a
 *      lower-priority one cannot overwrite a slash-qualified model.
 *   5. The configured provider's own default model id
 *      (`provider.defaultModel`).
 *
 * Every model-axis source is parsed through {@link parseSlashShorthand}.
 * Resolution walks the chain top-down, remembers the highest-priority
 * `(slashProviderHint | nonSlashProviderHint)` for the order seed:
 *
 *   Provider-axis seed order (highest priority first):
 *   1. Slash-prefix from `callerOverride` (Phase 1).
 *   2. `providerOverride` — request-time provider override (Phase 1).
 *   3. Slash-prefix from `<MODULE>_AI_MODEL` (Phase 1).
 *   4. `<MODULE>_AI_PROVIDER` env (Phase 1).
 *   5. Slash-prefix from `agentDefaultModel` (Phase 1).
 *   6. `agentDefaultProvider` — `AiAgentDefinition.defaultProvider` (Phase 1).
 *   7. Slash-prefix from `AI_DEFAULT_MODEL` (Phase 0).
 *   8. `AI_DEFAULT_PROVIDER` (Phase 0).
 *
 * Both `AI_DEFAULT_*` env knobs are deliberately decoupled from the legacy
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
   * Also enables the `<MODULE>_AI_PROVIDER` env axis (Phase 1).
   */
  moduleId?: string
  /**
   * Agent-level default, typically `AiAgentDefinition.defaultModel`. Used
   * when neither `callerOverride` nor the module env override is present.
   * Accepts a slash-qualified `<provider>/<model>` shorthand (Phase 1).
   */
  agentDefaultModel?: string
  /**
   * Agent-level default provider, typically `AiAgentDefinition.defaultProvider`.
   * Named provider id; falls through transparently when the named provider is
   * registered-but-unconfigured. Sits between `<MODULE>_AI_PROVIDER` (step 4)
   * and the global `AI_DEFAULT_PROVIDER` (step 6) in the resolution chain.
   *
   * Phase 1 of spec `2026-04-27-ai-agents-provider-model-baseurl-overrides`.
   */
  agentDefaultProvider?: string
  /**
   * Per-call override (e.g. `runAiAgentText({ modelOverride })`). Wins over
   * every other source when it is a non-empty trimmed string. Empty strings
   * are treated as "no override" so the next source in the chain wins —
   * callers MUST NOT need a separate "clear override" API.
   */
  callerOverride?: string
  /**
   * Request-time provider override — wins for the provider axis at the same
   * priority as `callerOverride` for the model axis. A non-empty string
   * that does not match any registered provider id is silently ignored and
   * the factory falls through to the next provider source.
   *
   * Phase 1 of spec `2026-04-27-ai-agents-provider-model-baseurl-overrides`.
   */
  providerOverride?: string
  /**
   * Agent-level default base URL, typically `AiAgentDefinition.defaultBaseUrl`.
   * Sits between the `<MODULE>_AI_BASE_URL` env var and the preset's own
   * `baseURLEnvKeys` in the resolution chain.
   *
   * Phase 2 of spec `2026-04-27-ai-agents-provider-model-baseurl-overrides`.
   */
  agentDefaultBaseUrl?: string
  /**
   * Per-call base URL override that wins over every other source. Intended
   * for programmatic callers only — the HTTP query-param baseUrl and the
   * AI_RUNTIME_BASEURL_ALLOWLIST arrive in Phase 4a.
   *
   * Phase 2 of spec `2026-04-27-ai-agents-provider-model-baseurl-overrides`.
   */
  baseUrlOverride?: string
  /**
   * Per-tenant default loaded from `ai_agent_runtime_overrides` by the agent
   * runtime (best-effort, fail-open). Sits at step 3 of the resolution chain
   * between the caller/request override (step 1–2) and the module-env axis
   * (step 4).
   *
   * Honored ONLY when `allowRuntimeModelOverride !== false` on the agent
   * definition. The agent runtime is responsible for hydration — the factory
   * does NOT load the row itself.
   *
   * Phase 4a of spec `2026-04-27-ai-agents-provider-model-baseurl-overrides`.
   */
  tenantOverride?: {
    providerId?: string | null
    modelId?: string | null
    baseURL?: string | null
  }
  /**
   * Per-request override forwarded from the HTTP dispatcher query params
   * (`?provider=`, `?model=`, `?baseUrl=`). Sits at step 1 of the resolution
   * chain — wins over everything else for that turn.
   *
   * Honored ONLY when `allowRuntimeModelOverride !== false` on the agent.
   * The dispatcher validates all three values before setting this input.
   *
   * Phase 4a of spec `2026-04-27-ai-agents-provider-model-baseurl-overrides`.
   */
  requestOverride?: {
    providerId?: string | null
    modelId?: string | null
    baseURL?: string | null
  }
  /**
   * When false, steps 1 (requestOverride) and 3 (tenantOverride) of the
   * resolution chain are skipped. Agents that pin a specific model for
   * correctness reasons set `AiAgentDefinition.allowRuntimeModelOverride =
   * false`. Default behavior (omitted) is permissive (= true).
   *
   * Phase 4a of spec `2026-04-27-ai-agents-provider-model-baseurl-overrides`.
   */
  allowRuntimeModelOverride?: boolean
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
    | 'request_override'
    | 'caller_override'
    | 'tenant_override'
    | 'module_env'
    | 'agent_default'
    | 'env_default'
    | 'provider_default'
  /**
   * Resolved base URL passed to the adapter (if any). Undefined when the
   * adapter will use its built-in default. Included for observability and
   * test assertions; never exposed over HTTP (Phase 4a adds the allowlist).
   */
  baseURL?: string
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

function moduleModelEnvVarName(moduleId: string): string {
  return `${moduleId.toUpperCase()}_AI_MODEL`
}

function moduleProviderEnvVarName(moduleId: string): string {
  return `${moduleId.toUpperCase()}_AI_PROVIDER`
}

function moduleBaseUrlEnvVarName(moduleId: string): string {
  return `${moduleId.toUpperCase()}_AI_BASE_URL`
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
      const hasModule = typeof input.moduleId === 'string' && input.moduleId.length > 0
      // When allowRuntimeModelOverride is explicitly false, skip steps 1
      // (requestOverride) and 3 (tenantOverride) — the agent pins a model.
      const runtimeOverridesAllowed = input.allowRuntimeModelOverride !== false

      // --- Step 1: requestOverride (HTTP query params) — gated by flag ---
      const requestModelRaw = runtimeOverridesAllowed
        ? normalizeOverride(input.requestOverride?.modelId ?? undefined)
        : null
      const requestProviderRaw = runtimeOverridesAllowed
        ? normalizeOverride(input.requestOverride?.providerId ?? undefined)
        : null
      const requestBaseUrlRaw = runtimeOverridesAllowed
        ? normalizeOverride(input.requestOverride?.baseURL ?? undefined)
        : null

      // --- Step 2: callerOverride (programmatic) ---
      const callerRaw = normalizeOverride(input.callerOverride)

      // --- Step 3: tenantOverride (DB row) — gated by flag ---
      const tenantModelRaw = runtimeOverridesAllowed
        ? normalizeOverride(input.tenantOverride?.modelId ?? undefined)
        : null
      const tenantProviderRaw = runtimeOverridesAllowed
        ? normalizeOverride(input.tenantOverride?.providerId ?? undefined)
        : null
      const tenantBaseUrlRaw = runtimeOverridesAllowed
        ? normalizeOverride(input.tenantOverride?.baseURL ?? undefined)
        : null

      // --- Steps 4+: env / agent / global ---
      const moduleModelRaw = hasModule
        ? normalizeOverride(env[moduleModelEnvVarName(input.moduleId!)])
        : null
      const agentModelRaw = normalizeOverride(input.agentDefaultModel)
      const globalModelRaw = normalizeOverride(env[GLOBAL_DEFAULT_MODEL_ENV])

      // Parse slash shorthand on every model-axis source.
      const requestModelParsed = requestModelRaw ? parseSlashShorthand(requestModelRaw, registry) : null
      const callerParsed = callerRaw ? parseSlashShorthand(callerRaw, registry) : null
      const tenantModelParsed = tenantModelRaw ? parseSlashShorthand(tenantModelRaw, registry) : null
      const moduleModelParsed = moduleModelRaw ? parseSlashShorthand(moduleModelRaw, registry) : null
      const agentModelParsed = agentModelRaw ? parseSlashShorthand(agentModelRaw, registry) : null
      const globalModelParsed = globalModelRaw ? parseSlashShorthand(globalModelRaw, registry) : null

      // --- Provider-axis: walk from highest to lowest priority for the seed.
      // A slash-qualified hint from a model source wins over a plain provider
      // source at the same priority step. We walk top-down and take the first
      // non-null hint.
      const providerOverrideRaw = normalizeOverride(input.providerOverride)
      const moduleProviderRaw = hasModule
        ? normalizeOverride(env[moduleProviderEnvVarName(input.moduleId!)])
        : null
      const agentDefaultProviderRaw = normalizeOverride(input.agentDefaultProvider)
      const globalProviderRaw = normalizeOverride(env[GLOBAL_DEFAULT_PROVIDER_ENV])

      // Walk the provider-axis seed list: slash hint beats plain provider at
      // the same step. We keep only the first (highest-priority) non-null hint.
      const providerHintCandidates: Array<string | null> = [
        requestModelParsed?.providerHint ?? null,
        requestProviderRaw,
        callerParsed?.providerHint ?? null,
        providerOverrideRaw,
        tenantModelParsed?.providerHint ?? null,
        tenantProviderRaw,
        moduleModelParsed?.providerHint ?? null,
        moduleProviderRaw,
        agentModelParsed?.providerHint ?? null,
        agentDefaultProviderRaw,
        globalModelParsed?.providerHint ?? null,
        globalProviderRaw,
      ]
      const orderHint = providerHintCandidates.find((hint) => hint !== null) ?? null
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

      // --- Model-axis: use the post-parse model id from the winning source.
      let modelId: string
      let source: AiModelResolution['source']
      if (requestModelParsed) {
        modelId = requestModelParsed.modelId
        source = 'request_override'
      } else if (callerParsed) {
        modelId = callerParsed.modelId
        source = 'caller_override'
      } else if (tenantModelParsed) {
        modelId = tenantModelParsed.modelId
        source = 'tenant_override'
      } else if (moduleModelParsed) {
        modelId = moduleModelParsed.modelId
        source = 'module_env'
      } else if (agentModelParsed) {
        modelId = agentModelParsed.modelId
        source = 'agent_default'
      } else if (globalModelParsed) {
        modelId = globalModelParsed.modelId
        source = 'env_default'
      } else {
        modelId = provider.defaultModel
        source = 'provider_default'
      }

      // --- BaseURL-axis resolution (highest to lowest priority) ---
      // 1. requestOverride.baseURL (HTTP dispatcher) — gated by allowRuntimeModelOverride
      // 2. baseUrlOverride (programmatic caller)
      // 3. tenantOverride.baseURL (DB row) — gated by allowRuntimeModelOverride
      // 4. <MODULE>_AI_BASE_URL env
      // 5. agentDefaultBaseUrl
      // Steps 6-7 (preset env + preset default) are handled inside the adapter's
      // createModel when no explicit baseURL is passed.
      const resolvedBaseURL = requestBaseUrlRaw
        ?? normalizeOverride(input.baseUrlOverride)
        ?? tenantBaseUrlRaw
        ?? (hasModule ? normalizeOverride(env[moduleBaseUrlEnvVarName(input.moduleId!)]) : null)
        ?? normalizeOverride(input.agentDefaultBaseUrl)
        ?? undefined

      const model = provider.createModel({ modelId, apiKey, baseURL: resolvedBaseURL })
      return {
        model,
        modelId,
        providerId: provider.id,
        source,
        ...(resolvedBaseURL !== undefined ? { baseURL: resolvedBaseURL } : {}),
      }
    },
  }
}
