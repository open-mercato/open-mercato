import type { EntityManager } from '@mikro-orm/core'
import type { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import { encryptCustomFieldValue, resolveTenantEncryptionService } from '@open-mercato/shared/lib/encryption/customFieldValues'
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
  // Optional: notify external systems (e.g., indexing) when values changed
  onChanged?: (payload: { entityId: string; recordId: string; organizationId: string | null; tenantId: string | null }) => Promise<void> | void
  // Optional: re-use an existing tenant encryption service instance
  encryptionService?: TenantDataEncryptionService | null
}

function columnFromKind(kind: string): keyof CustomFieldValue {
  switch (kind) {
    case 'text':
    case 'select':
    case 'currency':
    case 'dictionary':
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
  let encryptionService: TenantDataEncryptionService | null | undefined
  const encryptionCache = new Map<string | null, string | null>()
  const getEncryptionService = () => {
    if (encryptionService !== undefined) return encryptionService
    encryptionService = resolveTenantEncryptionService(em as any, opts.encryptionService)
    return encryptionService
  }
  const keys = Object.keys(values)
  for (const fieldKey of keys) {
    const raw = values[fieldKey]
    if (raw === undefined) continue

    const def = defsByKey?.[fieldKey]
    const encrypted = Boolean(def?.configJson && (def as any).configJson?.encrypted)
    const isArray = Array.isArray(raw)
    // When array: remove existing values for key and create multiple rows
    if (isArray) {
      const arr = raw as Primitive[]
      // Clear existing for this key
      const existing = await em.find(CustomFieldValue, { entityId, recordId, organizationId, tenantId, fieldKey })
      if (existing.length) existing.forEach((e) => em.remove(e))
      for (const val of arr) {
        const col: keyof CustomFieldValue = encrypted ? 'valueText' : def ? columnFromKind(def.kind) : columnFromJsValue(val)
        const cf = em.create(CustomFieldValue, { entityId, recordId, organizationId, tenantId, fieldKey, createdAt: new Date() })
        clearValueColumns(cf)
        const stored = encrypted
          ? await encryptCustomFieldValue(val, tenantId, getEncryptionService(), encryptionCache)
          : val
        switch (col) {
          case 'valueText': cf.valueText = stored == null ? null : String(stored); break
          case 'valueMultiline': cf.valueMultiline = stored == null ? null : String(stored); break
          case 'valueInt': cf.valueInt = stored == null ? null : Number(stored); break
          case 'valueFloat': cf.valueFloat = stored == null ? null : Number(stored); break
          case 'valueBool': cf.valueBool = stored == null ? null : Boolean(stored); break
          default: cf.valueText = stored == null ? null : String(stored); break
        }
        toPersist.push(cf)
      }
      continue
    }

    const column: keyof CustomFieldValue = encrypted ? 'valueText' : def ? columnFromKind(def.kind) : columnFromJsValue(raw as Primitive)
    const storedValue = encrypted
      ? await encryptCustomFieldValue(raw as Primitive, tenantId, getEncryptionService(), encryptionCache)
      : raw

    let cf = await em.findOne(CustomFieldValue, { entityId, recordId, organizationId, tenantId, fieldKey })
    if (!cf) {
      cf = em.create(CustomFieldValue, { entityId, recordId, organizationId, tenantId, fieldKey, createdAt: new Date() })
      toPersist.push(cf)
    }
    clearValueColumns(cf)
    switch (column) {
      case 'valueText':
        cf.valueText = (storedValue as Primitive) == null ? null : String(storedValue as Primitive)
        break
      case 'valueMultiline':
        cf.valueMultiline = (storedValue as Primitive) == null ? null : String(storedValue as Primitive)
        break
      case 'valueInt':
        cf.valueInt = (storedValue as Primitive) == null ? null : Number(storedValue as Primitive)
        break
      case 'valueFloat':
        cf.valueFloat = (storedValue as Primitive) == null ? null : Number(storedValue as Primitive)
        break
      case 'valueBool':
        cf.valueBool = (storedValue as Primitive) == null ? null : Boolean(storedValue as Primitive)
        break
      default:
        cf.valueText = (storedValue as Primitive) == null ? null : String(storedValue as Primitive)
        break
    }
  }

  if (toPersist.length) em.persist(toPersist)
  await em.flush()
  // Emit hook for indexing if requested (outside CRUD flows)
  try {
    if (typeof opts.onChanged === 'function') {
      await opts.onChanged({ entityId, recordId, organizationId, tenantId })
    }
  } catch {
    // Non-blocking
  }
}
