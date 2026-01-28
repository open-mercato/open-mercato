export type AggregateFunction = 'count' | 'sum' | 'avg' | 'min' | 'max'

export type DateGranularity = 'day' | 'week' | 'month' | 'quarter' | 'year'

export type AnalyticsFieldType = 'numeric' | 'text' | 'uuid' | 'timestamp' | 'jsonb'

export type AnalyticsEntityTypeConfig = {
  tableName: string
  schema?: string
  dateField: string
  defaultScopeFields: string[]
}

export type AnalyticsFieldMapping = {
  dbColumn: string
  type: AnalyticsFieldType
}

export type AnalyticsLabelResolverConfig = {
  table: string
  idColumn: string
  labelColumn: string
}

export type AnalyticsEntityConfig = {
  entityId: string
  requiredFeatures: string[]
  entityConfig: AnalyticsEntityTypeConfig
  fieldMappings: Record<string, AnalyticsFieldMapping>
  labelResolvers?: Record<string, AnalyticsLabelResolverConfig>
}

export type AnalyticsModuleConfig = {
  entities: AnalyticsEntityConfig[]
}

let _analyticsModuleConfigs: AnalyticsModuleConfig[] | null = null

export function registerAnalyticsModuleConfigs(configs: AnalyticsModuleConfig[]): void {
  if (_analyticsModuleConfigs !== null && process.env.NODE_ENV === 'development') {
    console.debug('[Bootstrap] Analytics module configs re-registered (this may occur during HMR)')
  }
  _analyticsModuleConfigs = configs
}

export function getAnalyticsModuleConfigs(): AnalyticsModuleConfig[] {
  return _analyticsModuleConfigs ?? []
}

export function getAllAnalyticsEntityConfigs(): AnalyticsEntityConfig[] {
  const configs = getAnalyticsModuleConfigs()
  return configs.flatMap((moduleConfig) => moduleConfig.entities)
}

export function getAnalyticsEntityConfig(entityId: string): AnalyticsEntityConfig | null {
  const entities = getAllAnalyticsEntityConfigs()
  return entities.find((e) => e.entityId === entityId) ?? null
}
