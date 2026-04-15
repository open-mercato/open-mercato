import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import { llmProviderRegistry } from '@open-mercato/shared/lib/ai/llm-provider-registry'
import type { LlmProvider } from '@open-mercato/shared/lib/ai/llm-provider'
// Side-effect: ensures the registry is populated with built-in adapters
// and OpenAI-compatible presets before this module's getters run.
import './llm-bootstrap'

// Types
//
// `ChatProviderId` was previously a narrow literal union of three ids
// (`'anthropic' | 'openai' | 'google'`). After the ports & adapters
// refactor the registry accepts any stable id string, so this type
// becomes `string`. Backward-compatibility note: downstream callers that
// used exhaustive switches on the old union must add a `default:` branch.
// See `.ai/specs/2026-04-14-llm-provider-ports-and-adapters.md`.
export type ChatProviderId = string

export type ChatModelInfo = {
  id: string
  name: string
  contextWindow: number
}

export type ChatProviderInfo = {
  name: string
  envKeyRequired: string
  defaultModel: string
  models: ChatModelInfo[]
}

export type ChatProviderConfig = {
  providerId: ChatProviderId
  model: string
  updatedAt: string
}

// Constants
export const CHAT_CONFIG_KEY = 'chat_provider'

function providerToChatInfo(provider: LlmProvider): ChatProviderInfo {
  return {
    name: provider.name,
    envKeyRequired: provider.envKeys[0],
    defaultModel: provider.defaultModel,
    models: provider.defaultModels.map((m) => ({
      id: m.id,
      name: m.name,
      contextWindow: m.contextWindow,
    })),
  }
}

/**
 * `CHAT_PROVIDERS` is a dynamic getter that returns all providers
 * registered with `llmProviderRegistry`. The shape
 * (`Record<string, ChatProviderInfo>`) is preserved so existing code that
 * indexed the map with a string literal (`CHAT_PROVIDERS['anthropic']`)
 * keeps working — it is now a runtime lookup against the registry.
 */
export const CHAT_PROVIDERS: Record<string, ChatProviderInfo> = new Proxy(
  {} as Record<string, ChatProviderInfo>,
  {
    get(_target, prop: string): ChatProviderInfo | undefined {
      if (typeof prop !== 'string') return undefined
      const provider = llmProviderRegistry.get(prop)
      return provider ? providerToChatInfo(provider) : undefined
    },
    has(_target, prop: string): boolean {
      if (typeof prop !== 'string') return false
      return llmProviderRegistry.get(prop) !== null
    },
    ownKeys(): string[] {
      return llmProviderRegistry.list().map((p) => p.id)
    },
    getOwnPropertyDescriptor(_target, prop: string): PropertyDescriptor | undefined {
      if (typeof prop !== 'string') return undefined
      const provider = llmProviderRegistry.get(prop)
      if (!provider) return undefined
      return {
        enumerable: true,
        configurable: true,
        value: providerToChatInfo(provider),
      }
    },
  },
)

export const DEFAULT_CHAT_CONFIG: Omit<ChatProviderConfig, 'updatedAt'> = {
  providerId: 'openai',
  get model(): string {
    // Lazy resolution so the bootstrap has a chance to register providers
    // before the default is computed.
    const provider = llmProviderRegistry.get('openai')
    return provider?.defaultModel ?? 'gpt-5-mini'
  },
}

// Provider configuration checks
export function isProviderConfigured(providerId: ChatProviderId): boolean {
  const provider = llmProviderRegistry.get(providerId)
  return provider?.isConfigured() ?? false
}

export function getConfiguredProviders(): ChatProviderId[] {
  return llmProviderRegistry
    .listConfigured()
    .map((p) => p.id)
}

// Config resolution
type Resolver = {
  resolve: <T = unknown>(name: string) => T
}

export async function resolveChatConfig(
  resolver: Resolver,
  options?: { defaultValue?: ChatProviderConfig | null }
): Promise<ChatProviderConfig | null> {
  const fallback = options?.defaultValue ?? null
  let service: ModuleConfigService
  try {
    service = resolver.resolve<ModuleConfigService>('moduleConfigService')
  } catch {
    return fallback
  }
  try {
    const value = await service.getValue<ChatProviderConfig>('ai_assistant', CHAT_CONFIG_KEY, { defaultValue: fallback })
    return value
  } catch {
    return fallback
  }
}

export async function saveChatConfig(
  resolver: Resolver,
  config: Omit<ChatProviderConfig, 'updatedAt'>
): Promise<ChatProviderConfig> {
  let service: ModuleConfigService
  try {
    service = resolver.resolve<ModuleConfigService>('moduleConfigService')
  } catch {
    throw new Error('Configuration service unavailable')
  }
  const fullConfig: ChatProviderConfig = {
    ...config,
    updatedAt: new Date().toISOString(),
  }
  await service.setValue('ai_assistant', CHAT_CONFIG_KEY, fullConfig)
  return fullConfig
}

export function createDefaultConfig(): ChatProviderConfig {
  return {
    providerId: DEFAULT_CHAT_CONFIG.providerId,
    model: DEFAULT_CHAT_CONFIG.model,
    updatedAt: new Date().toISOString(),
  }
}

// Get model info by ID
export function getModelInfo(providerId: ChatProviderId, modelId: string): ChatModelInfo | null {
  const provider = CHAT_PROVIDERS[providerId]
  if (!provider) return null
  return provider.models.find((m) => m.id === modelId) ?? null
}

// Format context window for display
export function formatContextWindow(contextWindow: number): string {
  if (contextWindow >= 1000000) {
    return `${(contextWindow / 1000000).toFixed(1)}M`
  }
  return `${(contextWindow / 1000).toFixed(0)}K`
}
