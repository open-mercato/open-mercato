import type { VectorSearchEntityConfig } from '@open-mercato/shared/modules/vector-search'
import { modules } from '@/generated/modules.generated'

const registry = new Map<string, VectorSearchEntityConfig>()

export function resolveVectorSearchConfigs(): Map<string, VectorSearchEntityConfig> {
  if (registry.size > 0) return registry

  for (const entry of modules as any[]) {
    const customEntities = Array.isArray(entry?.customEntities) ? entry.customEntities : []
    for (const spec of customEntities) {
      if (!spec || typeof spec !== 'object') continue
      const entityId = typeof spec.id === 'string' ? spec.id : null
      if (!entityId) continue
      const vectorSpec = spec.vectorSearch
      if (!vectorSpec || vectorSpec.enabled === false) continue
      registry.set(entityId, { entity: entityId, ...vectorSpec })
    }
  }

  return registry
}
