import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import {
  Lease,
  LeaseProposal,
  LeaseVersion,
  SalesOperation,
  Unit,
  type LeaseBillingRefusal,
  type LeaseChangeKind,
} from '../data/entities'
import type { ClassifiedSalesError } from './salesErrors'
import { describeDuplicateOutcome, describeSalesError, salesRefusalMessage } from './salesErrorText'
import { applyDocumentStatusEntry, cancelOrderFromStart, type OperationRunContext, type OperationTargetHandler } from './salesOperationRunner'
import { compareIsoDates } from './leaseTerm'
import { closeProposal } from './leaseRecords'
import { recordOperation, TERMINAL_OPERATION_STATUSES } from './salesOperations'
import { findOverlaps, loadReservedRanges } from './leaseOccupancy'
import { findBookingListInTerm } from './usageGuards'
import { emitLeaseEvent, emitProposalEvent, markLeaseChanged } from './leaseEvents'
import { notifyStaff, type StaffNotificationType } from './staffNotifications'
import type { StaffAudience } from './staffRecipients'
import type { Scope } from './productUse'

const logger = createLogger('property_management')

const CREATION_KINDS = new Set(['lease_order', 'extension_order'])

async function lockUnit(tx: EntityManager, scope: Scope, unitId: string): Promise<void> {
  await findOneWithDecryption(tx, Unit, { id: unitId, ...scope }, { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true }, scope)
}

async function loadLease(tx: EntityManager, scope: Scope, leaseId: string | null | undefined): Promise<Lease | null> {
  if (!leaseId) return null
  return findOneWithDecryption(tx, Lease, { id: leaseId, ...scope }, { refresh: true }, scope)
}

async function lockLease(ctx: OperationRunContext): Promise<Lease | null> {
  const lease = await loadLease(ctx.tx, ctx.scope, ctx.op.leaseId)
  if (!lease) return null
  await lockUnit(ctx.tx, ctx.scope, lease.unitId)
  return loadLease(ctx.tx, ctx.scope, lease.id)
}

async function loadVersion(tx: EntityManager, scope: Scope, id: string): Promise<LeaseVersion | null> {
  return findOneWithDecryption(tx, LeaseVersion, { id, ...scope }, { refresh: true }, scope)
}

async function loadProposal(tx: EntityManager, scope: Scope, id: string): Promise<LeaseProposal | null> {
  return findOneWithDecryption(tx, LeaseProposal, { id, ...scope }, { refresh: true }, scope)
}

function refusalOf(
  changeId: string,
  kind: LeaseBillingRefusal['kind'],
  error: ClassifiedSalesError,
  restored: LeaseBillingRefusal['restored'],
): LeaseBillingRefusal {
  return { changeId, kind, code: error.code, message: salesRefusalMessage(error), at: new Date().toISOString(), restored }
}

function scheduleNotification(
  ctx: OperationRunContext,
  lease: Lease,
  type: StaffNotificationType,
  error: ClassifiedSalesError | null,
  audience: StaffAudience = 'building',
): void {
  const reference = lease.reference
  ctx.postCommit.push(async () => {
    const bodyVariables = { reference, error: await describeSalesError(error) }
    await notifyStaff({
      container: ctx.container,
      em: ctx.tx.fork(),
      scope: ctx.scope,
      type,
      buildingId: lease.buildingId,
      audience,
      leaseId: lease.id,
      bodyVariables,
      groupKey: `${type}:${ctx.op.id}`,
    })
  })
}

function scheduleLeaseChanged(ctx: OperationRunContext, lease: Lease): void {
  ctx.postCommit.push(() => markLeaseChanged(ctx.container, lease, 'updated'))
}

