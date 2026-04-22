import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import {
  OPEN_CODE_PROVIDER_IDS,
  OPEN_CODE_PROVIDERS,
  isOpenCodeProviderConfigured,
  type OpenCodeProviderId,
} from '@open-mercato/shared/lib/ai/opencode-provider'

// Types
export type ChatProviderId = OpenCodeProviderId

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

export const CHAT_PROVIDERS: Record<ChatProviderId, ChatProviderInfo> = {
  openai: {
    name: OPEN_CODE_PROVIDERS.openai.name,
    envKeyRequired: OPEN_CODE_PROVIDERS.openai.envKeys[0],
    defaultModel: OPEN_CODE_PROVIDERS.openai.defaultModel,
    models: [
      { id: OPEN_CODE_PROVIDERS.openai.defaultModel, name: 'GPT-4o Mini', contextWindow: 128000 },
    ],
  },
  anthropic: {
    name: OPEN_CODE_PROVIDERS.anthropic.name,
    envKeyRequired: OPEN_CODE_PROVIDERS.anthropic.envKeys[0],
    defaultModel: OPEN_CODE_PROVIDERS.anthropic.defaultModel,
    models: [
      { id: OPEN_CODE_PROVIDERS.anthropic.defaultModel, name: 'Claude Haiku 4.5', contextWindow: 200000 },
    ],
  },
  google: {
    name: OPEN_CODE_PROVIDERS.google.name,
    envKeyRequired: OPEN_CODE_PROVIDERS.google.envKeys[0],
    defaultModel: OPEN_CODE_PROVIDERS.google.defaultModel,
    models: [
      { id: OPEN_CODE_PROVIDERS.google.defaultModel, name: 'Gemini 3 Flash', contextWindow: 1048576 },
    ],
  },
}

export const DEFAULT_CHAT_CONFIG: Omit<ChatProviderConfig, 'updatedAt'> = {
  providerId: 'openai',
  model: OPEN_CODE_PROVIDERS.openai.defaultModel,
}

// Provider configuration checks
export function isProviderConfigured(providerId: ChatProviderId): boolean {
  return isOpenCodeProviderConfigured(providerId)
}

export function getConfiguredProviders(): ChatProviderId[] {
  const providers: ChatProviderId[] = []
  for (const providerId of OPEN_CODE_PROVIDER_IDS) {
    if (isProviderConfigured(providerId)) {
      providers.push(providerId)
    }
  }
  return providers
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
  return { ...DEFAULT_CHAT_CONFIG, updatedAt: new Date().toISOString() }
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
