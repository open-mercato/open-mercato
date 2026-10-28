import type { AwilixContainer } from 'awilix'
import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { SalesOperation, type SalesOperationKind } from '../data/entities'
import { classifySalesError, type ClassifiedSalesError } from './salesErrors'
import { createSalesDispatcher, type SalesDispatcher } from './salesDispatcher'
import { compareIsoDates, localToday } from './leaseTerm'
import { isCancelSettlement } from './salesRecurrence'
import {
  enqueueSalesOperations,
  TERMINAL_OPERATION_STATUSES,
  withOperationMetadata,
  type OperationEnqueuer,
} from './salesOperations'
import type { SalesDocumentKind } from './salesLookups'
import type { Scope } from './productUse'

const logger = createLogger('property_management')

export type RunOutcome =
  | 'missing'
  | 'skipped'
  | 'locked'
  | 'deferred'
  | 'done'
  | 'refused'
  | 'compensated'
  | 'compensating'
  | 'unavailable'

export type OperationRunContext = {
  tx: EntityManager
  op: SalesOperation
  scope: Scope
  container: AwilixContainer
  dispatcher: SalesDispatcher
  postCommit: Array<() => Promise<void>>
  enqueue: (operationIds: string[]) => void
  today: string
}

export type FinishResult = 'done' | 'invalid'

export type OperationTargetHandler = {
  isHoldValid(ctx: OperationRunContext): Promise<boolean>
  finish(ctx: OperationRunContext): Promise<FinishResult>
  onDone(ctx: OperationRunContext): Promise<void>
  onRefused(ctx: OperationRunContext, error: ClassifiedSalesError): Promise<void>
  onCompensated(ctx: OperationRunContext): Promise<void>
  onCompensationFailed(ctx: OperationRunContext, error: ClassifiedSalesError): Promise<void>
  onDuplicated(ctx: OperationRunContext, duplicateIds: string[]): Promise<void>
}

export type RunnerDeps = {
  container: AwilixContainer
  em: EntityManager
  resolveHandler: (op: SalesOperation) => OperationTargetHandler
  dispatcherFactory?: (scope: Scope) => SalesDispatcher
  enqueuer?: OperationEnqueuer
  today?: () => string
}

const CREATING_KINDS: ReadonlySet<SalesOperationKind> = new Set(['quote', 'lease_order', 'extension_order', 'booking_order'])
const LOCK_NOT_AVAILABLE = '55P03'

function documentKindOf(kind: SalesOperationKind): SalesDocumentKind {
  return kind === 'quote' || kind === 'quote_status' ? 'quote' : 'order'
}

function readString(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key]
  return typeof value === 'string' && value.length ? value : null
}

function isLockNotAvailable(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const record = err as { code?: unknown; name?: unknown; message?: unknown }
  if (record.code === LOCK_NOT_AVAILABLE) return true
  if (typeof record.name === 'string' && record.name.includes('LockWaitTimeout')) return true
  return typeof record.message === 'string' && record.message.includes('could not obtain lock')
}

function errorRecord(error: ClassifiedSalesError) {
  return { code: error.code, message: error.message, status: error.status }
}

async function assertTransactionAlive(tx: EntityManager): Promise<void> {
  await tx.getConnection().execute('select 1', [], 'all', tx.getTransactionContext())
}

async function lockOperation(tx: EntityManager, operationId: string, scope: Scope): Promise<SalesOperation | null | 'locked'> {
  try {
    return await findOneWithDecryption(
      tx,
      SalesOperation,
      { id: operationId, ...scope },
      { lockMode: LockMode.PESSIMISTIC_WRITE_OR_FAIL, refresh: true },
      scope,
    )
  } catch (err) {
    if (isLockNotAvailable(err)) return 'locked'
    throw err
  }
}

async function predecessorDone(tx: EntityManager, op: SalesOperation, scope: Scope): Promise<boolean> {
  if (!op.changeId || op.sequence <= 1) return true
  const previous = await findOneWithDecryption(
    tx,
    SalesOperation,
    { ...scope, changeId: op.changeId, sequence: op.sequence - 1 },
    undefined,
    scope,
  )
  return previous?.status === 'done'
}

async function createDocument(ctx: OperationRunContext, kind: SalesDocumentKind): Promise<string> {
  const payload = withOperationMetadata(ctx.op.payload, ctx.op.id)
  try {
    return kind === 'quote' ? await ctx.dispatcher.createQuote(payload) : await ctx.dispatcher.createOrder(payload)
  } catch (err) {
    const found = await ctx.dispatcher.findDocuments(kind, ctx.op.id, ctx.op.createdAt)
    if (found.length) return found[0]
    throw err
  }
}

