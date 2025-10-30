import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'

const truthy = new Set(['1', 'true', 'yes', 'on'])

export const VECTOR_AUTO_INDEX_CONFIG_KEY = 'auto_index_enabled'

export function envDisablesVectorAutoIndexing(): boolean {
  const raw = process.env.DISABLE_VECTOR_SEARCH_AUTOINDEXING
  if (!raw) return false
  const normalized = raw.trim().toLowerCase()
  return truthy.has(normalized)
}

type Resolver = {
  resolve: <T = any>(name: string) => T
}

export async function resolveVectorAutoIndexingEnabled(
  resolver: Resolver,
  options?: { defaultValue?: boolean },
): Promise<boolean> {
  if (envDisablesVectorAutoIndexing()) return false
  const fallback = options?.defaultValue ?? true
  let service: ModuleConfigService
  try {
    service = resolver.resolve<ModuleConfigService>('moduleConfigService')
  } catch {
    return fallback
  }
  try {
    const value = await service.getValue<boolean>('vector', VECTOR_AUTO_INDEX_CONFIG_KEY, { defaultValue: fallback })
    return value !== false
  } catch {
    return fallback
  }
}

