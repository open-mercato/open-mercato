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
}

export type EnsureFieldDefinitionsResult = {
  created: number
  updated: number
  unchanged: number
}

const CONFIG_PASSTHROUGH_KEYS: Array<keyof CustomFieldDefinition> = [
  'label',
  'description',
  'options',
  'optionsUrl',
  'defaultValue',
  'required',
  'multi',
  'filterable',
  'formEditable',
  'listVisible',
  'indexed',
  'editor',
  'input',
  'relatedEntityId',
  'validation',
  'maxAttachmentSizeMb',
  'acceptExtensions',
]

function normalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => normalizeValue(item))
  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
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

  for (const set of sets) {
    for (const field of set.fields) {
      const where = {
        entityId: set.entity,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        key: field.key,
      }
      const existing = await em.findOne(CustomFieldDef, where)
      const configJson: Record<string, unknown> = {}

      for (const key of CONFIG_PASSTHROUGH_KEYS) {
        const value = field[key]
        if (value !== undefined) configJson[key] = value as unknown
      }

      if (!existing) {
        if (!scope.dryRun) {
          await em.persistAndFlush(
            em.create(CustomFieldDef, {
              entityId: set.entity,
              organizationId: scope.organizationId,
              tenantId: scope.tenantId,
              key: field.key,
              kind: field.kind,
              configJson,
              isActive: true,
            })
          )
        }
        created++
        continue
      }

      const kindChanged = existing.kind !== field.kind
      const configChanged = !configEquals(existing.configJson ?? null, configJson)
      const needsActivation = existing.isActive !== true || existing.deletedAt != null
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
        await em.flush()
      }
      updated++
    }
  }

  return { created, updated, unchanged }
}
