import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'

export const SEARCH_AUTO_INDEX_CONFIG_KEY = 'auto_index_enabled'

export function envDisablesAutoIndexing(): boolean {
  const raw = process.env.DISABLE_VECTOR_SEARCH_AUTOINDEXING
  if (!raw) return false
  return parseBooleanToken(raw) === true
}

type Resolver = {
  resolve: <T = unknown>(name: string) => T
}

export async function resolveAutoIndexingEnabled(
  resolver: Resolver,
  options?: { defaultValue?: boolean },
): Promise<boolean> {
  if (envDisablesAutoIndexing()) return false
  const fallback = options?.defaultValue ?? true
  let service: ModuleConfigService
  try {
    service = resolver.resolve<ModuleConfigService>('moduleConfigService')
  } catch {
    return fallback
  }
  try {
    // Still use 'vector' module key for backwards compatibility
    const value = await service.getValue<boolean>('vector', SEARCH_AUTO_INDEX_CONFIG_KEY, { defaultValue: fallback })
    return value !== false
  } catch {
    return fallback
  }
}
