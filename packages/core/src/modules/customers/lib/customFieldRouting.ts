import type { EntityManager } from '@mikro-orm/postgresql'
import { CustomFieldDef } from '@open-mercato/core/modules/entities/data/entities'

export const CUSTOMER_ENTITY_ID = 'customers:customer_entity'
export const PERSON_ENTITY_ID = 'customers:customer_person_profile'

type DefinitionScore = { base: number; penalty: number; entityIndex: number }

function normalizeCustomFieldConfig(raw: unknown): Record<string, any> {
  if (!raw) return {}
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }
  if (typeof raw === 'object') {
    return { ...(raw as Record<string, any>) }
  }
  return {}
}

function scoreDefinition(kind: string, cfg: Record<string, any>, entityIndex: number): DefinitionScore {
  const listVisibleScore = cfg.listVisible === false ? 0 : 1
  const formEditableScore = cfg.formEditable === false ? 0 : 1
  const filterableScore = cfg.filterable ? 1 : 0
  const kindScore = (() => {
    switch (kind) {
      case 'dictionary':
        return 8
      case 'relation':
        return 6
      case 'select':
        return 4
      case 'multiline':
        return 3
      case 'boolean':
      case 'integer':
      case 'float':
        return 2
      default:
        return 1
    }
  })()
  const optionsBonus = Array.isArray(cfg.options) && cfg.options.length ? 2 : 0
  const dictionaryBonus =
    typeof cfg.dictionaryId === 'string' && cfg.dictionaryId.trim().length ? 5 : 0
  const base = (listVisibleScore * 16) + (formEditableScore * 8) + (filterableScore * 4) + kindScore + optionsBonus + dictionaryBonus
  const penalty = typeof cfg.priority === 'number' ? cfg.priority : 0
  return { base, penalty, entityIndex }
}

export async function resolvePersonCustomFieldRouting(
  em: EntityManager,
  tenantId: string | null | undefined,
  organizationId: string | null | undefined
): Promise<Map<string, string>> {
  const entityIds = [CUSTOMER_ENTITY_ID, PERSON_ENTITY_ID]
  const scopeClauses: any[] = []
  if (tenantId) scopeClauses.push({ $or: [{ tenantId }, { tenantId: null }] })
  else scopeClauses.push({ tenantId: null })
  if (organizationId) scopeClauses.push({ $or: [{ organizationId }, { organizationId: null }] })

  const where: Record<string, any> = {
    entityId: { $in: entityIds as any },
    deletedAt: null,
    isActive: true,
  }
  if (scopeClauses.length) where.$and = scopeClauses

  const defs = await em.find(CustomFieldDef, where as any)
  const order = new Map<string, number>()
  entityIds.forEach((id, index) => order.set(id, index))

  const bestByKey = new Map<string, { entityId: string; metrics: DefinitionScore }>()
  for (const def of defs) {
    const cfg = normalizeCustomFieldConfig((def as any).configJson)
    const metrics = scoreDefinition(
      def.kind,
      cfg,
      order.get(def.entityId) ?? Number.MAX_SAFE_INTEGER,
    )
    const existing = bestByKey.get(def.key)
    const better = !existing
      || metrics.base > existing.metrics.base
      || (metrics.base === existing.metrics.base && (
        metrics.penalty < existing.metrics.penalty
        || (metrics.penalty === existing.metrics.penalty && metrics.entityIndex < existing.metrics.entityIndex)
      ))
    if (better) {
      bestByKey.set(def.key, { entityId: def.entityId, metrics })
    }
  }

  const routing = new Map<string, string>()
  for (const [key, entry] of bestByKey.entries()) {
    routing.set(key, entry.entityId)
  }
  return routing
}

export function mergePersonCustomFieldValues(
  routing: Map<string, string>,
  entityValues: Record<string, unknown>,
  profileValues: Record<string, unknown>
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...entityValues }
  for (const [key, value] of Object.entries(profileValues)) {
    const normalizedKey = key.startsWith('cf_') ? key.slice(3) : key
    const target = routing.get(normalizedKey)
    if (target === CUSTOMER_ENTITY_ID) {
      if (!Object.prototype.hasOwnProperty.call(merged, key)) {
        merged[key] = value
      }
      continue
    }
    merged[key] = value
  }
  return merged
}
