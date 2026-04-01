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
    isActive: true,
    deletedAt: null,
    $and: [
      {
        $or: organizationId === null
          ? [{ organizationId: null }]
          : [{ organizationId }, { organizationId: null }],
      },
      {
        $or: tenantId === null
          ? [{ tenantId: null }]
          : [{ tenantId }, { tenantId: null }],
      },
    ],
  } as any)

  // Prefer the most specific scope and newest definition for duplicate keys.
  const scopeScore = (def: CustomFieldDef) => (def.tenantId ? 2 : 0) + (def.organizationId ? 1 : 0)
  const byKey = new Map<string, CustomFieldDef>()
  for (const d of defs) {
    const existing = byKey.get(d.key)
    if (!existing) {
      byKey.set(d.key, d)
      continue
    }
    const nextScore = scopeScore(d)
    const existingScore = scopeScore(existing)
    if (nextScore > existingScore) {
      byKey.set(d.key, d)
      continue
    }
    if (nextScore < existingScore) continue

    const nextUpdatedAt = d.updatedAt instanceof Date ? d.updatedAt.getTime() : new Date(d.updatedAt).getTime()
    const existingUpdatedAt = existing.updatedAt instanceof Date
      ? existing.updatedAt.getTime()
      : new Date(existing.updatedAt).getTime()
    if (nextUpdatedAt >= existingUpdatedAt) {
      byKey.set(d.key, d)
    }
  }
  return validateValuesAgainstDefs(opts.values, Array.from(byKey.values()) as any)
}
