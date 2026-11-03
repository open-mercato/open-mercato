/**
 * AzureAdapter — implements the LlmProvider port for Azure OpenAI / Microsoft
 * Foundry deployments.
 *
 * Azure used to be wired here as an OpenAI-compatible preset, which speaks the
 * Chat Completions surface. That surface cannot carry provider-executed tools:
 * Azure's native `web_search` is a Responses API built-in, so an agent on Azure
 * reported "provider azure has no native web search" no matter how capable the
 * deployed model was. `@ai-sdk/azure` calls the Responses API by default and
 * exposes those tools, so it replaces the preset under the same provider id.
 *
 * @see packages/shared/src/lib/ai/llm-provider.ts
 * @see https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/web-search
 */

import { createAzure } from '@ai-sdk/azure'
import type {
  EnvLookup,
  LlmCreateModelOptions,
  LlmModelInfo,
  LlmProvider,
} from '@open-mercato/shared/lib/ai/llm-provider'

const DEFAULT_MODEL = 'gpt-5-mini'

/**
 * Deployment names, not catalogue model names. On Azure the id you send is
 * whatever the operator called their deployment, so this list is a starting
 * point for the dropdown rather than a closed set.
 */
const DEFAULT_MODELS: readonly LlmModelInfo[] = [
  {
    id: 'gpt-5-mini',
    name: 'GPT-5 Mini',
    contextWindow: 128000,
    tags: ['budget'],
  },
  {
    id: 'gpt-5',
    name: 'GPT-5',
    contextWindow: 128000,
    tags: ['flagship'],
  },
  {
    id: 'gpt-5.5',
    name: 'GPT-5.5',
    contextWindow: 128000,
    tags: ['flagship', 'reasoning'],
  },
] as const

const API_KEY_ENV_KEYS = ['AZURE_OPENAI_API_KEY', 'AZURE_API_KEY'] as const
const RESOURCE_ENV_KEYS = ['AZURE_OPENAI_RESOURCE_NAME', 'AZURE_RESOURCE_NAME'] as const
const BASE_URL_ENV_KEYS = ['AZURE_OPENAI_BASE_URL'] as const

function firstValue(keys: readonly string[], env?: EnvLookup): string | null {
  const lookup = env ?? process.env
  for (const key of keys) {
    const value = lookup[key]
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (trimmed.length > 0) return trimmed
    }
  }
  return null
}

/**
 * Factory returning a fresh `AzureAdapter`. Stateless, so the caller may reuse it.
 *
 * Endpoint resolution prefers `AZURE_OPENAI_RESOURCE_NAME`, from which the SDK
 * assembles `https://{resource}.openai.azure.com/openai/v1{path}` itself. An
 * explicit `AZURE_OPENAI_BASE_URL` still wins when set — note the SDK appends
 * `/v1` to it, so it should point at the `/openai` prefix, not past it.
 */
export function createAzureAdapter(): LlmProvider {
  function resolveApiKey(env?: EnvLookup): string | null {
    return firstValue(API_KEY_ENV_KEYS, env)
  }

  return {
    id: 'azure',
    name: 'Azure OpenAI',
    envKeys: API_KEY_ENV_KEYS,
    defaultModel: DEFAULT_MODEL,
    defaultModels: DEFAULT_MODELS,

    isConfigured(env?: EnvLookup): boolean {
      // An endpoint is as load-bearing as the key here: unlike a hosted vendor
      // there is no default host to fall back on, and a key alone would make the
      // provider look ready and then fail on the first call.
      const hasEndpoint =
        firstValue(RESOURCE_ENV_KEYS, env) !== null || firstValue(BASE_URL_ENV_KEYS, env) !== null
      return resolveApiKey(env) !== null && hasEndpoint
    },

    resolveApiKey,

    getConfiguredEnvKey(env?: EnvLookup): string {
      const lookup = env ?? process.env
      for (const key of API_KEY_ENV_KEYS) {
        const value = lookup[key]
        if (typeof value === 'string' && value.trim().length > 0) return key
      }
      return API_KEY_ENV_KEYS[0]
    },

    createModel(options: LlmCreateModelOptions): unknown {
      const baseURL = options.baseURL ?? firstValue(BASE_URL_ENV_KEYS)
      const resourceName = firstValue(RESOURCE_ENV_KEYS)
      const azure = createAzure({
        apiKey: options.apiKey,
        ...(baseURL ? { baseURL } : resourceName ? { resourceName } : {}),
      })
      // Default call path is the Responses API, which is what carries the
      // provider-executed tools; `azure.chat()` would silently lose them.
      return azure(options.modelId)
    },
  }
}
