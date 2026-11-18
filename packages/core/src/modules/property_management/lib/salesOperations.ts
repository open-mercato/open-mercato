import { createHash, randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createModuleQueue, type Queue } from '@open-mercato/queue'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolvePoolConfig } from '@open-mercato/shared/lib/db/mikro'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import {
  SalesOperation,
  type SalesOperationKind,
  type SalesOperationStatus,
  type SalesOperationTargetType,
} from '../data/entities'
import type { Scope } from './productUse'
import { conflictError } from './errors'
import { SALES_OPERATION_QUEUE } from './queues'
import { OPERATION_ID_METADATA_KEY } from './salesLookups'

const logger = createLogger('property_management')

export { SALES_OPERATION_QUEUE, OPERATION_ID_METADATA_KEY }
export const DEFAULT_SALES_CONCURRENCY = 2
export const MAX_SALES_CONCURRENCY = 20
export const SALES_OPERATION_CONNECTIONS_PER_JOB = 3
export const TERMINAL_OPERATION_STATUSES: ReadonlySet<SalesOperationStatus> = new Set(['done', 'refused', 'compensated', 'failed'])
export const NON_REUSABLE_OPERATION_STATUSES: ReadonlySet<SalesOperationStatus> = new Set(['refused', 'compensated'])

export type SalesOperationJob = { operationId: string; recheck?: number }
export const SALES_OPERATION_RECHECK_DELAY_MS = 10_000
export const MAX_SALES_OPERATION_RECHECKS = 20

export type RecordOperationInput = {
  kind: SalesOperationKind
  subjectKey: string
  payload: Record<string, unknown>
  targetType: SalesOperationTargetType
  targetId: string
  leaseId?: string | null
  changeId?: string | null
  sequence?: number
  token?: string
  allowCredit?: boolean | null
}

function poolCeiling(poolMax: number): number {
  if (!Number.isFinite(poolMax) || poolMax < 1) return MAX_SALES_CONCURRENCY
  return Math.max(1, Math.floor(poolMax / SALES_OPERATION_CONNECTIONS_PER_JOB))
}

export function resolveSalesConcurrency(
  raw: string | undefined = process.env.OM_PROPERTY_SALES_CONCURRENCY,
  poolMax: number = resolvePoolConfig().poolMax,
): number {
  const parsed = Number.parseInt(raw ?? '', 10)
  const requested = !Number.isFinite(parsed) || parsed < 1 ? DEFAULT_SALES_CONCURRENCY : Math.min(parsed, MAX_SALES_CONCURRENCY)
  return Math.min(requested, poolCeiling(poolMax))
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value instanceof Date) return value.toISOString()
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = canonicalize(record[key])
        return acc
      }, {})
  }
  return value
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

export function hashPayload(payload: Record<string, unknown>): string {
  return createHash('sha256').update(canonicalJson(payload)).digest('hex')
}

export function withOperationMetadata(payload: Record<string, unknown>, operationId: string): Record<string, unknown> {
  const metadata = payload.metadata && typeof payload.metadata === 'object' && !Array.isArray(payload.metadata)
    ? (payload.metadata as Record<string, unknown>)
    : {}
  return { ...payload, metadata: { ...metadata, [OPERATION_ID_METADATA_KEY]: operationId } }
}

function operationConflict() {
  return conflictError('property_management.errors.salesOperationConflict', 'A different billing request for the same purpose already exists.', {
    code: 'sales_operation_conflict',
  })
}

async function reuseOperation(existing: SalesOperation, payloadHash: string): Promise<SalesOperation> {
  if (existing.payloadHash !== payloadHash || NON_REUSABLE_OPERATION_STATUSES.has(existing.status)) {
    throw await operationConflict()
  }
  return existing
}

function createOperation(em: EntityManager, scope: Scope, input: RecordOperationInput, payloadHash: string): SalesOperation {
  const operation = em.create(SalesOperation, {
    id: randomUUID(),
    ...scope,
    kind: input.kind,
    subjectKey: input.subjectKey,
    payloadHash,
    payload: input.payload,
    changeId: input.changeId ?? null,
    sequence: input.sequence ?? 1,
    targetType: input.targetType,
    targetId: input.targetId,
    leaseId: input.leaseId ?? null,
    status: 'pending',
    token: input.token ?? randomUUID(),
    allowCredit: input.allowCredit ?? null,
    attempts: 0,
  })
  em.persist(operation)
  return operation
}

export async function recordOperation(em: EntityManager, scope: Scope, input: RecordOperationInput): Promise<SalesOperation> {
  const payloadHash = hashPayload(input.payload)
  const existing = await findOneWithDecryption(em, SalesOperation, { ...scope, subjectKey: input.subjectKey }, undefined, scope)
  if (existing) return reuseOperation(existing, payloadHash)
  return createOperation(em, scope, input, payloadHash)
}

export async function recordOperations(em: EntityManager, scope: Scope, inputs: readonly RecordOperationInput[]): Promise<SalesOperation[]> {
  if (!inputs.length) return []
  const subjectKeys = Array.from(new Set(inputs.map((input) => input.subjectKey)))
  const existingRows = await findWithDecryption(em, SalesOperation, { ...scope, subjectKey: { $in: subjectKeys } }, undefined, scope)
  const bySubjectKey = new Map(existingRows.map((row) => [row.subjectKey, row]))
  const operations: SalesOperation[] = []
  for (const input of inputs) {
    const payloadHash = hashPayload(input.payload)
    const existing = bySubjectKey.get(input.subjectKey)
    if (existing) {
      operations.push(await reuseOperation(existing, payloadHash))
      continue
    }
    const created = createOperation(em, scope, input, payloadHash)
    bySubjectKey.set(input.subjectKey, created)
    operations.push(created)
  }
  return operations
}

const queues = new Map<string, Queue<SalesOperationJob>>()

export function salesOperationCoalesceKey(job: SalesOperationJob): string | undefined {
  if (job.recheck !== undefined) return undefined
  return `sales_operation:${job.operationId}`
}

export function getSalesOperationQueue(): Queue<SalesOperationJob> {
  const existing = queues.get(SALES_OPERATION_QUEUE)
  if (existing) return existing
  const created = createModuleQueue<SalesOperationJob>(SALES_OPERATION_QUEUE, {
    concurrency: resolveSalesConcurrency(),
    coalesceBy: salesOperationCoalesceKey,
  })
  queues.set(SALES_OPERATION_QUEUE, created)
  return created
}

export type OperationEnqueuer = (operationIds: readonly string[]) => Promise<void>

export type OperationRecheckEnqueuer = (operationId: string, recheck: number) => Promise<void>

export const enqueueSalesOperationRecheck: OperationRecheckEnqueuer = async (operationId, recheck) => {
  const delayMs = recheck > 1 ? SALES_OPERATION_RECHECK_DELAY_MS : undefined
  await getSalesOperationQueue().enqueue({ operationId, recheck }, delayMs ? { delayMs } : undefined)
}

export const enqueueSalesOperations: OperationEnqueuer = async (operationIds) => {
  if (!operationIds.length) return
  const queue = getSalesOperationQueue()
  for (const operationId of operationIds) {
    try {
      await queue.enqueue({ operationId })
    } catch (err) {
      logger.error('Enqueueing a sales operation failed; the lease sweep re-enqueues it', { operationId, err })
      getTelemetryRuntime()?.reportError(err, { module: 'property_management', code: 'property_management.sales_operation_enqueue_failed' })
    }
  }
}
