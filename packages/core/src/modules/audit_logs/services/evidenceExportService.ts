import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { ActionLog, AccessLog } from '@open-mercato/core/modules/audit_logs/data/entities'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'

export const AUDIT_EVIDENCE_FORMAT = 'open-mercato.audit-evidence'
export const AUDIT_EVIDENCE_VERSION = 1
export const DEFAULT_AUDIT_EVIDENCE_LIMIT = 10_000
export const MAX_AUDIT_EVIDENCE_LIMIT = 100_000
const MIN_SIGNING_KEY_BYTES = 32
const ZERO_HASH = '0'.repeat(64)

export type AuditEvidenceScope = {
  tenantId: string
  organizationId: string
  after?: Date
  before?: Date
  limitPerSource?: number
}

export type AuditEvidenceRecordInput = {
  source: string
  type: string
  id: string
  correlationId: string
  occurredAt: Date | string
  tenantId: string
  organizationId: string
  actorId?: string | null
  payload: unknown
}

export type AuditEvidenceCollectContext = {
  em: EntityManager
  scope: Required<Pick<AuditEvidenceScope, 'tenantId' | 'organizationId' | 'limitPerSource'>>
    & Pick<AuditEvidenceScope, 'after' | 'before'>
}

export type AuditEvidenceContributor = {
  id: string
  collect(context: AuditEvidenceCollectContext): Promise<AuditEvidenceRecordInput[]>
}

export type AuditEvidenceRecord = {
  sequence: number
  previousHash: string
  hash: string
  source: string
  type: string
  id: string
  correlationId: string
  occurredAt: string
  tenantId: string
  organizationId: string
  actorId: string | null
  payload: unknown
}

export type AuditEvidenceBundle = {
  format: typeof AUDIT_EVIDENCE_FORMAT
  version: typeof AUDIT_EVIDENCE_VERSION
  generatedAt: string
  scope: {
    tenantId: string
    organizationId: string
    after: string | null
    before: string | null
    limitPerSource: number
  }
  sources: Record<string, number>
  records: AuditEvidenceRecord[]
  integrity: {
    algorithm: 'HMAC-SHA256'
    keyId: string
    finalHash: string
    signature: string
  }
}

export type AuditEvidenceVerification = {
  valid: boolean
  errors: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeCanonicalValue(value: unknown, seen = new Set<object>()): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'bigint') return value.toString()
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') return null
  if (value instanceof Date) return value.toISOString()
  if (Buffer.isBuffer(value)) return value.toString('base64')
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new Error('[internal] Audit evidence payload contains a circular reference')
    seen.add(value)
    const normalized = value.map((item) => normalizeCanonicalValue(item, seen))
    seen.delete(value)
    return normalized
  }
  if (!isRecord(value)) return String(value)
  if (seen.has(value)) throw new Error('[internal] Audit evidence payload contains a circular reference')
  seen.add(value)
  const normalized: Record<string, unknown> = {}
  for (const key of Object.keys(value).sort()) {
    const item = value[key]
    if (item !== undefined) normalized[key] = normalizeCanonicalValue(item, seen)
  }
  seen.delete(value)
  return normalized
}

export function canonicalizeAuditEvidence(value: unknown): string {
  return JSON.stringify(normalizeCanonicalValue(value))
}

function resolveSigningKey(signingKey: string): Buffer {
  const key = Buffer.from(signingKey, 'utf8')
  if (key.length < MIN_SIGNING_KEY_BYTES) {
    throw new Error(`[internal] Audit evidence signing key must contain at least ${MIN_SIGNING_KEY_BYTES} bytes`)
  }
  return key
}

function hmac(value: unknown, key: Buffer): string {
  return createHmac('sha256', key).update(canonicalizeAuditEvidence(value)).digest('hex')
}

function safeEqualHex(left: string, right: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(left) || !/^[0-9a-f]{64}$/.test(right)) return false
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'))
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_AUDIT_EVIDENCE_LIMIT
  if (!Number.isInteger(limit) || limit <= 0 || limit > MAX_AUDIT_EVIDENCE_LIMIT) {
    throw new Error(`[internal] Audit evidence limit must be between 1 and ${MAX_AUDIT_EVIDENCE_LIMIT}`)
  }
  return limit
}

