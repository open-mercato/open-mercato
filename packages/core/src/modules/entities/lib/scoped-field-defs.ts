import type { EntityManager } from '@mikro-orm/core'
import { CustomFieldDef } from '../data/entities'

export type ScopedCustomFieldDefsOptions = {
  entityId: string
  organizationId?: string | null
  tenantId?: string | null
}

// Definitions overlay by scope: an org+tenant row shadows a tenant-global row,
// which shadows an instance-global one. Duplicate keys within the same scope are
// resolved by recency so the newest definition wins.
const scopeScore = (def: CustomFieldDef) => (def.tenantId ? 2 : 0) + (def.organizationId ? 1 : 0)

const definitionTime = (def: CustomFieldDef) =>
  def.updatedAt instanceof Date ? def.updatedAt.getTime() : new Date(def.updatedAt).getTime()

export async function loadScopedCustomFieldDefs(
  em: EntityManager,
  opts: ScopedCustomFieldDefsOptions,
): Promise<Map<string, CustomFieldDef>> {
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

  const byKey = new Map<string, CustomFieldDef>()
  for (const def of defs) {
    const existing = byKey.get(def.key)
    if (!existing) {
      byKey.set(def.key, def)
      continue
    }
    const nextScore = scopeScore(def)
    const existingScore = scopeScore(existing)
    if (nextScore > existingScore) {
      byKey.set(def.key, def)
      continue
    }
    if (nextScore < existingScore) continue
    if (definitionTime(def) >= definitionTime(existing)) byKey.set(def.key, def)
  }
  return byKey
}

// Kind lookup used by read paths that must not reinterpret a stored value against
// the wrong type. Failures degrade to an empty map: callers then leave values as
// stored, which is always safer than coercing them blind.
export async function loadCustomFieldKinds(
  em: EntityManager,
  opts: ScopedCustomFieldDefsOptions,
): Promise<Map<string, string>> {
  try {
    const defs = await loadScopedCustomFieldDefs(em, opts)
    const kinds = new Map<string, string>()
    for (const [key, def] of defs) kinds.set(key, String(def.kind || ''))
    return kinds
  } catch {
    return new Map<string, string>()
  }
}