async function isHoldValid(ctx: OperationRunContext): Promise<boolean> {
  const { op, tx, scope } = ctx
  if (op.kind === 'lease_order') {
    const lease = await loadLease(tx, scope, op.leaseId)
    return Boolean(lease && !lease.deletedAt && lease.holdToken === op.token)
  }
  if (op.kind === 'extension_order') {
    const version = await loadVersion(tx, scope, op.targetId)
    return Boolean(version && version.state === 'pending' && version.holdToken === op.token)
  }
  if (op.kind === 'quote') {
    const proposal = await loadProposal(tx, scope, op.targetId)
    return Boolean(proposal && proposal.status === 'sending' && proposal.holdToken === op.token)
  }
  return true
}

async function finishLeaseOrder(ctx: OperationRunContext, lease: Lease): Promise<'done' | 'invalid'> {
  const { op, tx, scope } = ctx
  if (lease.deletedAt || lease.holdToken !== op.token) return 'invalid'
  const version = await loadVersion(tx, scope, op.targetId)
  if (!version) return 'invalid'
  const compensationPending = await hasFailingOperation(ctx, lease.id)
  version.state = 'in_force'
  version.salesOrderId = op.salesDocumentId ?? null
  version.salesOrderLineId = op.salesDocumentLineId ?? null
  version.holdToken = null
  lease.status = compareIsoDates(lease.endsOn, ctx.today) < 0 ? 'ended' : 'active'
  lease.currentVersionId = version.id
  lease.salesOrderId = op.salesDocumentId ?? null
  lease.holdToken = null
  lease.billingAttention = compensationPending
  lease.updatedAt = new Date()
  ctx.postCommit.push(() => emitLeaseEvent('property_management.lease.activated', lease, { salesOrderId: lease.salesOrderId }))
  if (lease.status === 'ended') ctx.postCommit.push(() => emitLeaseEvent('property_management.lease.ended', lease))
  scheduleLeaseChanged(ctx, lease)
  return 'done'
}

async function finishExtensionOrder(ctx: OperationRunContext, lease: Lease): Promise<'done' | 'invalid'> {
  const { op, tx, scope } = ctx
  const version = await loadVersion(tx, scope, op.targetId)
  if (!version || version.state !== 'pending' || version.holdToken !== op.token || lease.deletedAt || lease.status !== 'active') return 'invalid'
  version.state = 'in_force'
  version.salesOrderId = op.salesDocumentId ?? null
  version.salesOrderLineId = op.salesDocumentLineId ?? null
  version.holdToken = null
  lease.endsOn = version.endsOn
  lease.termMonths += version.months
  lease.currentVersionId = version.id
  lease.salesOrderId = op.salesDocumentId ?? null
  clearSupersededRefusal(lease)
  lease.updatedAt = new Date()
  ctx.postCommit.push(() => emitLeaseEvent('property_management.lease.extended', lease, { versionId: version.id, salesOrderId: lease.salesOrderId }))
  scheduleLeaseChanged(ctx, lease)
  return 'done'
}

async function finishQuote(ctx: OperationRunContext, lease: Lease): Promise<'done' | 'invalid'> {
  const { op, tx, scope } = ctx
  const proposal = await loadProposal(tx, scope, op.targetId)
  if (!proposal || proposal.status !== 'sending' || proposal.holdToken !== op.token) return 'invalid'
  proposal.status = 'sent'
  proposal.salesQuoteId = op.salesDocumentId ?? null
  proposal.holdToken = null
  proposal.updatedAt = new Date()
  ctx.postCommit.push(() => emitProposalEvent('property_management.lease_proposal.sent', proposal))
  if (clearSupersededRefusal(lease)) {
    lease.updatedAt = new Date()
    scheduleLeaseChanged(ctx, lease)
  }
  return 'done'
}

async function finish(ctx: OperationRunContext): Promise<'done' | 'invalid'> {
  const lease = await lockLease(ctx)
  if (!lease) return 'invalid'
  if (ctx.op.kind === 'lease_order') return finishLeaseOrder(ctx, lease)
  if (ctx.op.kind === 'extension_order') return finishExtensionOrder(ctx, lease)
  if (ctx.op.kind === 'quote') return finishQuote(ctx, lease)
  return 'done'
}