function normalizeDate(value: Date | string, field: string): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error(`[internal] Invalid audit evidence ${field}`)
  return date.toISOString()
}

function sourceCounts(records: Array<Pick<AuditEvidenceRecordInput, 'source'>>): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const record of records) counts[record.source] = (counts[record.source] ?? 0) + 1
  return counts
}

function unsignedRecord(record: AuditEvidenceRecord): Omit<AuditEvidenceRecord, 'hash'> {
  const { hash: _hash, ...unsigned } = record
  return unsigned
}

export function createSignedAuditEvidenceBundle(
  inputRecords: AuditEvidenceRecordInput[],
  scope: AuditEvidenceScope,
  signingKey: string,
  generatedAt = new Date(),
): AuditEvidenceBundle {
  const key = resolveSigningKey(signingKey)
  const limitPerSource = normalizeLimit(scope.limitPerSource)
  if (!scope.tenantId || !scope.organizationId) {
    throw new Error('[internal] Audit evidence requires tenant and organization scope')
  }
  for (const record of inputRecords) {
    if (!record.id || !record.source || !record.type || !record.correlationId.trim()) {
      throw new Error('[internal] Audit evidence record identifiers must not be empty')
    }
    if (record.tenantId !== scope.tenantId || record.organizationId !== scope.organizationId) {
      throw new Error(`[internal] Audit evidence record ${record.id} does not match the bundle scope`)
    }
  }
  const records = inputRecords
    .map((record) => ({
      ...record,
      occurredAt: normalizeDate(record.occurredAt, 'record timestamp'),
      actorId: record.actorId ?? null,
      payload: normalizeCanonicalValue(record.payload),
    }))
    .sort((left, right) => (
      left.occurredAt.localeCompare(right.occurredAt)
      || left.source.localeCompare(right.source)
      || left.type.localeCompare(right.type)
      || left.id.localeCompare(right.id)
    ))

  let previousHash = ZERO_HASH
  const sealedRecords: AuditEvidenceRecord[] = records.map((record, index) => {
    const unsigned = {
      sequence: index + 1,
      previousHash,
      source: record.source,
      type: record.type,
      id: record.id,
      correlationId: record.correlationId,
      occurredAt: record.occurredAt,
      tenantId: record.tenantId,
      organizationId: record.organizationId,
      actorId: record.actorId,
      payload: record.payload,
    }
    const hash = hmac(unsigned, key)
    previousHash = hash
    return { ...unsigned, hash }
  })

  const keyId = createHash('sha256').update(key).digest('hex').slice(0, 16)
  const integrityBase = {
    algorithm: 'HMAC-SHA256' as const,
    keyId,
    finalHash: sealedRecords.at(-1)?.hash ?? ZERO_HASH,
  }
  const unsignedBundle = {
    format: AUDIT_EVIDENCE_FORMAT as typeof AUDIT_EVIDENCE_FORMAT,
    version: AUDIT_EVIDENCE_VERSION as typeof AUDIT_EVIDENCE_VERSION,
    generatedAt: normalizeDate(generatedAt, 'generation timestamp'),
    scope: {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      after: scope.after ? normalizeDate(scope.after, 'after timestamp') : null,
      before: scope.before ? normalizeDate(scope.before, 'before timestamp') : null,
      limitPerSource,
    },
    sources: sourceCounts(records),
    records: sealedRecords,
    integrity: integrityBase,
  }
  return {
    ...unsignedBundle,
    integrity: {
      ...integrityBase,
      signature: hmac(unsignedBundle, key),
    },
  }
}

function hasBundleShape(value: unknown): value is AuditEvidenceBundle {
  if (!isRecord(value) || value.format !== AUDIT_EVIDENCE_FORMAT || value.version !== AUDIT_EVIDENCE_VERSION) return false
  if (!Array.isArray(value.records) || !isRecord(value.scope) || !isRecord(value.sources) || !isRecord(value.integrity)) return false
  return typeof value.generatedAt === 'string'
    && typeof value.scope.tenantId === 'string'
    && typeof value.scope.organizationId === 'string'
    && typeof value.scope.limitPerSource === 'number'
    && value.integrity.algorithm === 'HMAC-SHA256'
    && typeof value.integrity.keyId === 'string'
    && typeof value.integrity.finalHash === 'string'
    && typeof value.integrity.signature === 'string'
}

