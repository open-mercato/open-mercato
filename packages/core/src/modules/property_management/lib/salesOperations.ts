import { createHash, randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createModuleQueue, type Queue } from '@open-mercato/queue'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import {
  SalesOperation,
  type SalesOperationKind,
  type SalesOperationStatus,
  type SalesOperationTargetType,
} from '../data/entities'
import type { Scope } from './productUse'
import { conflictError } from './errors'
import { SALES_OPERATION_QUEUE } from './queues'

const logger = createLogger('property_management')

export { SALES_OPERATION_QUEUE }
export const DEFAULT_SALES_CONCURRENCY = 4
export const MAX_SALES_CONCURRENCY = 20
export const TERMINAL_OPERATION_STATUSES: ReadonlySet<SalesOperationStatus> = new Set(['done', 'refused', 'compensated', 'failed'])
export const NON_REUSABLE_OPERATION_STATUSES: ReadonlySet<SalesOperationStatus> = new Set(['refused', 'compensated'])
export const OPERATION_ID_METADATA_KEY = 'propertyManagementOperationId'

export type SalesOperationJob = { operationId: string }

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

export function resolveSalesConcurrency(raw: string | undefined = process.env.OM_PROPERTY_SALES_CONCURRENCY): number {
  const parsed = Number.parseInt(raw ?? '', 10)
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_SALES_CONCURRENCY
  return Math.min(parsed, MAX_SALES_CONCURRENCY)
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

export async function recordOperation(em: EntityManager, scope: Scope, input: RecordOperationInput): Promise<SalesOperation> {
  const payloadHash = hashPayload(input.payload)
  const existing = await findOneWithDecryption(em, SalesOperation, { ...scope, subjectKey: input.subjectKey }, undefined, scope)
  if (existing) {
    if (existing.payloadHash !== payloadHash || NON_REUSABLE_OPERATION_STATUSES.has(existing.status)) {
      throw await conflictError('property_management.errors.salesOperationConflict', 'A different billing request for the same purpose already exists.', {
        code: 'sales_operation_conflict',
      })
    }
    return existing
  }
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

const queues = new Map<string, Queue<SalesOperationJob>>()

export function getSalesOperationQueue(): Queue<SalesOperationJob> {
  const existing = queues.get(SALES_OPERATION_QUEUE)
  if (existing) return existing
  const created = createModuleQueue<SalesOperationJob>(SALES_OPERATION_QUEUE, { concurrency: resolveSalesConcurrency() })
  queues.set(SALES_OPERATION_QUEUE, created)
  return created
}

export type OperationEnqueuer = (operationIds: readonly string[]) => Promise<void>

export const enqueueSalesOperations: OperationEnqueuer = async (operationIds) => {
  if (!operationIds.length) return
  const queue = getSalesOperationQueue()
  for (const operationId of operationIds) {
    try {
      await queue.enqueue({ operationId })
    } catch (err) {
      logger.error('Enqueueing a sales operation failed; the lease sweep re-enqueues it', { operationId, err })
    }
  }
}
