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
  /**
   * True when the column is encrypted at rest. Encrypted columns must never be
   * offered as a group-by dimension: grouping happens on the raw ciphertext,
   * which is opaque (and random-IV, so every row is its own group). Resolve the
   * decrypted value through a `labelResolvers` entry on the owning id instead.
   */
  encrypted?: boolean
}

export type AnalyticsLabelResolverConfig = {
  table: string
  idColumn: string
  labelColumn: string
}

export type AnalyticsEntityConfig = {
  entityId: string
  /**
   * ACL features the caller must ALL hold (wildcard-aware) to read this entity's
   * analytics. An EMPTY array makes the entity world-readable to every
   * authenticated dashboard user: the catalog lists it and the widget-data /
   * insights routes aggregate it for anyone. Always list the gating feature(s)
   * (e.g. the owning module's `*.view`) unless the data is deliberately public.
   */
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