async function changeOperations(ctx: OperationRunContext, changeId: string): Promise<SalesOperation[]> {
  return findWithDecryption(
    ctx.tx,
    SalesOperation,
    { ...ctx.scope, changeId },
    { orderBy: { sequence: 'asc' }, refresh: true },
    ctx.scope,
  )
}

function retainsBillingAttention(lease: Lease): boolean {
  const refusal = lease.lastBillingRefusal
  if (!refusal || refusal.restored || refusal.kind === 'proposal' || refusal.kind === 'extension') return false
  if (refusal.kind === 'activation') return lease.status === 'pending_order'
  return true
}

function clearSupersededRefusal(lease: Lease): boolean {
  if (!lease.lastBillingRefusal || retainsBillingAttention(lease)) return false
  lease.lastBillingRefusal = null
  return true
}

async function hasFailingOperation(ctx: OperationRunContext, leaseId: string): Promise<boolean> {
  const failing = await findWithDecryption(
    ctx.tx,
    SalesOperation,
    { ...ctx.scope, leaseId, status: 'compensating', id: { $ne: ctx.op.id } },
    { refresh: true },
    ctx.scope,
  )
  return failing.length > 0
}

async function clearSettledBillingAttention(ctx: OperationRunContext, lease: Lease): Promise<boolean> {
  if (!lease.billingAttention || retainsBillingAttention(lease)) return false
  if (await hasFailingOperation(ctx, lease.id)) return false
  lease.billingAttention = false
  lease.updatedAt = new Date()
  return true
}

export async function completeChange(ctx: OperationRunContext, lease: Lease, changeId: string): Promise<void> {
  const pending = lease.pendingChange
  if (!pending || pending.changeId !== changeId) return
  const kind: LeaseChangeKind = pending.kind
  lease.pendingChange = null
  lease.lastBillingRefusal = null
  lease.updatedAt = new Date()
  if (kind === 'end' && compareIsoDates(lease.endsOn, ctx.today) < 0 && lease.status === 'active') {
    lease.status = 'ended'
    ctx.postCommit.push(() => emitLeaseEvent('property_management.lease.ended', lease))
  }
  await ctx.tx.flush()
  await clearSettledBillingAttention(ctx, lease)
  scheduleLeaseChanged(ctx, lease)
}

export async function revertChange(ctx: OperationRunContext, lease: Lease, error: ClassifiedSalesError): Promise<void> {
  const pending = lease.pendingChange
  if (!pending) return
  const previous = pending.previous
  lease.endsOn = previous.endsOn
  lease.startsOn = previous.startsOn
  lease.status = previous.status
  lease.termMonths = previous.termMonths
  lease.currentVersionId = previous.currentVersionId
  lease.pendingChange = null
  lease.lastBillingRefusal = refusalOf(pending.changeId, pending.kind, error, {
    endsOn: previous.endsOn,
    startsOn: previous.startsOn,
    status: previous.status,
  })
  lease.updatedAt = new Date()
  scheduleNotification(ctx, lease, 'property_management.lease.billing_change_refused', error)
  scheduleLeaseChanged(ctx, lease)
}

async function onDone(ctx: OperationRunContext): Promise<void> {
  const { op } = ctx
  if (!op.changeId) return
  const operations = await changeOperations(ctx, op.changeId)
  const next = operations.find((entry) => entry.sequence === op.sequence + 1)
  if (next) {
    if (next.status === 'pending') ctx.enqueue([next.id])
    return
  }
  const lease = await lockLease(ctx)
  if (lease) await completeChange(ctx, lease, op.changeId)
}

function storedError(op: SalesOperation): ClassifiedSalesError {
  return {
    kind: 'permanent',
    status: op.lastError?.status ?? null,
    code: op.lastError?.code ?? null,
    message: op.lastError?.message ?? null,
  }
}

