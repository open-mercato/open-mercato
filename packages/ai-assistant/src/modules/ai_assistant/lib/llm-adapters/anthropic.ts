/**
 * AnthropicAdapter — implements the LlmProvider port for Anthropic's
 * Messages API (Claude Haiku, Sonnet, Opus).
 *
 * Wraps `createAnthropic({ apiKey })` from `@ai-sdk/anthropic` and exposes
 * a curated model list for the AI Assistant UI dropdown.
 *
 * @see packages/shared/src/lib/ai/llm-provider.ts
 * @see .ai/specs/2026-04-14-llm-provider-ports-and-adapters.md
 */

import { createAnthropic } from '@ai-sdk/anthropic'
import type {
  EnvLookup,
  LlmCreateModelOptions,
  LlmModelInfo,
  LlmProvider,
} from '@open-mercato/shared/lib/ai/llm-provider'

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001'

const DEFAULT_MODELS: readonly LlmModelInfo[] = [
  {
    id: 'claude-haiku-4-5-20251001',
    name: 'Claude Haiku 4.5',
    contextWindow: 200000,
    tags: ['budget'],
  },
  {
    id: 'claude-sonnet-4-6-20260107',
    name: 'Claude Sonnet 4.6',
    contextWindow: 200000,
    tags: ['flagship'],
  },
  {
    id: 'claude-opus-4-6-20260107',
    name: 'Claude Opus 4.6',
    contextWindow: 1000000,
    tags: ['flagship', 'reasoning'],
  },
] as const

/**
 * Factory returning a fresh `AnthropicAdapter` instance. The adapter is
 * stateless — caller is free to reuse the returned object.
 *
 * `createModel` accepts an optional `baseURL` from {@link LlmCreateModelOptions}
 * and forwards it to `createAnthropic({ apiKey, baseURL })`.
 *
 * baseURL only works for Anthropic Messages-protocol relays (Cloudflare AI
 * Gateway in Anthropic mode, Helicone proxy). For OpenAI-format gateways,
 * use the OpenAI / OpenRouter presets.
 */
export function createAnthropicAdapter(): LlmProvider {
  const envKeys = ['ANTHROPIC_API_KEY', 'OPENCODE_ANTHROPIC_API_KEY'] as const

  function resolveApiKey(env?: EnvLookup): string | null {
    const lookup = env ?? process.env
    for (const key of envKeys) {
      const value = lookup[key]
      if (typeof value === 'string') {
        const trimmed = value.trim()
        if (trimmed.length > 0) return trimmed
      }
    }
    return null
  }

  return {
    id: 'anthropic',
    name: 'Anthropic',
    envKeys,
    defaultModel: DEFAULT_MODEL,
    defaultModels: DEFAULT_MODELS,

    isConfigured(env?: EnvLookup): boolean {
      return resolveApiKey(env) !== null
    },

    resolveApiKey,

    getConfiguredEnvKey(env?: EnvLookup): string {
      const lookup = env ?? process.env
      for (const key of envKeys) {
        const value = lookup[key]
        if (typeof value === 'string' && value.trim().length > 0) {
          return key
        }
      }
      return envKeys[0]
    },

    createModel(options: LlmCreateModelOptions): unknown {
      const anthropic = createAnthropic({
        apiKey: options.apiKey,
        ...(options.baseURL ? { baseURL: options.baseURL } : {}),
      })
      return anthropic(options.modelId)
    },
  }
}
