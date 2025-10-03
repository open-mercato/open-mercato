import type { EntityManager } from '@mikro-orm/core'
import { CustomFieldDef } from '../data/entities'
import { validateValuesAgainstDefs } from '@open-mercato/shared/modules/entities/validation'

export async function validateCustomFieldValuesServer(
  em: EntityManager,
  opts: { entityId: string; organizationId?: string | null; tenantId?: string | null; values: Record<string, any> },
): Promise<{ ok: boolean; fieldErrors: Record<string, string> }> {
  const organizationId = opts.organizationId ?? null
  const tenantId = opts.tenantId ?? null
  const defs = await em.find(CustomFieldDef, {
    entityId: opts.entityId,
    organizationId: { $in: [organizationId, null] as any },
    tenantId: { $in: [tenantId, null] as any },
    isActive: true,
  })
  // Prefer org/tenant scoped over global when duplicates
  const seen = new Set<string>()
  const ranked: typeof defs = [] as any
  for (const d of defs) {
    if (seen.has(d.key)) continue
    seen.add(d.key)
    ranked.push(d)
  }
  return validateValuesAgainstDefs(opts.values, ranked as any)
}