function compareIds(left: SalesOperation, right: SalesOperation): number {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0
}

async function lockSiblingOperations(ctx: OperationRunContext, operations: SalesOperation[]): Promise<SalesOperation[]> {
  const locked: SalesOperation[] = []
  for (const operation of [...operations].sort(compareIds)) {
    const row = await findOneWithDecryption(
      ctx.tx,
      SalesOperation,
      { id: operation.id, ...ctx.scope },
      { lockMode: LockMode.PESSIMISTIC_WRITE_OR_FAIL, refresh: true },
      ctx.scope,
    )
    if (row) locked.push(row)
  }
  return locked
}

async function canRestoreDeletedLease(
  ctx: OperationRunContext,
  lease: Lease,
  previous: { startsOn: string; endsOn: string },
): Promise<boolean> {
  const term = { startsOn: previous.startsOn, endsOn: previous.endsOn }
  const ranges = await loadReservedRanges(ctx.tx, ctx.scope, [lease.unitId], { excludeLeaseId: lease.id })
  if (findOverlaps(ranges, lease.unitId, term).length) return false
  const bookings = await findBookingListInTerm(ctx.tx, ctx.scope, lease.unitId, term)
  return bookings.total === 0
}

async function onChangeRefused(ctx: OperationRunContext, changeId: string, error: ClassifiedSalesError): Promise<void> {
  const { op } = ctx
  const snapshot = await loadLease(ctx.tx, ctx.scope, op.leaseId)
  if (!snapshot) return
  const operations = await changeOperations(ctx, changeId)
  const later = operations.filter((entry) => entry.sequence > op.sequence && entry.status === 'pending')
  const earlier = operations.filter((entry) => entry.sequence < op.sequence && entry.status === 'done')
  const creations = earlier.filter((entry) => CREATION_KINDS.has(entry.kind))
  const cancellations = earlier.filter((entry) => entry.kind === 'recurrence_cancel')
  const snapshotChange = snapshot.pendingChange
  const compensatesCreations = Boolean(
    snapshotChange && snapshotChange.changeId === changeId && snapshotChange.kind !== 'delete' && !cancellations.length && creations.length,
  )
  const laterIds = new Set(later.map((entry) => entry.id))
  const compensatingIds: string[] = []
  for (const sibling of await lockSiblingOperations(ctx, compensatesCreations ? [...later, ...creations] : later)) {
    if (laterIds.has(sibling.id)) {
      if (sibling.status !== 'pending') continue
      sibling.status = 'refused'
      sibling.lastError = { code: 'predecessor_refused', message: null, status: null }
    } else if (sibling.status === 'done') {
      sibling.status = 'compensating'
      compensatingIds.push(sibling.id)
    }
  }
  await ctx.tx.flush()
  const lease = await lockLease(ctx)
  if (!lease) return
  const pending = lease.pendingChange
  if (!pending || pending.changeId !== changeId) return
  if (pending.kind === 'delete' && !cancellations.length && (await canRestoreDeletedLease(ctx, lease, pending.previous))) {
    lease.deletedAt = null
    await revertChange(ctx, lease, error)
    return
  }
  if (pending.kind === 'delete' || cancellations.length) {
    lease.pendingChange = null
    lease.billingAttention = true
    lease.lastBillingRefusal = refusalOf(changeId, pending.kind, error, null)
    lease.updatedAt = new Date()
    scheduleNotification(ctx, lease, 'property_management.lease.billing_change_refused', error, 'administrators')
    scheduleLeaseChanged(ctx, lease)
    return
  }
  if (creations.length) {
    ctx.enqueue(compensatingIds)
    return
  }
  await revertChange(ctx, lease, error)
}

