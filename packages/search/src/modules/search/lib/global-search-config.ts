import type { ConfigScope, ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import type { SearchStrategyId } from '@open-mercato/shared/modules/search'

export const GLOBAL_SEARCH_STRATEGIES_KEY = 'global_search_strategies'

/** Default strategies when none are configured */
export const DEFAULT_GLOBAL_SEARCH_STRATEGIES: SearchStrategyId[] = ['fulltext', 'vector', 'tokens']

type Resolver = {
  resolve: <T = unknown>(name: string) => T
}

/**
 * Get the enabled strategies for global search (Cmd+K).
 * Falls back to all strategies if not configured.
 */
export async function resolveGlobalSearchStrategies(
  resolver: Resolver,
  options?: { defaultValue?: SearchStrategyId[]; scope?: ConfigScope },
): Promise<SearchStrategyId[]> {
  const fallback = options?.defaultValue ?? DEFAULT_GLOBAL_SEARCH_STRATEGIES
  let service: ModuleConfigService
  try {
    service = resolver.resolve<ModuleConfigService>('moduleConfigService')
  } catch {
    return fallback
  }
  try {
    const value = await service.getValue<SearchStrategyId[]>('search', GLOBAL_SEARCH_STRATEGIES_KEY, {
      defaultValue: fallback,
      scope: options?.scope,
    })
    // Ensure we always return a non-empty array
    if (!Array.isArray(value) || value.length === 0) {
      return fallback
    }
    return value
  } catch {
    return fallback
  }
}

/**
 * Save the enabled strategies for global search.
 */
export async function saveGlobalSearchStrategies(
  resolver: Resolver,
  strategies: SearchStrategyId[],
  options?: { scope?: ConfigScope },
): Promise<void> {
  let service: ModuleConfigService
  try {
    service = resolver.resolve<ModuleConfigService>('moduleConfigService')
  } catch {
    throw new Error('Module config service not available')
  }

  // Validate that at least one strategy is enabled
  if (!Array.isArray(strategies) || strategies.length === 0) {
    throw new Error('At least one search strategy must be enabled')
  }

  // Filter to only valid strategy IDs
  const validStrategies = strategies.filter(
    (s) => ['fulltext', 'vector', 'tokens'].includes(s)
  ) as SearchStrategyId[]

  if (validStrategies.length === 0) {
    throw new Error('At least one valid search strategy must be enabled')
  }

  await service.setValue('search', GLOBAL_SEARCH_STRATEGIES_KEY, validStrategies, options?.scope)
}

export type GlobalSearchSource = 'tenant' | 'instance' | 'env'

/**
 * Resolve the enabled strategies together with their source discriminator:
 * `tenant` (own scoped row), `instance` (inherited global row), or `env`
 * (no stored row -> default strategies).
 */
export async function resolveGlobalSearchStrategiesResult(
  resolver: Resolver,
  options?: { defaultValue?: SearchStrategyId[]; scope?: ConfigScope },
): Promise<{ strategies: SearchStrategyId[]; source: GlobalSearchSource }> {
  const fallback = options?.defaultValue ?? DEFAULT_GLOBAL_SEARCH_STRATEGIES
  let service: ModuleConfigService
  try {
    service = resolver.resolve<ModuleConfigService>('moduleConfigService')
  } catch {
    return { strategies: fallback, source: 'env' }
  }
  try {
    const record = await service.getRecord('search', GLOBAL_SEARCH_STRATEGIES_KEY, options?.scope)
    const value = record?.value
    if (Array.isArray(value) && value.length > 0) {
      return { strategies: value as SearchStrategyId[], source: record!.source }
    }
  } catch {}
  return { strategies: fallback, source: 'env' }
}
