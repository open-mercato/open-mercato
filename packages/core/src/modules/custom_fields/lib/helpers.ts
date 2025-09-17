import type { EntityManager } from '@mikro-orm/core'
import { CustomFieldDef, CustomFieldValue } from '../data/entities'

type Primitive = string | number | boolean | null | undefined
type PrimitiveOrArray = Primitive | Primitive[]

export type SetRecordCustomFieldsOptions = {
  entityId: string
  recordId: string
  organizationId?: string | null
  tenantId?: string | null
  values: Record<string, PrimitiveOrArray>
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
    const isArray = Array.isArray(raw)
    // When array: remove existing values for key and create multiple rows
    if (isArray) {
      const arr = raw as Primitive[]
      // Clear existing for this key
      const existing = await em.find(CustomFieldValue, { entityId, recordId, organizationId, tenantId, fieldKey })
      if (existing.length) existing.forEach((e) => em.remove(e))
      for (const val of arr) {
        const col: keyof CustomFieldValue = def ? columnFromKind(def.kind) : columnFromJsValue(val)
        const cf = em.create(CustomFieldValue, { entityId, recordId, organizationId, tenantId, fieldKey, createdAt: new Date() })
        clearValueColumns(cf)
        switch (col) {
          case 'valueText': cf.valueText = val == null ? null : String(val); break
          case 'valueMultiline': cf.valueMultiline = val == null ? null : String(val); break
          case 'valueInt': cf.valueInt = val == null ? null : Number(val); break
          case 'valueFloat': cf.valueFloat = val == null ? null : Number(val); break
          case 'valueBool': cf.valueBool = val == null ? null : Boolean(val); break
          default: cf.valueText = val == null ? null : String(val); break
        }
        toPersist.push(cf)
      }
      continue
    }

    const column: keyof CustomFieldValue = def ? columnFromKind(def.kind) : columnFromJsValue(raw as Primitive)

    let cf = await em.findOne(CustomFieldValue, { entityId, recordId, organizationId, tenantId, fieldKey })
    if (!cf) {
      cf = em.create(CustomFieldValue, { entityId, recordId, organizationId, tenantId, fieldKey, createdAt: new Date() })
      toPersist.push(cf)
    }
    clearValueColumns(cf)
    switch (column) {
      case 'valueText':
        cf.valueText = (raw as Primitive) == null ? null : String(raw as Primitive)
        break
      case 'valueMultiline':
        cf.valueMultiline = (raw as Primitive) == null ? null : String(raw as Primitive)
        break
      case 'valueInt':
        cf.valueInt = (raw as Primitive) == null ? null : Number(raw as Primitive)
        break
      case 'valueFloat':
        cf.valueFloat = (raw as Primitive) == null ? null : Number(raw as Primitive)
        break
      case 'valueBool':
        cf.valueBool = (raw as Primitive) == null ? null : Boolean(raw as Primitive)
        break
      default:
        cf.valueText = (raw as Primitive) == null ? null : String(raw as Primitive)
        break
    }
  }

  if (toPersist.length) em.persist(toPersist)
  await em.flush()
}
