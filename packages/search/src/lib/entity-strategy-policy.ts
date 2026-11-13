import { getSearchModuleConfigs } from '@open-mercato/shared/modules/search'
import type { SearchModuleConfig, SearchStrategyId } from '../types'

export function resolveEntityIndexStrategies(
  entityId: string,
  moduleConfigs: SearchModuleConfig[] = getSearchModuleConfigs(),
): SearchStrategyId[] | undefined {
  let strategies: SearchStrategyId[] | undefined
  for (const moduleConfig of moduleConfigs) {
    for (const entityConfig of moduleConfig.entities) {
      if (entityConfig.entityId !== entityId) continue
      strategies = entityConfig.enabled === false
        ? []
        : entityConfig.strategies ?? moduleConfig.defaultStrategies
    }
  }
  return strategies
}

export function isEntityIndexStrategyAllowed(
  entityId: string,
  strategyId: SearchStrategyId,
  moduleConfigs?: SearchModuleConfig[],
): boolean {
  const strategies = resolveEntityIndexStrategies(entityId, moduleConfigs)
  return strategies === undefined || strategies.includes(strategyId)
}
