import type { ConfigScope, ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import {
  envDisablesAutoIndexing,
  SEARCH_AUTO_INDEX_CONFIG_KEY,
  SEARCH_AUTO_INDEX_CONFIG_MODULE,
} from '@open-mercato/shared/lib/search/auto-indexing'

export { envDisablesAutoIndexing, SEARCH_AUTO_INDEX_CONFIG_KEY, SEARCH_AUTO_INDEX_CONFIG_MODULE }

type Resolver = {
  resolve: <T = unknown>(name: string) => T
}

export async function resolveAutoIndexingEnabled(
  resolver: Resolver,
  options?: { defaultValue?: boolean; scope?: ConfigScope },
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
    const value = await service.getValue<boolean>(SEARCH_AUTO_INDEX_CONFIG_MODULE, SEARCH_AUTO_INDEX_CONFIG_KEY, {
      defaultValue: fallback,
      scope: options?.scope,
    })
    return value !== false
  } catch {
    return fallback
  }
}
