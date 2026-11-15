import type { EntityManager } from '@mikro-orm/postgresql'
import type { FilterQuery } from '@mikro-orm/core'
import {
  decryptWithAesGcm,
  TenantDataEncryptionError,
  TenantDataEncryptionErrorCode,
} from '@open-mercato/shared/lib/encryption/aes'
import {
  decryptCustomEntityDocument,
  encryptCustomEntityDocument,
  isCustomEntityDocumentCiphertext,
  type CustomEntityDocumentField,
} from '@open-mercato/shared/lib/encryption/customEntityDoc'
import type { KmsService, TenantDek } from '@open-mercato/shared/lib/encryption/kms'
import type { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import { CustomFieldDef } from '../data/entities'
import { loadScopedCustomFieldDefs } from './scoped-field-defs'

type RotationOptions = {
  encryptionService: TenantDataEncryptionService
  oldKms: KmsService | null
  tenantId: string | null
  organizationId: string | null
  dryRun: boolean
}

type DocumentRow = {
  id: string
  entity_type: string
  tenant_id: string | null
  organization_id: string | null
  doc: Record<string, unknown>
}

type DocumentFieldPolicy = {
  fields: CustomEntityDocumentField[]
  encryptedKeys: Set<string>
  protectedKeys: Set<string>
}

const BATCH_SIZE = 100

function holdsCiphertext(value: unknown): boolean {
  return Array.isArray(value) ? value.some(isCustomEntityDocumentCiphertext) : isCustomEntityDocumentCiphertext(value)
}

function selectHistoricalDefinitions(definitions: CustomFieldDef[]): Map<string, CustomFieldDef> {
  const selected = new Map<string, CustomFieldDef>()
  const scopeScore = (definition: CustomFieldDef) => (definition.tenantId ? 2 : 0) + (definition.organizationId ? 1 : 0)
  const updatedAt = (definition: CustomFieldDef) => new Date(definition.updatedAt).getTime()
  for (const definition of definitions) {
    const previous = selected.get(definition.key)
    if (!previous || scopeScore(definition) > scopeScore(previous)
      || (scopeScore(definition) === scopeScore(previous) && updatedAt(definition) >= updatedAt(previous))) {
      selected.set(definition.key, definition)
    }
  }
  return selected
}

/** @internal */
export async function rotateCustomEntityDocuments(
  em: EntityManager,
  options: RotationOptions,
): Promise<number> {
  const definitionScope: FilterQuery<CustomFieldDef>[] = []
  if (options.tenantId) definitionScope.push({ $or: [{ tenantId: options.tenantId }, { tenantId: null }] })
  if (options.organizationId) definitionScope.push({ $or: [{ organizationId: options.organizationId }, { organizationId: null }] })
  const definitions = await em.find(CustomFieldDef, {
    ...(definitionScope.length ? { $and: definitionScope } : {}),
  })
  const entityIds = Array.from(new Set(definitions.map((definition) => definition.entityId)))
  if (!entityIds.length) return 0

  const connection = em.getConnection()
  const fieldsByScope = new Map<string, DocumentFieldPolicy>()
  const oldDeks = new Map<string, TenantDek | null>()
  let cursor: string | null = null
  let updated = 0
  for (;;) {
    const predicates = [`entity_type in (${entityIds.map(() => '?').join(', ')})`]
    const parameters: unknown[] = [...entityIds]
    if (options.tenantId) {
      predicates.push('tenant_id = ?')
      parameters.push(options.tenantId)
    }
    if (options.organizationId) {
      predicates.push('organization_id = ?')
      parameters.push(options.organizationId)
    }
    if (cursor) {
      predicates.push('id > ?')
      parameters.push(cursor)
    }
    const rows = await connection.execute<DocumentRow[]>(
      `select id, entity_type, tenant_id, organization_id, doc from custom_entities_storage where ${predicates.join(' and ')} order by id asc limit ${BATCH_SIZE}`,
      parameters,
    )
    if (!rows.length) break
    for (const row of rows) {
      const scopeKey = JSON.stringify([row.entity_type, row.tenant_id, row.organization_id])
      let policy = fieldsByScope.get(scopeKey)
      if (!policy) {
        const scopedDefinitions = await loadScopedCustomFieldDefs(em, {
          entityId: row.entity_type,
          tenantId: row.tenant_id,
          organizationId: row.organization_id,
        })
        const visibleDefinitions = definitions
          .filter((definition) => definition.entityId === row.entity_type
            && (definition.tenantId == null || definition.tenantId === row.tenant_id)
            && (definition.organizationId == null || definition.organizationId === row.organization_id))
        const keys = new Set(visibleDefinitions.map((definition) => definition.key))
        const historicalDefinitions = selectHistoricalDefinitions(visibleDefinitions)
        policy = {
          fields: Array.from(keys, (key) => ({ key, kind: 'text', encrypted: true })),
          protectedKeys: new Set(Array.from(keys)
            .filter((key) => (scopedDefinitions.get(key) ?? historicalDefinitions.get(key))?.configJson?.encrypted === true)),
          encryptedKeys: new Set(Array.from(scopedDefinitions.values())
            .filter((definition) => definition.configJson?.encrypted === true)
            .map((definition) => definition.key)),
        }
        fieldsByScope.set(scopeKey, policy)
      }
      const { fields, encryptedKeys, protectedKeys } = policy
      const knownKeys = new Set(fields.map((field) => field.key))
      const entries = Object.entries(row.doc).filter(([key, value]) => {
        const normalizedKey = key.replace(/^cf[:_]/, '')
        return value != null && knownKeys.has(normalizedKey) && (encryptedKeys.has(normalizedKey) || holdsCiphertext(value))
      })
      if (!entries.length) continue
      const tenantId = row.tenant_id
      if (!tenantId || !options.encryptionService.isEnabled()) {
        throw new TenantDataEncryptionError(TenantDataEncryptionErrorCode.KMS_UNAVAILABLE, '[internal] Custom entity encryption requires an available tenant key')
      }
      const currentDek = await options.encryptionService.getDek(tenantId)
      if (options.oldKms && !oldDeks.has(tenantId)) oldDeks.set(tenantId, await options.oldKms.getTenantDek(tenantId))
      const oldDek = oldDeks.get(tenantId) ?? null
      const candidates: Record<string, unknown> = {}
      const arrayMasks = new Map<string, boolean[]>()
      let changed = false
      const prepare = (value: unknown, encryptPlaintext: boolean, requireCiphertextKey: boolean): { value: unknown; selected: boolean } => {
        if (value == null) return { value, selected: false }
        if (typeof value === 'string') {
          if (currentDek && decryptWithAesGcm(value, currentDek.key) !== null) return { value, selected: true }
          if (oldDek && decryptWithAesGcm(value, oldDek.key) !== null) {
            changed = true
            return { value, selected: true }
          }
        }
        if (!isCustomEntityDocumentCiphertext(value)) {
          if (options.oldKms || !encryptPlaintext) return { value: null, selected: false }
          changed = true
          return { value, selected: true }
        }
        if (!requireCiphertextKey) return { value: null, selected: false }
        throw new TenantDataEncryptionError(TenantDataEncryptionErrorCode.WRONG_KEY, '[internal] Custom entity ciphertext does not decrypt under the supplied tenant keys')
      }
      for (const [key, value] of entries) {
        const normalizedKey = key.replace(/^cf[:_]/, '')
        const encryptPlaintext = encryptedKeys.has(normalizedKey)
        const requireCiphertextKey = protectedKeys.has(normalizedKey)
        if (Array.isArray(value)) {
          const prepared = value.map((entry) => prepare(entry, encryptPlaintext, requireCiphertextKey))
          candidates[key] = prepared.map((entry) => entry.value)
          arrayMasks.set(key, prepared.map((entry) => entry.selected))
        } else {
          const prepared = prepare(value, encryptPlaintext, requireCiphertextKey)
          if (prepared.selected) candidates[key] = prepared.value
        }
      }
      if (!changed) continue
      if (options.dryRun) {
        updated += 1
        continue
      }
      const plaintext = options.oldKms && oldDek
        ? await decryptCustomEntityDocument(candidates, fields, tenantId, options.encryptionService, new Map([[tenantId, oldDek.key]]))
        : candidates
      const encrypted = await encryptCustomEntityDocument(plaintext, fields, tenantId, options.encryptionService)
      const nextDoc = { ...row.doc }
      for (const [key, value] of Object.entries(encrypted)) {
        const mask = arrayMasks.get(key)
        const previous = row.doc[key]
        nextDoc[key] = mask && Array.isArray(value) && Array.isArray(previous)
          ? value.map((entry, index) => mask[index] ? entry : previous[index])
          : value
      }
      const written = await connection.execute<Array<{ id: string }>>(
        'update custom_entities_storage set doc = ?::jsonb, updated_at = now() where id = ? and entity_type = ? and tenant_id is not distinct from ? and organization_id is not distinct from ? and doc = ?::jsonb returning id',
        [JSON.stringify(nextDoc), row.id, row.entity_type, tenantId, row.organization_id, JSON.stringify(row.doc)],
      )
      if (!written.length) throw new Error('[internal] Custom entity document changed during encryption; retry the operation')
      updated += 1
    }
    cursor = rows[rows.length - 1]!.id
    if (rows.length < BATCH_SIZE) break
  }
  return updated
}