async function compensateDocument(ctx: OperationRunContext): Promise<void> {
  const { op, dispatcher } = ctx
  const documentId = op.salesDocumentId
  if (!documentId) return
  if (op.salesDocumentType === 'quote') {
    await setDocumentStatus(ctx, 'quote', documentId, 'canceled')
    return
  }
  await cancelOrderFromStart(dispatcher, documentId, `${op.id}:compensate`)
}

export async function cancelOrderFromStart(dispatcher: SalesDispatcher, orderId: string, idempotencyKey: string): Promise<void> {
  const recurrence = await dispatcher.readRecurrence(orderId)
  if (!recurrence) return
  if (recurrence.status === 'cancelled' && recurrence.cancelEffectiveOn && compareIsoDates(recurrence.cancelEffectiveOn, recurrence.startsOn) <= 0) {
    return
  }
  await dispatcher.cancelRecurrence({
    orderId,
    effectiveOn: recurrence.startsOn,
    settlement: 'credit_full',
    idempotencyKey,
    scheduleVersion: recurrence.scheduleVersion,
    allowCredit: true,
  })
}

async function setDocumentStatus(ctx: OperationRunContext, kind: SalesDocumentKind, id: string, status: string): Promise<void> {
  const document = await ctx.dispatcher.loadDocument(kind, id)
  if (!document || document.deleted) return
  if (document.status === status) return
  const statusEntryId = await ctx.dispatcher.resolveStatusEntryId(status)
  if (!statusEntryId) {
    throw Object.assign(new Error(`[internal] Sales status "${status}" is not configured`), { permanentCode: 'sales_status_missing' })
  }
  await ctx.dispatcher.updateDocumentStatus(kind, id, statusEntryId)
}

function classify(err: unknown): ClassifiedSalesError {
  if (err && typeof err === 'object' && typeof (err as { permanentCode?: unknown }).permanentCode === 'string') {
    return {
      kind: 'permanent',
      status: null,
      code: (err as { permanentCode: string }).permanentCode,
      message: err instanceof Error ? err.message : null,
    }
  }
  return classifySalesError(err)
}

async function markDone(ctx: OperationRunContext, handler: OperationTargetHandler): Promise<RunOutcome> {
  ctx.op.status = 'done'
  ctx.op.lastError = null
  await ctx.tx.flush()
  await handler.onDone(ctx)
  await ctx.tx.flush()
  return 'done'
}

async function markRefused(ctx: OperationRunContext, handler: OperationTargetHandler, error: ClassifiedSalesError): Promise<RunOutcome> {
  ctx.op.status = 'refused'
  ctx.op.lastError = errorRecord(error)
  await ctx.tx.flush()
  await handler.onRefused(ctx, error)
  await ctx.tx.flush()
  return 'refused'
}

export async function runCompensation(ctx: OperationRunContext, handler: OperationTargetHandler): Promise<RunOutcome> {
  ctx.op.status = 'compensating'
  await ctx.tx.flush()
  try {
    await compensateDocument(ctx)
  } catch (err) {
    const error = classify(err)
    ctx.op.attempts += 1
    ctx.op.lastError = errorRecord(error)
    await ctx.tx.flush()
    await handler.onCompensationFailed(ctx, error)
    await ctx.tx.flush()
    return 'compensating'
  }
  ctx.op.status = 'compensated'
  await ctx.tx.flush()
  await handler.onCompensated(ctx)
  await ctx.tx.flush()
  return 'compensated'
}

async function runCreating(ctx: OperationRunContext, handler: OperationTargetHandler): Promise<RunOutcome> {
  const { op, dispatcher } = ctx
  const kind = documentKindOf(op.kind)
  const holdValid = await handler.isHoldValid(ctx)
  const existing = await dispatcher.findDocuments(kind, op.id, op.createdAt)
  if (existing.length > 1) await handler.onDuplicated(ctx, existing.slice(1))
  if (!existing.length && !holdValid) {
    op.status = 'compensated'
    await ctx.tx.flush()
    await handler.onCompensated(ctx)
    await ctx.tx.flush()
    return 'compensated'
  }
  const documentId = existing[0] ?? (await createDocument(ctx, kind))
  op.salesDocumentType = kind
  op.salesDocumentId = documentId
  if (kind === 'order') op.salesDocumentLineId = await dispatcher.firstOrderLineId(documentId)
  await ctx.tx.flush()
  const finished = await handler.finish(ctx)
  if (finished === 'invalid') return runCompensation(ctx, handler)
  return markDone(ctx, handler)
}

