/**
 * GoogleAdapter — implements the LlmProvider port for Google's Generative
 * AI API (Gemini Flash, Pro).
 *
 * Wraps `createGoogleGenerativeAI({ apiKey })` from `@ai-sdk/google`.
 *
 * @see packages/shared/src/lib/ai/llm-provider.ts
 * @see .ai/specs/2026-04-14-llm-provider-ports-and-adapters.md
 */

import { createGoogleGenerativeAI } from '@ai-sdk/google'
import type {
  EnvLookup,
  LlmCreateModelOptions,
  LlmModelInfo,
  LlmProvider,
} from '@open-mercato/shared/lib/ai/llm-provider'

const DEFAULT_MODEL = 'gemini-3-flash'

const DEFAULT_MODELS: readonly LlmModelInfo[] = [
  {
    id: 'gemini-3-flash',
    name: 'Gemini 3 Flash',
    contextWindow: 1048576,
    tags: ['budget'],
  },
  {
    id: 'gemini-3-pro',
    name: 'Gemini 3 Pro',
    contextWindow: 1048576,
    tags: ['flagship'],
  },
] as const

export function createGoogleAdapter(): LlmProvider {
  const envKeys = ['GOOGLE_GENERATIVE_AI_API_KEY'] as const

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
    id: 'google',
    name: 'Google',
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
      const google = createGoogleGenerativeAI({ apiKey: options.apiKey })
      return google(options.modelId)
    },
  }
}
