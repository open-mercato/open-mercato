import type {
  AnalyticsEntityConfig,
  AnalyticsEntityTypeConfig,
  AnalyticsFieldMapping,
  AnalyticsLabelResolverConfig,
  AnalyticsModuleConfig,
} from '@open-mercato/shared/modules/analytics'
import { getAnalyticsModuleConfigs } from '@open-mercato/shared/modules/analytics'
import { assertSafeIdentifier, hasOwnProperty, readOwnProperty } from '../lib/identifiers'

export interface AnalyticsRegistry {
  getAllEntityConfigs(): AnalyticsEntityConfig[]
  getEntityConfig(entityId: string): AnalyticsEntityConfig | null
  isValidEntityType(entityId: string): boolean
  getEntityTypeConfig(entityId: string): AnalyticsEntityTypeConfig | null
  getFieldMapping(entityId: string, field: string): AnalyticsFieldMapping | null
  getRequiredFeatures(entityId: string): string[] | null
  getLabelResolverConfig(entityId: string, field: string): AnalyticsLabelResolverConfig | null
  getAllFieldMappings(entityId: string): Record<string, AnalyticsFieldMapping> | null
}

function normalizeFieldMapping(mapping: unknown): AnalyticsFieldMapping | null {
  if (!mapping || typeof mapping !== 'object') return null
  const candidate = mapping as AnalyticsFieldMapping
  const dbColumn = assertSafeIdentifier(readOwnProperty(candidate, 'dbColumn'), 'column name')
  const type = readOwnProperty(candidate, 'type')
  if (typeof type !== 'string') return null
  const normalized = Object.create(null) as AnalyticsFieldMapping
  normalized.dbColumn = dbColumn
  normalized.type = type
  return normalized
}

export class DefaultAnalyticsRegistry implements AnalyticsRegistry {
  private configs: AnalyticsModuleConfig[]
  private entityConfigMap: Map<string, AnalyticsEntityConfig>

  constructor(configs?: AnalyticsModuleConfig[]) {
    this.configs = configs ?? getAnalyticsModuleConfigs()
    this.entityConfigMap = new Map()
    this.buildEntityConfigMap()
  }

  private buildEntityConfigMap(): void {
    for (const moduleConfig of this.configs) {
      const entities = readOwnProperty(moduleConfig, 'entities')
      if (!Array.isArray(entities)) continue
      for (const entityConfig of entities) {
        const entityId = readOwnProperty(entityConfig, 'entityId')
        if (typeof entityId !== 'string' || !entityId) continue
        this.entityConfigMap.set(entityId, entityConfig)
      }
    }
  }

  getAllEntityConfigs(): AnalyticsEntityConfig[] {
    return Array.from(this.entityConfigMap.values())
  }

  getEntityConfig(entityId: string): AnalyticsEntityConfig | null {
    return this.entityConfigMap.get(entityId) ?? null
  }

  isValidEntityType(entityId: string): boolean {
    return this.entityConfigMap.has(entityId)
  }

  getEntityTypeConfig(entityId: string): AnalyticsEntityTypeConfig | null {
    const config = this.getEntityConfig(entityId)
    const entityConfig = readOwnProperty(config, 'entityConfig')
    if (!entityConfig || typeof entityConfig !== 'object') return null

    const tableName = assertSafeIdentifier(readOwnProperty(entityConfig, 'tableName'), 'table name')
    const schema = readOwnProperty(entityConfig, 'schema')
    if (schema !== undefined) {
      assertSafeIdentifier(schema, 'schema name')
    }

    const normalized = Object.create(null) as AnalyticsEntityTypeConfig
    normalized.tableName = tableName
    normalized.dateField = readOwnProperty(entityConfig, 'dateField') as string
    normalized.defaultScopeFields = readOwnProperty(entityConfig, 'defaultScopeFields') as string[]
    if (schema !== undefined) {
      normalized.schema = schema
    }
    const currencyField = readOwnProperty(entityConfig, 'currencyField')
    if (currencyField !== undefined) {
      normalized.currencyField = currencyField
    }
    return normalized
  }

  getFieldMapping(entityId: string, field: string): AnalyticsFieldMapping | null {
    const config = this.getEntityConfig(entityId)
    const fieldMappings = readOwnProperty(config, 'fieldMappings')
    if (!fieldMappings || typeof fieldMappings !== 'object') return null
    if (!hasOwnProperty(fieldMappings, field)) return null
    return normalizeFieldMapping(fieldMappings[field])
  }

  getRequiredFeatures(entityId: string): string[] | null {
    const config = this.getEntityConfig(entityId)
    const requiredFeatures = readOwnProperty(config, 'requiredFeatures')
    return Array.isArray(requiredFeatures) ? requiredFeatures : null
  }

  getLabelResolverConfig(entityId: string, field: string): AnalyticsLabelResolverConfig | null {
    const config = this.getEntityConfig(entityId)
    const labelResolvers = readOwnProperty(config, 'labelResolvers')
    if (!labelResolvers || typeof labelResolvers !== 'object') return null
    if (!hasOwnProperty(labelResolvers, field)) return null
    const resolver = labelResolvers[field]
    if (!resolver || typeof resolver !== 'object') return null

    const table = assertSafeIdentifier(readOwnProperty(resolver, 'table'), 'table name')
    const idColumn = assertSafeIdentifier(readOwnProperty(resolver, 'idColumn'), 'id column')
    const labelColumn = assertSafeIdentifier(readOwnProperty(resolver, 'labelColumn'), 'label column')
    const normalized = Object.create(null) as AnalyticsLabelResolverConfig
    normalized.table = table
    normalized.idColumn = idColumn
    normalized.labelColumn = labelColumn
    return normalized
  }

  getAllFieldMappings(entityId: string): Record<string, AnalyticsFieldMapping> | null {
    const config = this.getEntityConfig(entityId)
    const fieldMappings = readOwnProperty(config, 'fieldMappings')
    if (!fieldMappings || typeof fieldMappings !== 'object') return null
    const normalized = Object.create(null) as Record<string, AnalyticsFieldMapping>
    for (const key of Object.keys(fieldMappings)) {
      const mapping = normalizeFieldMapping(fieldMappings[key])
      if (mapping) {
        normalized[key] = mapping
      }
    }
    return normalized
  }
}

export function createAnalyticsRegistry(configs?: AnalyticsModuleConfig[]): AnalyticsRegistry {
  return new DefaultAnalyticsRegistry(configs)
}