function hasRecordShape(value: unknown): value is AuditEvidenceRecord {
  if (!isRecord(value)) return false
  return typeof value.sequence === 'number'
    && typeof value.previousHash === 'string'
    && typeof value.hash === 'string'
    && typeof value.source === 'string'
    && typeof value.type === 'string'
    && typeof value.id === 'string'
    && typeof value.correlationId === 'string'
    && value.correlationId.length > 0
    && typeof value.occurredAt === 'string'
    && typeof value.tenantId === 'string'
    && typeof value.organizationId === 'string'
    && (typeof value.actorId === 'string' || value.actorId === null)
}

export function verifyAuditEvidenceBundle(value: unknown, signingKey: string): AuditEvidenceVerification {
  const key = resolveSigningKey(signingKey)
  const errors: string[] = []
  if (!hasBundleShape(value)) return { valid: false, errors: ['Invalid audit evidence bundle format'] }

  let previousHash = ZERO_HASH
  for (let index = 0; index < value.records.length; index += 1) {
    const record = value.records[index]
    if (!hasRecordShape(record)) {
      errors.push(`Invalid record at index ${index}`)
      continue
    }
    if (record.sequence !== index + 1) errors.push(`Invalid sequence at record ${record.id}`)
    if (record.previousHash !== previousHash) errors.push(`Invalid previous hash at record ${record.id}`)
    if (record.tenantId !== value.scope.tenantId || record.organizationId !== value.scope.organizationId) {
      errors.push(`Scope mismatch at record ${record.id}`)
    }
    const expectedHash = hmac(unsignedRecord(record), key)
    if (!safeEqualHex(record.hash, expectedHash)) errors.push(`Invalid hash at record ${record.id}`)
    previousHash = record.hash
  }

  const expectedFinalHash = value.records.length > 0 && hasRecordShape(value.records.at(-1))
    ? value.records.at(-1)?.hash ?? ZERO_HASH
    : ZERO_HASH
  if (!safeEqualHex(value.integrity.finalHash, expectedFinalHash)) errors.push('Invalid final hash')

  const validRecords = value.records.filter(hasRecordShape)
  if (canonicalizeAuditEvidence(value.sources) !== canonicalizeAuditEvidence(sourceCounts(validRecords))) {
    errors.push('Invalid source counts')
  }

  const expectedKeyId = createHash('sha256').update(key).digest('hex').slice(0, 16)
  if (value.integrity.keyId !== expectedKeyId) errors.push('Signing key identifier mismatch')

  const { signature: _signature, ...integrityBase } = value.integrity
  const expectedSignature = hmac({ ...value, integrity: integrityBase }, key)
  if (!safeEqualHex(value.integrity.signature, expectedSignature)) errors.push('Invalid bundle signature')

  return { valid: errors.length === 0, errors }
}

