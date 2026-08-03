import type { EntityManager } from '@mikro-orm/postgresql'
import { CustomFieldDef } from '../data/entities'
import type { CustomFieldDefinition } from '@open-mercato/shared/modules/entities'

export type FieldSetInput = {
  entity: string
  fields: CustomFieldDefinition[]
  source?: string
}

export type EnsureFieldDefinitionsOptions = {
  organizationId: string | null
  tenantId: string | null
  dryRun?: boolean
  createOnly?: boolean
}

export type EnsureFieldDefinitionsResult = {
  created: number
  updated: number
  unchanged: number
}

const CONFIG_PASSTHROUGH_KEYS: Array<keyof CustomFieldDefinition> = [
  'label',
  'description',
  'fieldset',
  'fieldsets',
  'group',
  'options',
  'optionsUrl',
  'defaultValue',
  'required',
  'multi',
  'filterable',
  'formEditable',
  'listVisible',
  'indexed',
  'priority',
  'editor',
  'input',
  'relatedEntityId',
  'dictionaryId',
  'dictionaryInlineCreate',
  'validation',
  'maxAttachmentSizeMb',
  'acceptExtensions',
  'sourceMetadata',
]

function normalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => normalizeValue(item))
  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort((a, b) => a.localeCompare(b))
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = normalizeValue((value as Record<string, unknown>)[key])
        return acc
      }, {})
  }
  return value
}

function configEquals(a: unknown, b: unknown): boolean {
  return JSON.stringify(normalizeValue(a ?? null)) === JSON.stringify(normalizeValue(b ?? null))
}

export async function ensureCustomFieldDefinitions(
  em: EntityManager,
  sets: FieldSetInput[],
  scope: EnsureFieldDefinitionsOptions
): Promise<EnsureFieldDefinitionsResult> {
  let created = 0
  let updated = 0
  let unchanged = 0

  // Prefetch every existing definition the batch could touch in a single query,
  // then index by composite key so the nested loop never issues per-field lookups.
  const entityIds = Array.from(new Set(sets.map((set) => set.entity)))
  const fieldKeys = Array.from(new Set(sets.flatMap((set) => set.fields.map((field) => field.key))))
  const existingByKey = new Map<string, CustomFieldDef>()
  if (entityIds.length > 0 && fieldKeys.length > 0) {
    const existingDefs = await em.find(CustomFieldDef, {
      entityId: { $in: entityIds },
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      key: { $in: fieldKeys },
    })
    for (const def of existingDefs) {
      existingByKey.set(`${def.entityId}|${def.key}`, def)
    }
  }

  let dirty = false

  for (const set of sets) {
    for (const field of set.fields) {
      const existing = existingByKey.get(`${set.entity}|${field.key}`) ?? null
      const configJson: Record<string, unknown> = {}

      for (const key of CONFIG_PASSTHROUGH_KEYS) {
        const value = field[key]
        if (value !== undefined) configJson[key] = value as unknown
      }

      if (!existing) {
        if (!scope.dryRun) {
          const createdDef = em.create(CustomFieldDef, {
            entityId: set.entity,
            organizationId: scope.organizationId,
            tenantId: scope.tenantId,
            key: field.key,
            kind: field.kind,
            configJson,
            isActive: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          em.persist(createdDef)
          // Track so duplicate (entity, key) pairs within the batch update in memory instead of double-inserting.
          existingByKey.set(`${set.entity}|${field.key}`, createdDef)
          dirty = true
        }
        created++
        continue
      }

      const kindChanged = existing.kind !== field.kind
      const configChanged = !configEquals(existing.configJson ?? null, configJson)
      const needsActivation = existing.isActive !== true || existing.deletedAt != null
      if (scope.createOnly) {
        unchanged++
        continue
      }
      if (!kindChanged && !configChanged && !needsActivation) {
        unchanged++
        continue
      }

      if (!scope.dryRun) {
        existing.kind = field.kind
        ;(existing as any).configJson = configJson
        existing.isActive = true
        existing.updatedAt = new Date()
        if (existing.deletedAt) existing.deletedAt = null
        em.persist(existing)
        dirty = true
      }
      updated++
    }
  }

  if (dirty) {
    // Single flush for the whole batch instead of one round trip per field.
    await em.flush()
  }

  return { created, updated, unchanged }
}