async function closeRefusedProposal(ctx: OperationRunContext, lease: Lease): Promise<void> {
  const proposal = await loadProposal(ctx.tx, ctx.scope, ctx.op.targetId)
  if (!proposal || proposal.status !== 'sending' || proposal.holdToken !== ctx.op.token) return
  const statusOp = await closeProposal(ctx.tx, ctx.scope, lease, proposal, 'withdrawn')
  if (statusOp) ctx.enqueue([statusOp.id])
  ctx.postCommit.push(() => emitProposalEvent('property_management.lease_proposal.withdrawn', proposal))
}

async function onRefused(ctx: OperationRunContext, error: ClassifiedSalesError): Promise<void> {
  const { op } = ctx
  if (op.changeId) {
    await onChangeRefused(ctx, op.changeId, error)
    return
  }
  const lease = await lockLease(ctx)
  if (!lease) return
  if (op.kind === 'quote_status' || op.kind === 'order_status') {
    logger.warn('A sales status change was refused', { operationId: op.id, code: error.code })
    scheduleNotification(ctx, lease, 'property_management.lease.document_status_refused', error)
    return
  }
  if (op.kind === 'extension_order') {
    const version = await loadVersion(ctx.tx, ctx.scope, op.targetId)
    if (version && version.state === 'pending') {
      version.state = 'reverted'
      version.holdToken = null
      await ctx.tx.flush()
    }
  }
  if (op.kind === 'quote') await closeRefusedProposal(ctx, lease)
  const kind: LeaseBillingRefusal['kind'] = op.kind === 'quote' ? 'proposal' : op.kind === 'extension_order' ? 'extension' : 'activation'
  const flagsAttention = op.kind !== 'extension_order' && op.kind !== 'quote'
  if (flagsAttention) lease.billingAttention = true
  lease.lastBillingRefusal = refusalOf(op.id, kind, error, null)
  lease.updatedAt = new Date()
  scheduleNotification(ctx, lease, 'property_management.lease.billing_change_refused', error, flagsAttention ? 'administrators' : 'building')
  scheduleLeaseChanged(ctx, lease)
}

async function onCompensated(ctx: OperationRunContext): Promise<void> {
  const { op, tx, scope } = ctx
  if (op.kind === 'lease_order' || op.kind === 'extension_order') {
    const version = await loadVersion(tx, scope, op.targetId)
    if (version && version.state === 'pending') {
      version.state = 'reverted'
      version.holdToken = null
      await tx.flush()
    }
  }
  const lease = await lockLease(ctx)
  if (!lease) return
  let reverted = false
  if (op.changeId) {
    const operations = await changeOperations(ctx, op.changeId)
    const refused = operations.find((entry) => entry.status === 'refused' && entry.lastError?.code !== 'predecessor_refused')
    const stillCompensating = operations.some((entry) => entry.id !== op.id && entry.status === 'compensating')
    if (refused && !stillCompensating) {
      await revertChange(ctx, lease, storedError(refused))
      await tx.flush()
      reverted = true
    }
  }
  if ((await clearSettledBillingAttention(ctx, lease)) && !reverted) scheduleLeaseChanged(ctx, lease)
}

async function onCompensationFailed(ctx: OperationRunContext, error: ClassifiedSalesError, failure: { first: boolean }): Promise<void> {
  const lease = await lockLease(ctx)
  if (!lease) return
  lease.billingAttention = true
  lease.updatedAt = new Date()
  if (failure.first) {
    scheduleNotification(ctx, lease, 'property_management.lease.order_orphaned', error)
    ctx.postCommit.push(() => emitLeaseEvent('property_management.lease.order_orphaned', lease, { operationId: ctx.op.id }))
  }
}

export function duplicateCancellationSubjectKey(orderId: string): string {
  return `duplicate_cancel:${orderId}`
}

export function duplicateQuoteCancellationSubjectKey(quoteId: string): string {
  return `quote_status:${quoteId}:canceled`
}

