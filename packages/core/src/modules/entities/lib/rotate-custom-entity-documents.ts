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
import type { RotationTimestampIntent, RotationKeyProviders } from '@open-mercato/shared/lib/encryption/rotationProtection'
import { MAINTENANCE_ROW_BYTES } from './rotation-maintenance'

type RotationOptions = {
  encryptionService: TenantDataEncryptionService
  oldKms: KmsService | null
  tenantId: string | null
  organizationId: string | null
  dryRun: boolean
  signal?: AbortSignal
  batchSize?: number
  resumeCursor?: RotationKeyProviders['resumeCursor']
  checkpointBatch?: RotationKeyProviders['checkpointBatch']
  timestampForBatchWrite?: (intents: RotationTimestampIntent[]) => Promise<Date[]>
  timestampForWrite?: (intent: RotationTimestampIntent) => Promise<Date>
}

type DocumentRow = {
  id: string
  entity_type: string
  tenant_id: string | null
  organization_id: string | null
  doc: Record<string, unknown>
  updated_at?: string | Date | null
}

type DocumentFieldPolicy = {
  fields: CustomEntityDocumentField[]
  encryptedKeys: Set<string>
  protectedKeys: Set<string>
}

const BATCH_SIZE = 8
const MAX_DEFINITIONS = 500
const MAX_SCOPE_CACHE = 32

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
  const batchSize = options.batchSize ?? BATCH_SIZE
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) throw new Error('[internal] Invalid maintenance batch size')
  const definitionScope: FilterQuery<CustomFieldDef>[] = []
  if (options.tenantId) definitionScope.push({ $or: [{ tenantId: options.tenantId }, { tenantId: null }] })
  if (options.organizationId) definitionScope.push({ $or: [{ organizationId: options.organizationId }, { organizationId: null }] })
  const availableDefinitions = await em.find(CustomFieldDef, {
    ...(definitionScope.length ? { $and: definitionScope } : {}),
  }, { limit: MAX_DEFINITIONS + 1, orderBy: { id: 'asc' }, refresh: true, ...(options.signal ? { signal: options.signal, inflightQueryAbortStrategy: 'cancel query' as const } : {}) })
  if (availableDefinitions.length > MAX_DEFINITIONS) throw new Error('[internal] Custom definition inventory exceeds supported maintenance bound')
  if (!availableDefinitions.length) return 0
  const connection = {
    execute: async <T = unknown[]>(sql: string, parameters: unknown[]): Promise<T> => options.signal
      ? await em.execute(sql, parameters, { signal: options.signal, inflightQueryAbortStrategy: 'cancel query' }) as T
      : await em.getConnection().execute(sql, parameters) as T,
  }
  const fieldsByScope = new Map<string, DocumentFieldPolicy>()
  const oldDeks = new Map<string, TenantDek | null>()
  const operationId = JSON.stringify(['custom-documents-v1', options.tenantId, options.organizationId])
  const resumedCursor = !options.dryRun && options.resumeCursor ? await options.resumeCursor(operationId) : null
  if (resumedCursor && (resumedCursor.length !== 1 || typeof resumedCursor[0] !== 'string' || Buffer.byteLength(resumedCursor[0]) > 8192)) throw new Error('[internal] Invalid custom maintenance resume cursor')
  let cursor: string | null = resumedCursor?.[0] ?? null
  let updated = 0
  for (;;) {
    options.signal?.throwIfAborted()
    const predicates = ['EXISTS (SELECT 1 FROM custom_field_defs d WHERE d.entity_id = custom_entities_storage.entity_type AND (d.tenant_id IS NULL OR d.tenant_id = custom_entities_storage.tenant_id) AND (d.organization_id IS NULL OR d.organization_id = custom_entities_storage.organization_id))']
    const parameters: unknown[] = []
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
    const oversized = await connection.execute<Array<{ oversized: number }>>(
      `select 1 as oversized from (select doc from custom_entities_storage where ${predicates.join(' and ')} order by id asc limit ${batchSize}) candidates where octet_length(convert_to(doc::text, 'UTF8')) > ? limit 1`,
      [...parameters, MAINTENANCE_ROW_BYTES],
    )
    if (oversized.length) throw new Error('[internal] Custom document exceeds supported maintenance size')
    const rows = await connection.execute<DocumentRow[]>(
      `select id, entity_type, tenant_id, organization_id, doc, updated_at::text as updated_at from custom_entities_storage where ${predicates.join(' and ')} order by id asc limit ${batchSize}`,
      parameters,
    )
    if (!rows.length) break
    const committedChecks: unknown[][] = []
    const previouslyUpdated = updated
    const preparedWrites: Array<{ row: DocumentRow; nextDoc: Record<string, unknown>; tenantId: string }> = []
    for (const row of rows) {
      options.signal?.throwIfAborted()
      const scopeKey = JSON.stringify([row.entity_type, row.tenant_id, row.organization_id])
      let policy = fieldsByScope.get(scopeKey)
      if (!policy) {
        const definitionScope: FilterQuery<CustomFieldDef>[] = [
          { $or: [{ tenantId: row.tenant_id }, { tenantId: null }] },
          { $or: [{ organizationId: row.organization_id }, { organizationId: null }] },
        ]
        const visibleDefinitions = await em.find(CustomFieldDef, {
          entityId: row.entity_type,
          $and: definitionScope,
        }, { limit: MAX_DEFINITIONS + 1, orderBy: { id: 'asc' }, refresh: true, ...(options.signal ? { signal: options.signal, inflightQueryAbortStrategy: 'cancel query' as const } : {}) })
        if (visibleDefinitions.length > MAX_DEFINITIONS) throw new Error('[internal] Custom definition scope exceeds supported maintenance bound')
        const scopedDefinitions = selectHistoricalDefinitions(visibleDefinitions.filter((definition) => definition.isActive && !definition.deletedAt))
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
        if (fieldsByScope.size >= MAX_SCOPE_CACHE) fieldsByScope.delete(fieldsByScope.keys().next().value!)
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
      if (options.oldKms && !oldDeks.has(tenantId)) {
        if (oldDeks.size >= MAX_SCOPE_CACHE) oldDeks.delete(oldDeks.keys().next().value!)
        oldDeks.set(tenantId, await options.oldKms.getTenantDek(tenantId))
      }
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
      preparedWrites.push({ row, nextDoc, tenantId })
    }
    const timestamps = preparedWrites.length && options.timestampForBatchWrite ? await options.timestampForBatchWrite(preparedWrites.map(({row,tenantId}) => ({
      table: 'custom_entities_storage', identity: row.id, tenantId, organizationId: row.organization_id, previousTimestamp: row.updated_at ?? null,
    }))) : undefined
    if (timestamps && (timestamps.length !== preparedWrites.length || timestamps.some((value) => !(value instanceof Date) || !Number.isFinite(value.getTime())))) throw new Error('[internal] Invalid maintenance timestamp batch intent')
    for (const [rowIndex, {row,nextDoc,tenantId}] of preparedWrites.entries()) {
      options.signal?.throwIfAborted()
      const intendedTimestamp = timestamps?.[rowIndex] ?? (options.timestampForWrite ? await options.timestampForWrite({
        table: 'custom_entities_storage', identity: row.id, tenantId, organizationId: row.organization_id,
        previousTimestamp: row.updated_at ?? null,
      }) : null)
      if (intendedTimestamp && !Number.isFinite(intendedTimestamp.getTime())) throw new Error('[internal] Invalid maintenance timestamp intent')
      const written = await connection.execute<Array<{ id: string }>>(
        `update custom_entities_storage set doc = ?::jsonb, updated_at = ${intendedTimestamp ? '?' : 'now()'} where id = ? and entity_type = ? and tenant_id is not distinct from ? and organization_id is not distinct from ? and doc = ?::jsonb${intendedTimestamp ? ' and updated_at is not distinct from ?' : ''} returning id`,
        [JSON.stringify(nextDoc), ...(intendedTimestamp ? [intendedTimestamp] : []), row.id, row.entity_type, tenantId, row.organization_id, JSON.stringify(row.doc), ...(intendedTimestamp ? [row.updated_at ?? null] : [])],
      )
      if (!written.length) throw new Error('[internal] Custom entity document changed during encryption; retry the operation')
      if (intendedTimestamp) committedChecks.push([row.id, row.entity_type, tenantId, row.organization_id, JSON.stringify(nextDoc), intendedTimestamp])
      updated += 1
    }
    if (committedChecks.length) {
      const committed = await connection.execute<Array<{ verified: string }>>(
        `select count(*)::text as verified from custom_entities_storage where ${committedChecks.map(() => '(id = ? and entity_type = ? and tenant_id is not distinct from ? and organization_id is not distinct from ? and doc = ?::jsonb and updated_at = ?)').join(' or ')}`,
        committedChecks.flat(),
      )
      if (committed.length !== 1 || committed[0].verified !== String(committedChecks.length)) throw new Error('[internal] Persisted custom document batch did not match intended values')
    }
    cursor = rows[rows.length - 1]!.id
    if (!options.dryRun && options.checkpointBatch) await options.checkpointBatch({ operationId, cursor: [cursor], readRows: rows.length, writtenRows: updated - previouslyUpdated })
    if (rows.length < batchSize) break
  }
  return updated
}
