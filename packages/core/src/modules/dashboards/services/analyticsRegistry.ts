import type {
  AnalyticsEntityConfig,
  AnalyticsEntityTypeConfig,
  AnalyticsFieldMapping,
  AnalyticsLabelResolverConfig,
  AnalyticsModuleConfig,
} from '@open-mercato/shared/modules/analytics'
import { getAnalyticsModuleConfigs } from '@open-mercato/shared/modules/analytics'

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
      for (const entityConfig of moduleConfig.entities) {
        this.entityConfigMap.set(entityConfig.entityId, entityConfig)
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
    return config?.entityConfig ?? null
  }

  getFieldMapping(entityId: string, field: string): AnalyticsFieldMapping | null {
    const config = this.getEntityConfig(entityId)
    return config?.fieldMappings[field] ?? null
  }

  getRequiredFeatures(entityId: string): string[] | null {
    const config = this.getEntityConfig(entityId)
    return config?.requiredFeatures ?? null
  }

  getLabelResolverConfig(entityId: string, field: string): AnalyticsLabelResolverConfig | null {
    const config = this.getEntityConfig(entityId)
    return config?.labelResolvers?.[field] ?? null
  }

  getAllFieldMappings(entityId: string): Record<string, AnalyticsFieldMapping> | null {
    const config = this.getEntityConfig(entityId)
    return config?.fieldMappings ?? null
  }
}

export function createAnalyticsRegistry(configs?: AnalyticsModuleConfig[]): AnalyticsRegistry {
  return new DefaultAnalyticsRegistry(configs)
}