function parseContext(value: unknown): Record<string, unknown> | null {
  if (isRecord(value)) return value
  if (typeof value !== 'string') return null
  try {
    const parsed: unknown = JSON.parse(value)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function resolveEvidenceCorrelationId(
  context: unknown,
  fallbackId: string,
  resourceKind?: string | null,
  resourceId?: string | null,
): string {
  const record = parseContext(context)
  for (const key of ['correlationId', 'requestId', 'agentRunId', 'runId', 'processId', 'sessionId']) {
    const value = record?.[key]
    if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 200)
  }
  if (resourceId && resourceKind && /agent.*run|run.*agent/i.test(resourceKind)) return resourceId
  return fallbackId
}

function createdAtFilter(after?: Date, before?: Date): Record<string, Date> | undefined {
  if (!after && !before) return undefined
  return {
    ...(after ? { $gte: after } : {}),
    ...(before ? { $lte: before } : {}),
  }
}

function requireCompleteSource<Entity>(source: string, rows: Entity[], limit: number): Entity[] {
  if (rows.length > limit) {
    throw new Error(`[internal] Audit evidence source ${source} exceeds the ${limit} record limit; narrow the time range or increase --limit`)
  }
  return rows
}

export class AuditEvidenceExportService {
  constructor(private readonly em: EntityManager) {}

  async export(
    scopeInput: AuditEvidenceScope,
    signingKey: string,
    contributors: AuditEvidenceContributor[] = [],
  ): Promise<AuditEvidenceBundle> {
    const scope = {
      ...scopeInput,
      limitPerSource: normalizeLimit(scopeInput.limitPerSource),
    }
    if (scope.after && scope.before && scope.after > scope.before) {
      throw new Error('[internal] Audit evidence after timestamp must not be later than before timestamp')
    }

    const em = this.em.fork()
    const records = await this.collectCoreRecords(em, scope)
    for (const contributor of contributors) {
      records.push(...await contributor.collect({ em, scope }))
    }
    const outOfScope = records.find((record) => (
      record.tenantId !== scope.tenantId || record.organizationId !== scope.organizationId
    ))
    if (outOfScope) {
      throw new Error(`[internal] Audit evidence contributor returned out-of-scope record ${outOfScope.id}`)
    }
    return createSignedAuditEvidenceBundle(records, scope, signingKey)
  }

  private async collectCoreRecords(
    em: EntityManager,
    scope: AuditEvidenceCollectContext['scope'],
  ): Promise<AuditEvidenceRecordInput[]> {
    const createdAt = createdAtFilter(scope.after, scope.before)
    const actionWhere: FilterQuery<ActionLog> = {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
      ...(createdAt ? { createdAt } : {}),
    }
    const accessWhere: FilterQuery<AccessLog> = {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
      ...(createdAt ? { createdAt } : {}),
    }
    const decryptionScope = {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }
    const actions = requireCompleteSource('audit.action', await findWithDecryption(
      em,
      ActionLog,
      actionWhere,
      { orderBy: { createdAt: 'asc', id: 'asc' }, limit: scope.limitPerSource + 1 },
      decryptionScope,
    ), scope.limitPerSource)
    const accesses = requireCompleteSource('audit.access', await findWithDecryption(
      em,
      AccessLog,
      accessWhere,
      { orderBy: { createdAt: 'asc', id: 'asc' }, limit: scope.limitPerSource + 1 },
      decryptionScope,
    ), scope.limitPerSource)

    return [
      ...actions.map((entry): AuditEvidenceRecordInput => ({
        source: 'audit.action',
        type: entry.commandId,
        id: entry.id,
        correlationId: resolveEvidenceCorrelationId(
          entry.contextJson,
          entry.id,
          entry.resourceKind,
          entry.resourceId,
        ),
        occurredAt: entry.createdAt,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        actorId: entry.actorUserId,
        payload: {
          actionLabel: entry.actionLabel,
          actionType: entry.actionType,
          sourceKey: entry.sourceKey,
          onBehalfOfUserId: entry.onBehalfOfUserId,
          resourceKind: entry.resourceKind,
          resourceId: entry.resourceId,
          parentResourceKind: entry.parentResourceKind,
          parentResourceId: entry.parentResourceId,
          relatedResourceKind: entry.relatedResourceKind,
          relatedResourceId: entry.relatedResourceId,
          executionState: entry.executionState,
          commandPayload: entry.commandPayload,
          snapshotBefore: entry.snapshotBefore,
          snapshotAfter: entry.snapshotAfter,
          changes: entry.changesJson,
          changedFields: entry.changedFields,
          primaryChangedField: entry.primaryChangedField,
          context: entry.contextJson,
          updatedAt: entry.updatedAt,
        },
      })),
      ...accesses.map((entry): AuditEvidenceRecordInput => ({
        source: 'audit.access',
        type: entry.accessType,
        id: entry.id,
        correlationId: resolveEvidenceCorrelationId(entry.contextJson, entry.id),
        occurredAt: entry.createdAt,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        actorId: entry.actorUserId,
        payload: {
          resourceKind: entry.resourceKind,
          resourceId: entry.resourceId,
          fields: entry.fieldsJson,
          context: entry.contextJson,
        },
      })),
    ]
  }
}
