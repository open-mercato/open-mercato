import type { EntityManager } from '@mikro-orm/core'
import { CustomFieldDef, CustomFieldValue } from '../data/entities'

type Primitive = string | number | boolean | null | undefined

export type SetRecordCustomFieldsOptions = {
  entityId: string
  recordId: string
  organizationId?: string | null
  tenantId?: string | null
  values: Record<string, Primitive>
  // When true (default), try to use field definitions to decide storage column
  preferDefs?: boolean
}

function columnFromKind(kind: string): keyof CustomFieldValue {
  switch (kind) {
    case 'text':
    case 'select':
      return 'valueText'
    case 'multiline':
      return 'valueMultiline'
    case 'integer':
      return 'valueInt'
    case 'float':
      return 'valueFloat'
    case 'boolean':
      return 'valueBool'
    default:
      return 'valueText'
  }
}

function columnFromJsValue(v: Primitive): keyof CustomFieldValue {
  if (v === null || v === undefined) return 'valueText'
  if (typeof v === 'boolean') return 'valueBool'
  if (typeof v === 'number') return Number.isInteger(v) ? 'valueInt' : 'valueFloat'
  return 'valueText'
}

// Clears all value columns to avoid leftovers on update
function clearValueColumns(cf: CustomFieldValue) {
  cf.valueText = null
  cf.valueMultiline = null
  cf.valueInt = null
  cf.valueFloat = null
  cf.valueBool = null
}

export async function setRecordCustomFields(
  em: EntityManager,
  opts: SetRecordCustomFieldsOptions,
): Promise<void> {
  const { entityId, recordId, values } = opts
  const organizationId = opts.organizationId ?? null
  const tenantId = opts.tenantId ?? null
  const preferDefs = opts.preferDefs !== false

  let defsByKey: Record<string, CustomFieldDef> | undefined
  if (preferDefs) {
    const defs = await em.find(CustomFieldDef, {
      entityId,
      organizationId: { $in: [organizationId, null] as any },
      tenantId: { $in: [tenantId, null] as any },
    })
    // Prefer org+tenant-specific over global if duplicates
    defsByKey = {}
    for (const d of defs) {
      const existing = defsByKey[d.key]
      if (!existing || 
          (existing.organizationId == null && d.organizationId != null) ||
          (existing.tenantId == null && d.tenantId != null)) {
        defsByKey[d.key] = d
      }
    }
  }

  const toPersist: CustomFieldValue[] = []
  const keys = Object.keys(values)
  for (const fieldKey of keys) {
    const raw = values[fieldKey]
    if (raw === undefined) continue

    const def = defsByKey?.[fieldKey]
    const column: keyof CustomFieldValue = def ? columnFromKind(def.kind) : columnFromJsValue(raw)

    let cf = await em.findOne(CustomFieldValue, { entityId, recordId, organizationId, fieldKey })
    if (!cf) {
      cf = em.create(CustomFieldValue, { entityId, recordId, organizationId, fieldKey, createdAt: new Date() })
      toPersist.push(cf)
    }
    clearValueColumns(cf)
    switch (column) {
      case 'valueText':
        cf.valueText = raw == null ? null : String(raw)
        break
      case 'valueMultiline':
        cf.valueMultiline = raw == null ? null : String(raw)
        break
      case 'valueInt':
        cf.valueInt = raw == null ? null : Number(raw)
        break
      case 'valueFloat':
        cf.valueFloat = raw == null ? null : Number(raw)
        break
      case 'valueBool':
        cf.valueBool = raw == null ? null : Boolean(raw)
        break
      default:
        cf.valueText = raw == null ? null : String(raw)
        break
    }
  }

  if (toPersist.length) em.persist(toPersist)
  await em.flush()
}
