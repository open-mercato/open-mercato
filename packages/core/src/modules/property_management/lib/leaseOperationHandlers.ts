import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
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
import { cancelOrderFromStart, type OperationRunContext, type OperationTargetHandler } from './salesOperationRunner'
import { compareIsoDates } from './leaseTerm'
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
  return { changeId, kind, code: error.code, message: error.message, at: new Date().toISOString(), restored }
}

function scheduleNotification(
  ctx: OperationRunContext,
  lease: Lease,
  type: StaffNotificationType,
  error: ClassifiedSalesError | null,
  audience: StaffAudience = 'building',
): void {
  const bodyVariables = {
    reference: lease.reference,
    error: error?.message ?? error?.code ?? '',
  }
  ctx.postCommit.push(async () => {
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
  version.state = 'in_force'
  version.salesOrderId = op.salesDocumentId ?? null
  version.salesOrderLineId = op.salesDocumentLineId ?? null
  version.holdToken = null
  lease.status = compareIsoDates(lease.endsOn, ctx.today) < 0 ? 'ended' : 'active'
  lease.currentVersionId = version.id
  lease.salesOrderId = op.salesDocumentId ?? null
  lease.holdToken = null
  lease.billingAttention = false
  lease.updatedAt = new Date()
  ctx.postCommit.push(() => emitLeaseEvent('property_management.lease.activated', lease, { salesOrderId: lease.salesOrderId }))
  scheduleLeaseChanged(ctx, lease)
  return 'done'
}

async function finishExtensionOrder(ctx: OperationRunContext, lease: Lease): Promise<'done' | 'invalid'> {
  const { op, tx, scope } = ctx
  const version = await loadVersion(tx, scope, op.targetId)
  if (!version || version.state !== 'pending' || version.holdToken !== op.token || lease.deletedAt) return 'invalid'
  version.state = 'in_force'
  version.salesOrderId = op.salesDocumentId ?? null
  version.salesOrderLineId = op.salesDocumentLineId ?? null
  version.holdToken = null
  lease.endsOn = version.endsOn
  lease.termMonths += version.months
  lease.currentVersionId = version.id
  lease.salesOrderId = op.salesDocumentId ?? null
  lease.updatedAt = new Date()
  ctx.postCommit.push(() => emitLeaseEvent('property_management.lease.extended', lease, { versionId: version.id, salesOrderId: lease.salesOrderId }))
  scheduleLeaseChanged(ctx, lease)
  return 'done'
}

async function finishQuote(ctx: OperationRunContext): Promise<'done' | 'invalid'> {
  const { op, tx, scope } = ctx
  const proposal = await loadProposal(tx, scope, op.targetId)
  if (!proposal || proposal.status !== 'sending' || proposal.holdToken !== op.token) return 'invalid'
  proposal.status = 'sent'
  proposal.salesQuoteId = op.salesDocumentId ?? null
  proposal.holdToken = null
  proposal.updatedAt = new Date()
  ctx.postCommit.push(() => emitProposalEvent('property_management.lease_proposal.sent', proposal))
  return 'done'
}

async function finish(ctx: OperationRunContext): Promise<'done' | 'invalid'> {
  const lease = await lockLease(ctx)
  if (!lease) return 'invalid'
  if (ctx.op.kind === 'lease_order') return finishLeaseOrder(ctx, lease)
  if (ctx.op.kind === 'extension_order') return finishExtensionOrder(ctx, lease)
  if (ctx.op.kind === 'quote') return finishQuote(ctx)
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

async function onChangeRefused(ctx: OperationRunContext, lease: Lease, error: ClassifiedSalesError): Promise<void> {
  const { op } = ctx
  const changeId = op.changeId as string
  const operations = await changeOperations(ctx, changeId)
  for (const later of operations.filter((entry) => entry.sequence > op.sequence && entry.status === 'pending')) {
    later.status = 'refused'
    later.lastError = { code: 'predecessor_refused', message: null, status: null }
  }
  const earlier = operations.filter((entry) => entry.sequence < op.sequence && entry.status === 'done')
  const creations = earlier.filter((entry) => CREATION_KINDS.has(entry.kind))
  const cancellations = earlier.filter((entry) => entry.kind === 'recurrence_cancel')
  const pending = lease.pendingChange
  if (!pending || pending.changeId !== changeId) return
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
    for (const creation of creations) creation.status = 'compensating'
    ctx.enqueue(creations.map((entry) => entry.id))
    return
  }
  await revertChange(ctx, lease, error)
}

async function onRefused(ctx: OperationRunContext, error: ClassifiedSalesError): Promise<void> {
  const { op } = ctx
  const lease = await lockLease(ctx)
  if (!lease) return
  if (op.changeId) {
    await onChangeRefused(ctx, lease, error)
    return
  }
  if (op.kind === 'quote_status' || op.kind === 'order_status') {
    logger.warn('A sales status change was refused', { operationId: op.id, code: error.code })
    return
  }
  if (op.kind === 'extension_order') {
    const version = await loadVersion(ctx.tx, ctx.scope, op.targetId)
    if (version && version.state === 'pending') {
      version.state = 'reverted'
      version.holdToken = null
    }
  }
  const kind: LeaseBillingRefusal['kind'] = op.kind === 'quote' ? 'proposal' : 'activation'
  lease.billingAttention = op.kind !== 'extension_order'
  lease.lastBillingRefusal = refusalOf(op.id, kind, error, null)
  lease.updatedAt = new Date()
  scheduleNotification(ctx, lease, 'property_management.lease.billing_change_refused', error)
  scheduleLeaseChanged(ctx, lease)
}

async function onCompensated(ctx: OperationRunContext): Promise<void> {
  const { op, tx, scope } = ctx
  if (op.kind === 'lease_order' || op.kind === 'extension_order') {
    const version = await loadVersion(tx, scope, op.targetId)
    if (version && version.state === 'pending') {
      version.state = 'reverted'
      version.holdToken = null
    }
  }
  if (!op.changeId) return
  const operations = await changeOperations(ctx, op.changeId)
  const refused = operations.find((entry) => entry.status === 'refused' && entry.lastError?.code !== 'predecessor_refused')
  if (!refused) return
  const stillCompensating = operations.some((entry) => entry.id !== op.id && entry.status === 'compensating')
  if (stillCompensating) return
  const lease = await lockLease(ctx)
  if (lease) await revertChange(ctx, lease, storedError(refused))
}

async function onCompensationFailed(ctx: OperationRunContext, error: ClassifiedSalesError): Promise<void> {
  const lease = await lockLease(ctx)
  if (!lease) return
  lease.billingAttention = true
  lease.updatedAt = new Date()
  if (ctx.op.attempts <= 1) {
    scheduleNotification(ctx, lease, 'property_management.lease.order_orphaned', error)
    ctx.postCommit.push(() => emitLeaseEvent('property_management.lease.order_orphaned', lease, { operationId: ctx.op.id }))
  }
}

async function onDuplicated(ctx: OperationRunContext, duplicateIds: string[]): Promise<void> {
  const lease = await loadLease(ctx.tx, ctx.scope, ctx.op.leaseId)
  for (const duplicateId of duplicateIds) {
    try {
      if (ctx.op.kind === 'quote') {
        const statusEntryId = await ctx.dispatcher.resolveStatusEntryId('canceled')
        if (statusEntryId) await ctx.dispatcher.updateDocumentStatus('quote', duplicateId, statusEntryId)
      } else {
        await cancelOrderFromStart(ctx.dispatcher, duplicateId, `${ctx.op.id}:duplicate:${duplicateId}`)
      }
    } catch (err) {
      logger.error('Compensating a duplicated sales document failed', { operationId: ctx.op.id, duplicateId, err })
    }
  }
  if (lease) {
    scheduleNotification(
      ctx,
      lease,
      'property_management.sales_operation.duplicated',
      { kind: 'permanent', status: null, code: 'sales_operation_duplicated', message: duplicateIds.join(', ') },
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