async function runRecurrenceCancel(ctx: OperationRunContext, handler: OperationTargetHandler): Promise<RunOutcome> {
  const { op, dispatcher } = ctx
  const orderId = readString(op.payload, 'orderId')
  const effectiveOn = readString(op.payload, 'effectiveOn')
  const settlement = op.payload.settlement
  if (!orderId || !effectiveOn || !isCancelSettlement(settlement)) {
    throw Object.assign(new Error('[internal] Invalid recurrence cancellation payload'), { permanentCode: 'invalid_payload' })
  }
  const recurrence = await dispatcher.readRecurrence(orderId)
  await dispatcher.cancelRecurrence({
    orderId,
    effectiveOn,
    settlement,
    idempotencyKey: op.id,
    scheduleVersion: recurrence?.scheduleVersion ?? null,
    allowCredit: op.allowCredit ?? false,
  })
  op.salesDocumentType = 'order'
  op.salesDocumentId = orderId
  return markDone(ctx, handler)
}

async function runStatusChange(ctx: OperationRunContext, handler: OperationTargetHandler): Promise<RunOutcome> {
  const { op } = ctx
  const kind = documentKindOf(op.kind)
  const documentId = readString(op.payload, kind === 'quote' ? 'quoteId' : 'orderId')
  const status = readString(op.payload, 'status')
  if (!documentId || !status) {
    throw Object.assign(new Error('[internal] Invalid status payload'), { permanentCode: 'invalid_payload' })
  }
  await setDocumentStatus(ctx, kind, documentId, status)
  op.salesDocumentType = kind
  op.salesDocumentId = documentId
  return markDone(ctx, handler)
}

async function runPending(ctx: OperationRunContext, handler: OperationTargetHandler): Promise<RunOutcome> {
  const { op } = ctx
  try {
    if (CREATING_KINDS.has(op.kind)) return await runCreating(ctx, handler)
    if (op.kind === 'recurrence_cancel') return await runRecurrenceCancel(ctx, handler)
    if (op.kind === 'quote_status' || op.kind === 'order_status') return await runStatusChange(ctx, handler)
    throw Object.assign(new Error(`[internal] Unsupported sales operation kind ${op.kind}`), { permanentCode: 'unsupported_kind' })
  } catch (err) {
    const error = classify(err)
    if (error.kind === 'not_found' && (op.kind === 'quote_status' || op.kind === 'order_status')) {
      return markDone(ctx, handler)
    }
    if (error.kind === 'permanent' || error.kind === 'not_found') return markRefused(ctx, handler, error)
    throw err
  }
}

async function recordAttempt(em: EntityManager, operationId: string, scope: Scope, error: ClassifiedSalesError): Promise<void> {
  try {
    const fresh = em.fork()
    const op = await findOneWithDecryption(fresh, SalesOperation, { id: operationId, ...scope }, undefined, scope)
    if (!op || TERMINAL_OPERATION_STATUSES.has(op.status)) return
    op.attempts += 1
    op.lastError = errorRecord(error)
    await fresh.flush()
  } catch (err) {
    logger.error('Recording a sales operation attempt failed', { operationId, err })
  }
}

export async function runSalesOperation(deps: RunnerDeps, operationId: string): Promise<RunOutcome> {
  const reader = deps.em.fork()
  const initial = await findOneWithDecryption(reader, SalesOperation, { id: operationId }, undefined, undefined)
  if (!initial) return 'missing'
  if (TERMINAL_OPERATION_STATUSES.has(initial.status)) return 'skipped'
  const scope: Scope = { tenantId: initial.tenantId, organizationId: initial.organizationId }
  const dispatcher = deps.dispatcherFactory ? deps.dispatcherFactory(scope) : createSalesDispatcher(deps.container, deps.em, scope)
  const enqueuer = deps.enqueuer ?? enqueueSalesOperations
  const postCommit: Array<() => Promise<void>> = []
  const toEnqueue: string[] = []
  let outcome: RunOutcome
  try {
    outcome = await deps.em.fork().transactional(async (tx) => {
      const locked = await lockOperation(tx, operationId, scope)
      if (locked === 'locked') return 'locked'
      if (!locked || TERMINAL_OPERATION_STATUSES.has(locked.status)) return 'skipped'
      if (!(await predecessorDone(tx, locked, scope))) return 'deferred'
      await assertTransactionAlive(tx)
      const ctx: OperationRunContext = {
        tx,
        op: locked,
        scope,
        container: deps.container,
        dispatcher,
        postCommit,
        enqueue: (ids) => toEnqueue.push(...ids),
        today: deps.today ? deps.today() : localToday(),
      }
      const handler = deps.resolveHandler(locked)
      if (locked.status === 'compensating') return runCompensation(ctx, handler)
      return runPending(ctx, handler)
    })
  } catch (err) {
    const error = classify(err)
    await recordAttempt(deps.em, operationId, scope, error)
    if (error.kind === 'unavailable') return 'unavailable'
    throw err
  }
  for (const effect of postCommit) {
    try {
      await effect()
    } catch (err) {
      logger.error('Sales operation post-commit effect failed', { operationId, err })
    }
  }
  if (toEnqueue.length) await enqueuer(toEnqueue)
  return outcome
}
