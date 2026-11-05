import type { EntityManager } from '@mikro-orm/core'
import { sanitizeRichTextHtml } from '@open-mercato/shared/lib/html/sanitizeRichText'
import { CustomEntity, CustomFieldDef } from '../data/entities'

export { sanitizeRichTextHtml as sanitizeHtmlRichTextServer } from '@open-mercato/shared/lib/html/sanitizeRichText'

function normalizeFieldKey(key: string): string {
  if (key.startsWith('cf_') || key.startsWith('cf:')) return key.slice(3)
  return key
}

function scopeScore(def: { tenantId?: string | null; organizationId?: string | null }): number {
  return (def.tenantId ? 2 : 0) + (def.organizationId ? 1 : 0)
}

function chooseDefinition(existing: CustomFieldDef | undefined, candidate: CustomFieldDef): CustomFieldDef {
  if (!existing) return candidate
  const nextScore = scopeScore(candidate)
  const existingScore = scopeScore(existing)
  if (nextScore > existingScore) return candidate
  if (nextScore < existingScore) return existing

  const nextUpdatedAt = candidate.updatedAt instanceof Date ? candidate.updatedAt.getTime() : new Date(candidate.updatedAt).getTime()
  const existingUpdatedAt = existing.updatedAt instanceof Date ? existing.updatedAt.getTime() : new Date(existing.updatedAt).getTime()
  return nextUpdatedAt >= existingUpdatedAt ? candidate : existing
}

async function resolveDefaultEditor(
  em: EntityManager,
  entityId: string,
  organizationId: string | null,
  tenantId: string | null,
): Promise<string | null> {
  const entities = await em.find(CustomEntity, {
    entityId,
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
  } as never)

  let selected: CustomEntity | undefined
  for (const entity of entities) {
    if (!selected) {
      selected = entity
      continue
    }
    const nextScore = scopeScore(entity)
    const existingScore = scopeScore(selected)
    if (nextScore > existingScore) {
      selected = entity
      continue
    }
    if (nextScore < existingScore) continue

    const nextUpdatedAt = entity.updatedAt instanceof Date ? entity.updatedAt.getTime() : new Date(entity.updatedAt).getTime()
    const existingUpdatedAt = selected.updatedAt instanceof Date ? selected.updatedAt.getTime() : new Date(selected.updatedAt).getTime()
    if (nextUpdatedAt >= existingUpdatedAt) selected = entity
  }

  return selected?.defaultEditor ?? null
}

export async function sanitizeCustomFieldHtmlRichTextValuesServer<TValues extends Record<string, unknown>>(
  em: EntityManager,
  opts: {
    entityId: string
    organizationId?: string | null
    tenantId?: string | null
    values: TValues
  },
): Promise<TValues> {
  const organizationId = opts.organizationId ?? null
  const tenantId = opts.tenantId ?? null
  const keys = Object.keys(opts.values)
  if (!opts.entityId || keys.length === 0) return opts.values

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
  } as never)
  const defaultEditor = await resolveDefaultEditor(em, opts.entityId, organizationId, tenantId)
  const defsByKey = new Map<string, CustomFieldDef>()
  for (const def of defs) {
    defsByKey.set(def.key, chooseDefinition(defsByKey.get(def.key), def))
  }

  const result: Record<string, unknown> = { ...opts.values }
  for (const key of keys) {
    const def = defsByKey.get(normalizeFieldKey(key))
    const editor = typeof def?.configJson?.editor === 'string'
      ? def.configJson.editor
      : (def?.kind === 'multiline' ? defaultEditor : null)
    if (editor !== 'htmlRichText') continue

    const value = opts.values[key]
    if (typeof value === 'string') {
      result[key] = sanitizeRichTextHtml(value)
      continue
    }
    if (Array.isArray(value)) {
      result[key] = value.map((entry) => typeof entry === 'string' ? sanitizeRichTextHtml(entry) : entry)
    }
  }

  return result as TValues
}
