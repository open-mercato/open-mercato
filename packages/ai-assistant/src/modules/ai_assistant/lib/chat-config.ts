import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'

// Types
export type ChatProviderId = 'openai' | 'anthropic' | 'google'

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
    name: 'OpenAI',
    envKeyRequired: 'OPENAI_API_KEY',
    defaultModel: 'gpt-4o',
    models: [
      { id: 'gpt-4o', name: 'GPT-4o', contextWindow: 128000 },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini', contextWindow: 128000 },
      { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', contextWindow: 128000 },
      { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', contextWindow: 16385 },
    ],
  },
  anthropic: {
    name: 'Anthropic',
    envKeyRequired: 'ANTHROPIC_API_KEY',
    defaultModel: 'claude-sonnet-4-20250514',
    models: [
      { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', contextWindow: 200000 },
      { id: 'claude-opus-4-20250514', name: 'Claude Opus 4', contextWindow: 200000 },
      { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', contextWindow: 200000 },
      { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', contextWindow: 200000 },
    ],
  },
  google: {
    name: 'Google',
    envKeyRequired: 'GOOGLE_GENERATIVE_AI_API_KEY',
    defaultModel: 'gemini-1.5-pro',
    models: [
      { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', contextWindow: 2097152 },
      { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', contextWindow: 1048576 },
      { id: 'gemini-pro', name: 'Gemini Pro', contextWindow: 32000 },
    ],
  },
}

export const DEFAULT_CHAT_CONFIG: Omit<ChatProviderConfig, 'updatedAt'> = {
  providerId: 'openai',
  model: 'gpt-4o',
}

// Provider configuration checks
export function isProviderConfigured(providerId: ChatProviderId): boolean {
  switch (providerId) {
    case 'openai':
      return Boolean(process.env.OPENAI_API_KEY?.trim())
    case 'anthropic':
      return Boolean(process.env.ANTHROPIC_API_KEY?.trim())
    case 'google':
      return Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim())
    default:
      return false
  }
}

export function getConfiguredProviders(): ChatProviderId[] {
  const providers: ChatProviderId[] = []
  const allProviders: ChatProviderId[] = ['openai', 'anthropic', 'google']
  for (const providerId of allProviders) {
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
