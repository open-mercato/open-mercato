import type { AwilixContainer } from 'awilix'
import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { SalesOperation, type SalesOperationKind } from '../data/entities'
import { classifySalesError, type ClassifiedSalesError } from './salesErrors'
import {
  createSalesDispatcher,
  guardSalesDispatcher,
  resolveSalesDispatchTimeoutMs,
  type SalesDispatcher,
} from './salesDispatcher'
import { reportStalledOperation, STALLED_OPERATION_ATTEMPTS } from './salesOperationAlerts'
import { compareIsoDates, localToday } from './leaseTerm'
import { isCancelSettlement, type CancelSettlement } from './salesRecurrence'
import { loadSettings } from './settings'
import {
  enqueueSalesOperationRecheck,
  enqueueSalesOperations,
  MAX_SALES_OPERATION_RECHECKS,
  TERMINAL_OPERATION_STATUSES,
  withOperationMetadata,
  type OperationEnqueuer,
  type OperationRecheckEnqueuer,
} from './salesOperations'
import { documentLookupOf, type SalesDocumentKind } from './salesLookups'
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
  | 'reconciled'

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
  onCompensationFailed(ctx: OperationRunContext, error: ClassifiedSalesError, failure: { first: boolean }): Promise<void>
  onDuplicated(ctx: OperationRunContext, duplicateIds: string[]): Promise<void>
}

export type RunnerDeps = {
  container: AwilixContainer
  em: EntityManager
  resolveHandler: (op: SalesOperation) => OperationTargetHandler
  dispatcherFactory?: (scope: Scope) => SalesDispatcher
  enqueuer?: OperationEnqueuer
  recheckEnqueuer?: OperationRecheckEnqueuer
  today?: () => string
  dispatchTimeoutMs?: number
}

const CREATING_KINDS: ReadonlySet<SalesOperationKind> = new Set(['quote', 'lease_order', 'extension_order', 'booking_order'])
const LOCK_NOT_AVAILABLE = '55P03'
const STATUS_APPLY_ATTEMPTS = 2

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

type StoredOperationError = NonNullable<SalesOperation['lastError']>

function errorRecord(error: ClassifiedSalesError) {
  return { code: error.code, message: error.message, status: error.status }
}

function storedErrorOf(op: SalesOperation): StoredOperationError | null {
  return op.lastError ?? null
}

function nextErrorRecord(op: SalesOperation, error: ClassifiedSalesError, extra: { compensation?: boolean; stalledReported?: boolean } = {}) {
  const stalledReported = extra.stalledReported ?? storedErrorOf(op)?.stalledReported === true
  const record: StoredOperationError = {
    ...errorRecord(error),
    ...(extra.compensation ? { compensation: true } : {}),
    ...(stalledReported ? { stalledReported: true } : {}),
  }
  return record
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
    const found = await ctx.dispatcher.findDocuments(kind, documentLookupOf(ctx.op))
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
  if (op.kind === 'booking_order') {
    await moveOrderToCancelledStatus(ctx, documentId)
    return
  }
  await cancelOrderFromStart(dispatcher, documentId, `${op.id}:compensate`)
}

export async function moveOrderToCancelledStatus(ctx: OperationRunContext, orderId: string): Promise<void> {
  const settings = await loadSettings(ctx.tx, ctx.scope)
  if (!settings.cancelledOrderStatusEntryId) {
    throw Object.assign(new Error('[internal] No cancelled order status is configured'), { permanentCode: 'cancelled_status_missing' })
  }
  await setDocumentStatusEntry(ctx, 'order', orderId, settings.cancelledOrderStatusEntryId)
}

export async function setDocumentStatusEntry(
  ctx: OperationRunContext,
  kind: SalesDocumentKind,
  id: string,
  statusEntryId: string,
): Promise<void> {
  const document = await ctx.dispatcher.loadDocument(kind, id)
  if (!document || document.deleted) return
  if (document.statusEntryId === statusEntryId) return
  await applyDocumentStatusEntry(ctx.dispatcher, kind, id, statusEntryId)
}

export async function applyDocumentStatusEntry(
  dispatcher: SalesDispatcher,
  kind: SalesDocumentKind,
  id: string,
  statusEntryId: string,
): Promise<void> {
  for (let attempt = 0; attempt < STATUS_APPLY_ATTEMPTS; attempt += 1) {
    await dispatcher.updateDocumentStatus(kind, id, statusEntryId)
    const updated = await dispatcher.loadDocument(kind, id)
    if (!updated || updated.deleted || updated.statusEntryId === statusEntryId) return
  }
  throw Object.assign(new Error(`[internal] Sales kept ${kind} ${id} out of the requested status`), {
    permanentCode: 'sales_status_not_applied',
  })
}

const CANCEL_RECORDED_STATUSES: ReadonlySet<string> = new Set(['cancelling', 'cancelled'])

