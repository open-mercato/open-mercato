/**
 * OpenAIAdapter — implements the LlmProvider port for the OpenAI
 * chat-completions protocol.
 *
 * This single adapter serves OpenAI itself and every OpenAI-compatible
 * backend (DeepInfra, Groq, Together, Fireworks, Azure OpenAI, LiteLLM,
 * Ollama, LocalAI, vLLM, …). Vendor-specific configuration — endpoint
 * URL, available models, env var conventions — lives in
 * `./openai-compatible-presets.ts` as plain data, not code.
 *
 * The factory {@link createOpenAICompatibleProvider} takes a preset and
 * returns a fully-configured `LlmProvider` that internally calls
 * `createOpenAI({ apiKey, baseURL })` from `@ai-sdk/openai`.
 *
 * @see packages/shared/src/lib/ai/llm-provider.ts
 * @see ./openai-compatible-presets.ts
 * @see .ai/specs/2026-04-14-llm-provider-ports-and-adapters.md
 */

import { createOpenAI } from '@ai-sdk/openai'
import type {
  EnvLookup,
  LlmCreateModelOptions,
  LlmModelInfo,
  LlmProvider,
} from '@open-mercato/shared/lib/ai/llm-provider'

/**
 * Configuration for a single OpenAI-compatible provider instance.
 *
 * Built-in presets live in {@link ./openai-compatible-presets.ts}.
 * Downstream applications may construct custom presets at bootstrap time
 * and register them with `llmProviderRegistry.register(
 *   createOpenAICompatibleProvider(customPreset),
 * )`.
 */
export interface OpenAICompatiblePreset {
  /** Stable id (e.g. `openai`, `deepinfra`, `groq`, `together`). */
  id: string
  /** Human-readable display name. */
  name: string
  /**
   * Upstream base URL. Leave `undefined` to use the AI SDK default
   * (`https://api.openai.com/v1`). Required for DeepInfra, Groq, etc.
   */
  baseURL?: string
  /**
   * Env var names where the adapter looks for the API key, in priority
   * order. Each preset declares its own keys so unrelated presets never
   * accidentally share credentials (e.g. DeepInfra uses
   * `DEEPINFRA_API_KEY`, not `OPENAI_API_KEY`).
   */
  envKeys: readonly string[]
  /** Default model id used when the caller does not specify one. */
  defaultModel: string
  /** Curated model catalog shown in the UI dropdown. */
  defaultModels: readonly LlmModelInfo[]
  /**
   * Optional env var names for overriding the base URL at runtime.
   * Primarily used by presets that rely on a user-supplied URL
   * (Azure deployment, self-hosted LiteLLM, Ollama on a custom port).
   * The first non-empty value wins and overrides {@link baseURL}.
   */
  baseURLEnvKeys?: readonly string[]
}

function readFirstNonEmpty(
  env: EnvLookup,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const value = env[key]
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (trimmed.length > 0) return trimmed
    }
  }
  return null
}

/**
 * Builds a `LlmProvider` instance bound to a specific OpenAI-compatible
 * preset. The returned object is stateless and can be registered directly
 * with `llmProviderRegistry.register(...)`.
 */
export function createOpenAICompatibleProvider(
  preset: OpenAICompatiblePreset,
): LlmProvider {
  if (!preset.id || preset.id.length === 0) {
    throw new Error('[OpenAIAdapter] Preset must have a non-empty id')
  }
  if (!preset.envKeys || preset.envKeys.length === 0) {
    throw new Error(
      `[OpenAIAdapter] Preset "${preset.id}" must declare at least one env key`,
    )
  }

  function resolveApiKey(env?: EnvLookup): string | null {
    return readFirstNonEmpty(env ?? process.env, preset.envKeys)
  }

  function resolveBaseURL(env?: EnvLookup): string | undefined {
    const lookup = env ?? process.env
    if (preset.baseURLEnvKeys && preset.baseURLEnvKeys.length > 0) {
      const override = readFirstNonEmpty(lookup, preset.baseURLEnvKeys)
      if (override) return override
    }
    return preset.baseURL
  }

  return {
    id: preset.id,
    name: preset.name,
    envKeys: preset.envKeys,
    defaultModel: preset.defaultModel,
    defaultModels: preset.defaultModels,

    isConfigured(env?: EnvLookup): boolean {
      return resolveApiKey(env) !== null
    },

    resolveApiKey,

    getConfiguredEnvKey(env?: EnvLookup): string {
      const lookup = env ?? process.env
      for (const key of preset.envKeys) {
        const value = lookup[key]
        if (typeof value === 'string' && value.trim().length > 0) {
          return key
        }
      }
      return preset.envKeys[0]
    },

    createModel(options: LlmCreateModelOptions): unknown {
      // Per-request baseURL override wins over preset/env defaults.
      const baseURL = options.baseURL ?? resolveBaseURL()
      const openai = createOpenAI({
        apiKey: options.apiKey,
        ...(baseURL ? { baseURL } : {}),
      })
      return openai(options.modelId)
    },
  }
}