async function scheduleDuplicateQuoteCancellation(ctx: OperationRunContext, quoteId: string): Promise<void> {
  const subjectKey = duplicateQuoteCancellationSubjectKey(quoteId)
  const existing = await findOneWithDecryption(ctx.tx, SalesOperation, { ...ctx.scope, subjectKey }, undefined, ctx.scope)
  if (existing) {
    if (!TERMINAL_OPERATION_STATUSES.has(existing.status)) ctx.enqueue([existing.id])
    return
  }
  const operation = await recordOperation(ctx.tx, ctx.scope, {
    kind: 'quote_status',
    subjectKey,
    payload: { quoteId, status: 'canceled' },
    targetType: ctx.op.targetType,
    targetId: ctx.op.targetId,
    leaseId: ctx.op.leaseId ?? null,
  })
  await ctx.tx.flush()
  ctx.enqueue([operation.id])
}

async function scheduleDuplicateCancellation(ctx: OperationRunContext, orderId: string): Promise<void> {
  const subjectKey = duplicateCancellationSubjectKey(orderId)
  const existing = await findOneWithDecryption(ctx.tx, SalesOperation, { ...ctx.scope, subjectKey }, undefined, ctx.scope)
  if (existing) {
    if (existing.status === 'compensating') ctx.enqueue([existing.id])
    return
  }
  const operation = await recordOperation(ctx.tx, ctx.scope, {
    kind: 'recurrence_cancel',
    subjectKey,
    payload: { orderId, duplicateOf: ctx.op.id },
    targetType: ctx.op.targetType,
    targetId: ctx.op.targetId,
    leaseId: ctx.op.leaseId ?? null,
    allowCredit: true,
  })
  operation.status = 'compensating'
  operation.salesDocumentType = 'order'
  operation.salesDocumentId = orderId
  await ctx.tx.flush()
  ctx.enqueue([operation.id])
}

async function onDuplicated(ctx: OperationRunContext, duplicateIds: string[]): Promise<void> {
  const lease = await loadLease(ctx.tx, ctx.scope, ctx.op.leaseId)
  const cancelledIds: string[] = []
  const failedIds: string[] = []
  for (const duplicateId of duplicateIds) {
    try {
      if (ctx.op.kind === 'quote') {
        const statusEntryId = await ctx.dispatcher.resolveStatusEntryId('canceled')
        if (!statusEntryId) {
          failedIds.push(duplicateId)
          continue
        }
        await applyDocumentStatusEntry(ctx.dispatcher, 'quote', duplicateId, statusEntryId)
      } else {
        await cancelOrderFromStart(ctx.dispatcher, duplicateId, `${ctx.op.id}:duplicate:${duplicateId}`)
      }
      cancelledIds.push(duplicateId)
    } catch (err) {
      failedIds.push(duplicateId)
      logger.error('Compensating a duplicated sales document failed', { operationId: ctx.op.id, duplicateId, err })
      getTelemetryRuntime()?.reportError(err, { module: 'property_management', code: 'property_management.duplicate_compensation_failed' })
    }
  }
  if (ctx.op.kind === 'quote' && failedIds.length) {
    for (const duplicateId of failedIds) await scheduleDuplicateQuoteCancellation(ctx, duplicateId)
  }
  if (ctx.op.kind !== 'quote' && failedIds.length) {
    const locked = await lockLease(ctx)
    for (const duplicateId of failedIds) await scheduleDuplicateCancellation(ctx, duplicateId)
    if (locked && !locked.billingAttention) {
      locked.billingAttention = true
      locked.updatedAt = new Date()
      scheduleLeaseChanged(ctx, locked)
    }
    await ctx.tx.flush()
  }
  if (lease) {
    scheduleNotification(
      ctx,
      lease,
      'property_management.sales_operation.duplicated',
      { kind: 'permanent', status: null, code: 'sales_operation_duplicated', message: await describeDuplicateOutcome(cancelledIds, failedIds) },
      'administrators',
    )
  }
}

export const leaseOperationHandler: OperationTargetHandler = {
  isHoldValid,
  finish,
  onDone,
  onRefused,
  onCompensated,
  onCompensationFailed,
  onDuplicated,
}
