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

export async function ensureCustomFieldDefinitions(
  em: EntityManager,
  sets: FieldSetInput[],
  scope: EnsureFieldDefinitionsOptions
): Promise<{ created: number; updated: number }> {
  let created = 0
  let updated = 0

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

      const patch: any = {}
      if (existing.kind !== field.kind) patch.kind = field.kind
      patch.configJson = configJson
      patch.isActive = true
      if (!scope.dryRun) {
        em.assign(existing, patch)
        await em.flush()
      }
      updated++
    }
  }

  return { created, updated }
}