function isCancelRecorded(status: string): boolean {
  return CANCEL_RECORDED_STATUSES.has(status)
}

export async function cancelOrderFromStart(dispatcher: SalesDispatcher, orderId: string, idempotencyKey: string): Promise<void> {
  const recurrence = await dispatcher.readRecurrence(orderId)
  if (!recurrence) return
  if (isCancelRecorded(recurrence.status) && recurrence.cancelEffectiveOn && compareIsoDates(recurrence.cancelEffectiveOn, recurrence.startsOn) <= 0) {
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
  if (document.statusEntryId === statusEntryId) return
  await applyDocumentStatusEntry(ctx.dispatcher, kind, id, statusEntryId)
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

function scheduleRefusalReport(ctx: OperationRunContext, error: ClassifiedSalesError, cause: unknown): void {
  const { id: operationId, kind } = ctx.op
  ctx.postCommit.push(async () => {
    logger.warn('Sales refused a sales operation for good', { operationId, kind, code: error.code, status: error.status })
    getTelemetryRuntime()?.reportError(cause, {
      module: 'property_management',
      code: 'property_management.sales_operation_refused',
      attributes: { operationId, kind, salesCode: error.code ?? undefined, salesStatus: error.status ?? undefined },
    })
  })
}

async function markRefused(
  ctx: OperationRunContext,
  handler: OperationTargetHandler,
  error: ClassifiedSalesError,
  cause: unknown,
): Promise<RunOutcome> {
  ctx.op.status = 'refused'
  ctx.op.lastError = errorRecord(error)
  await ctx.tx.flush()
  await handler.onRefused(ctx, error)
  await ctx.tx.flush()
  scheduleRefusalReport(ctx, error, cause)
  return 'refused'
}

function scheduleStalledReport(ctx: OperationRunContext, error: ClassifiedSalesError, cause: unknown): void {
  const { op, scope, container, tx } = ctx
  const attempts = op.attempts
  ctx.postCommit.push(() => reportStalledOperation({ container, em: tx, scope, op, error, cause, attempts }))
}

function reportCompensationFailure(op: SalesOperation, error: ClassifiedSalesError, cause: unknown): void {
  logger.error('Compensating a sales operation failed; it stays compensating and is retried', {
    operationId: op.id,
    kind: op.kind,
    attempts: op.attempts,
    code: error.code,
    err: cause,
  })
  getTelemetryRuntime()?.reportError(cause, {
    module: 'property_management',
    code: 'property_management.sales_operation_compensation_failed',
    attributes: { operationId: op.id, kind: op.kind, attempts: op.attempts, salesCode: error.code ?? undefined },
  })
}

export async function runCompensation(ctx: OperationRunContext, handler: OperationTargetHandler): Promise<RunOutcome> {
  ctx.op.status = 'compensating'
  await ctx.tx.flush()
  try {
    await compensateDocument(ctx)
  } catch (err) {
    const error = classify(err)
    const first = !ctx.op.lastError?.compensation
    ctx.op.attempts += 1
    if (error.kind === 'unavailable') {
      ctx.op.lastError = nextErrorRecord(ctx.op, error, { compensation: !first })
      await ctx.tx.flush()
      return 'unavailable'
    }
    reportCompensationFailure(ctx.op, error, err)
    const reportStalled = isStalled(ctx.op, error)
    ctx.op.lastError = nextErrorRecord(ctx.op, error, { compensation: true, ...(reportStalled ? { stalledReported: true } : {}) })
    await ctx.tx.flush()
    if (reportStalled) scheduleStalledReport(ctx, error, err)
    await handler.onCompensationFailed(ctx, error, { first })
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
  const existing = await dispatcher.findDocuments(kind, documentLookupOf(op))
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
  if (existing.length > 1) await handler.onDuplicated(ctx, existing.slice(1))
  const finished = await handler.finish(ctx)
  if (finished === 'invalid') return scheduleCompensation(ctx)
  return markDone(ctx, handler)
}

async function scheduleCompensation(ctx: OperationRunContext): Promise<RunOutcome> {
  ctx.op.status = 'compensating'
  await ctx.tx.flush()
  ctx.enqueue([ctx.op.id])
  return 'compensating'
}

async function reconcileFinished(ctx: OperationRunContext, handler: OperationTargetHandler): Promise<RunOutcome> {
  const { op, dispatcher } = ctx
  const found = await dispatcher.findDocuments(documentKindOf(op.kind), documentLookupOf(op))
  const extras = found.filter((documentId) => documentId !== op.salesDocumentId)
  if (!extras.length) return 'skipped'
  logger.warn('A finished sales operation has extra sales documents', { operationId: op.id, status: op.status, extras })
  await handler.onDuplicated(ctx, extras)
  await ctx.tx.flush()
  return 'reconciled'
}

async function runRecurrenceCancel(ctx: OperationRunContext, handler: OperationTargetHandler): Promise<RunOutcome> {
  const { op, dispatcher } = ctx
  const target = recurrenceCancelTarget(op)
  if (!target) {
    throw Object.assign(new Error('[internal] Invalid recurrence cancellation payload'), { permanentCode: 'invalid_payload' })
  }
  const { orderId, effectiveOn, settlement } = target
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
  const statusEntryId = readString(op.payload, 'statusEntryId')
  if (!documentId || (!status && !statusEntryId)) {
    throw Object.assign(new Error('[internal] Invalid status payload'), { permanentCode: 'invalid_payload' })
  }
  if (statusEntryId) await setDocumentStatusEntry(ctx, kind, documentId, statusEntryId)
  else await setDocumentStatus(ctx, kind, documentId, status as string)
  op.salesDocumentType = kind
  op.salesDocumentId = documentId
  return markDone(ctx, handler)
}

type RecurrenceCancelTarget = { orderId: string; effectiveOn: string; settlement: CancelSettlement }

function recurrenceCancelTarget(op: SalesOperation): RecurrenceCancelTarget | null {
  const orderId = readString(op.payload, 'orderId')
  const effectiveOn = readString(op.payload, 'effectiveOn')
  const settlement = op.payload.settlement
  if (!orderId || !effectiveOn || !isCancelSettlement(settlement)) return null
  return { orderId, effectiveOn, settlement }
}

async function recurrenceCancelReached(ctx: OperationRunContext): Promise<boolean> {
  const target = recurrenceCancelTarget(ctx.op)
  if (!target) return false
  const recurrence = await ctx.dispatcher.readRecurrence(target.orderId)
  if (!recurrence || !isCancelRecorded(recurrence.status) || !recurrence.cancelEffectiveOn) return false
  if (compareIsoDates(recurrence.cancelEffectiveOn, target.effectiveOn) !== 0) return false
  if ((recurrence.cancelSettlement ?? target.settlement) !== target.settlement) return false
  ctx.op.salesDocumentType = 'order'
  ctx.op.salesDocumentId = target.orderId
  return true
}

async function statusChangeReached(ctx: OperationRunContext): Promise<boolean> {
  const { op } = ctx
  const kind = documentKindOf(op.kind)
  const documentId = readString(op.payload, kind === 'quote' ? 'quoteId' : 'orderId')
  const status = readString(op.payload, 'status')
  const statusEntryId = readString(op.payload, 'statusEntryId')
  if (!documentId || (!status && !statusEntryId)) return false
  const document = await ctx.dispatcher.loadDocument(kind, documentId)
  const reached = !document || document.deleted || (statusEntryId ? document.statusEntryId === statusEntryId : document.status === status)
  if (!reached) return false
  op.salesDocumentType = kind
  op.salesDocumentId = documentId
  return true
}

async function targetReachedDespiteRefusal(ctx: OperationRunContext, error: ClassifiedSalesError): Promise<boolean> {
  if (error.kind !== 'permanent' || error.status === null) return false
  if (ctx.op.kind === 'recurrence_cancel') return recurrenceCancelReached(ctx)
  if (ctx.op.kind === 'order_status' || ctx.op.kind === 'quote_status') return statusChangeReached(ctx)
  return false
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
    if (await targetReachedDespiteRefusal(ctx, error)) return markDone(ctx, handler)
    if (error.kind === 'permanent' || error.kind === 'not_found') return markRefused(ctx, handler, error, err)
    throw err
  }
}

type RecordedAttempt = { attempts: number; reportStalled: boolean }

function isStalled(op: SalesOperation, error: ClassifiedSalesError): boolean {
  return error.kind !== 'unavailable' && op.attempts >= STALLED_OPERATION_ATTEMPTS && storedErrorOf(op)?.stalledReported !== true
}

async function recordAttempt(em: EntityManager, operationId: string, scope: Scope, error: ClassifiedSalesError): Promise<RecordedAttempt | null> {
  try {
    return await em.fork().transactional(async (tx) => {
      const op = await findOneWithDecryption(
        tx,
        SalesOperation,
        { id: operationId, ...scope, status: { $nin: [...TERMINAL_OPERATION_STATUSES] } },
        { lockMode: LockMode.PESSIMISTIC_PARTIAL_WRITE, refresh: true },
        scope,
      )
      if (!op || TERMINAL_OPERATION_STATUSES.has(op.status)) return null
      op.attempts += 1
      const reportStalled = isStalled(op, error)
      const compensation = op.status === 'compensating' && op.lastError?.compensation === true
      op.lastError = nextErrorRecord(op, error, { compensation, ...(reportStalled ? { stalledReported: true } : {}) })
      await tx.flush()
      return { attempts: op.attempts, reportStalled }
    })
  } catch (err) {
    logger.error('Recording a sales operation attempt failed', { operationId, err })
    getTelemetryRuntime()?.reportError(err, { module: 'property_management', code: 'property_management.sales_operation_attempt_record_failed' })
    return null
  }
}

async function enqueueRecheck(enqueuer: OperationRecheckEnqueuer, operationId: string, recheck: number): Promise<void> {
  if (recheck > MAX_SALES_OPERATION_RECHECKS) {
    const err = new Error(`[internal] Sales operation ${operationId} stayed locked through ${MAX_SALES_OPERATION_RECHECKS} re-checks`)
    logger.error('A sales operation re-check gave up while another run held the operation', { operationId, recheck })
    getTelemetryRuntime()?.reportError(err, { module: 'property_management', code: 'property_management.sales_operation_recheck_exhausted' })
    return
  }
  try {
    await enqueuer(operationId, recheck)
  } catch (err) {
    logger.error('Re-enqueueing a sales operation re-check failed', { operationId, recheck, err })
    getTelemetryRuntime()?.reportError(err, { module: 'property_management', code: 'property_management.sales_operation_late_enqueue_failed' })
  }
}

function enqueueAfterLateCreate(enqueuer: OperationRecheckEnqueuer, operationId: string): void {
  logger.warn('A timed-out sales document creation settled late; re-checking the operation', { operationId })
  void enqueueRecheck(enqueuer, operationId, 1)
}

export type RunOptions = { recheck?: number }

export async function runSalesOperation(deps: RunnerDeps, operationId: string, options: RunOptions = {}): Promise<RunOutcome> {
  const reader = deps.em.fork()
  const initial = await findOneWithDecryption(reader, SalesOperation, { id: operationId }, undefined, undefined)
  if (!initial) return 'missing'
  if (TERMINAL_OPERATION_STATUSES.has(initial.status) && !CREATING_KINDS.has(initial.kind)) return 'skipped'
  const scope: Scope = { tenantId: initial.tenantId, organizationId: initial.organizationId }
  const dispatcher = deps.dispatcherFactory ? deps.dispatcherFactory(scope) : createSalesDispatcher(deps.container, deps.em, scope)
  const enqueuer = deps.enqueuer ?? enqueueSalesOperations
  const recheckEnqueuer = deps.recheckEnqueuer ?? enqueueSalesOperationRecheck
  const timeoutMs = deps.dispatchTimeoutMs ?? resolveSalesDispatchTimeoutMs()
  const postCommit: Array<() => Promise<void>> = []
  const toEnqueue: string[] = []
  let outcome: RunOutcome
  try {
    outcome = await deps.em.fork().transactional(async (tx) => {
      const locked = await lockOperation(tx, operationId, scope)
      if (locked === 'locked') return 'locked'
      if (!locked) return 'skipped'
      const terminal = TERMINAL_OPERATION_STATUSES.has(locked.status)
      if (terminal && !CREATING_KINDS.has(locked.kind)) return 'skipped'
      if (locked.status === 'pending' && !(await predecessorDone(tx, locked, scope))) return 'deferred'
      await assertTransactionAlive(tx)
      const ctx: OperationRunContext = {
        tx,
        op: locked,
        scope,
        container: deps.container,
        dispatcher: guardSalesDispatcher(dispatcher, {
          timeoutMs,
          beforeCall: () => assertTransactionAlive(tx),
          onLateCreate: () => enqueueAfterLateCreate(recheckEnqueuer, operationId),
        }),
        postCommit,
        enqueue: (ids) => toEnqueue.push(...ids),
        today: deps.today ? deps.today() : localToday(),
      }
      const handler = deps.resolveHandler(locked)
      if (terminal) return reconcileFinished(ctx, handler)
      if (locked.status === 'compensating') return runCompensation(ctx, handler)
      return runPending(ctx, handler)
    })
  } catch (err) {
    const error = classify(err)
    const recorded = await recordAttempt(deps.em, operationId, scope, error)
    if (error.kind === 'unavailable') return 'unavailable'
    if (recorded?.reportStalled) {
      await reportStalledOperation({ container: deps.container, em: deps.em, scope, op: initial, error, cause: err, attempts: recorded.attempts })
    }
    throw err
  }
  for (const effect of postCommit) {
    try {
      await effect()
    } catch (err) {
      logger.error('Sales operation post-commit effect failed', { operationId, err })
      getTelemetryRuntime()?.reportError(err, { module: 'property_management', code: 'property_management.sales_operation_post_commit_failed' })
    }
  }
  if (toEnqueue.length) await enqueuer(toEnqueue)
  if (outcome === 'locked' && options.recheck !== undefined) await enqueueRecheck(recheckEnqueuer, operationId, options.recheck + 1)
  return outcome
}
