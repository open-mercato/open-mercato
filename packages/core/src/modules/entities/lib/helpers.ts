import type { EntityManager } from '@mikro-orm/core'
import type { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import { encryptCustomFieldValue, resolveTenantEncryptionService } from '@open-mercato/shared/lib/encryption/customFieldValues'
import {
  MAX_CUSTOM_FIELD_KEYS_PER_RECORD,
  TOO_MANY_CUSTOM_FIELDS_ERROR,
} from '@open-mercato/shared/modules/entities/validation'
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
    case 'phone':
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
      isActive: true,
      deletedAt: null,
      organizationId: { $in: [organizationId, null] as any },
      tenantId: { $in: [tenantId, null] as any },
    })
    const scopeScore = (def: CustomFieldDef) => (def.tenantId ? 2 : 0) + (def.organizationId ? 1 : 0)
    defsByKey = {}
    for (const d of defs) {
      const existing = defsByKey[d.key]
      if (!existing) {
        defsByKey[d.key] = d
        continue
      }
      const nextScore = scopeScore(d)
      const existingScore = scopeScore(existing)
      if (nextScore > existingScore) {
        defsByKey[d.key] = d
        continue
      }
      if (nextScore < existingScore) continue

      const nextUpdatedAt = d.updatedAt instanceof Date ? d.updatedAt.getTime() : new Date(d.updatedAt).getTime()
      const existingUpdatedAt = existing.updatedAt instanceof Date
        ? existing.updatedAt.getTime()
        : new Date(existing.updatedAt).getTime()
      if (nextUpdatedAt >= existingUpdatedAt) {
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
  const presentKeyCount = keys.filter((key) => values[key] !== undefined).length
  if (preferDefs && presentKeyCount > MAX_CUSTOM_FIELD_KEYS_PER_RECORD) {
    throw new Error(TOO_MANY_CUSTOM_FIELDS_ERROR)
  }

  // Run the per-key delete+insert work inside ONE database transaction so a
  // multi-value replacement is atomic and isolated. The array branch deletes the
  // existing rows for a key and inserts the replacements; without an enclosing
  // transaction those can land in separate commit boundaries under MikroORM's
  // FlushMode.AUTO (a query elsewhere in the unit auto-flushes part of the work),
  // which intermittently left the field with the delete applied but the inserts
  // missing — the multi-select EDIT reverted to []. The single commit below makes
  // it all-or-nothing. We only open our own transaction when the caller has not
  // already started one (commands fork the request em and may run setCustomFields
  // outside their own withAtomicFlush tx); join an ambient transaction otherwise.
  const txEm = em as {
    begin?: () => Promise<void>
    commit?: () => Promise<void>
    rollback?: () => Promise<void>
    isInTransaction?: () => boolean
  }
  const txCapable =
    typeof txEm.begin === 'function' &&
    typeof txEm.commit === 'function' &&
    typeof txEm.rollback === 'function' &&
    typeof txEm.isInTransaction === 'function'
  const ownCustomFieldTransaction = txCapable && !txEm.isInTransaction!()
  if (ownCustomFieldTransaction) await txEm.begin!()
  try {
  for (const fieldKey of keys) {
    const raw = values[fieldKey]
    if (raw === undefined) continue

    const def = defsByKey?.[fieldKey]
    const encrypted = Boolean(def?.configJson && (def as any).configJson?.encrypted)
    const isArray = Array.isArray(raw)
    // When array (multi-value): replace all existing rows for the key. Delete
    // first, then create replacements, all inside the transaction opened above.
    // Creating rows before a native delete can auto-flush and delete the new
    // values; mixing em.remove(stale) with new rows for the same EAV scope was
    // observed to commit an empty set under MikroORM v7. The explicit order keeps
    // the replacement atomic without letting old-row cleanup target new rows.
    if (isArray) {
      const arr = raw as Primitive[]
      await em.nativeDelete(CustomFieldValue, { entityId, recordId, organizationId, tenantId, fieldKey })
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
    if (ownCustomFieldTransaction) await txEm.commit!()
  } catch (err) {
    if (ownCustomFieldTransaction) {
      try { await txEm.rollback!() } catch { /* surface the original error, not a rollback failure */ }
    }
    throw err
  }
  // Emit hook for indexing if requested (outside CRUD flows). Runs AFTER the
  // transaction commits so consumers observe the persisted rows.
  try {
    if (typeof opts.onChanged === 'function') {
      await opts.onChanged({ entityId, recordId, organizationId, tenantId })
    }
  } catch {
    // Non-blocking
  }
}
