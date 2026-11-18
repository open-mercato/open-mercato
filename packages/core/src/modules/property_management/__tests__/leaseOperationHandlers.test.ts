/** @jest-environment node */
import type { AwilixContainer } from 'awilix'
import { Lease, LeaseProposal, LeaseVersion, SalesOperation, Unit, type SalesOperationKind } from '../data/entities'
import { FakeEm } from './support/fakeEm'

jest.mock('@open-mercato/shared/lib/encryption/find', () => jest.requireActual('./support/fakeEm').encryptionFindMock())
jest.mock('@open-mercato/queue', () => ({ createModuleQueue: jest.fn(() => ({ enqueue: jest.fn() })) }))
jest.mock('../lib/staffNotifications', () => ({ notifyStaff: jest.fn(async () => []) }))
jest.mock('../lib/leaseEvents', () => ({
  emitLeaseEvent: jest.fn(async () => undefined),
  emitProposalEvent: jest.fn(async () => undefined),
  markLeaseChanged: jest.fn(async () => undefined),
}))

import { leaseOperationHandler } from '../lib/leaseOperationHandlers'
import { runSalesOperation, type OperationRunContext } from '../lib/salesOperationRunner'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { SalesDispatcher } from '../lib/salesDispatcher'
import { SalesContractUnavailableError, type ClassifiedSalesError } from '../lib/salesErrors'
import { notifyStaff } from '../lib/staffNotifications'
import { emitLeaseEvent, emitProposalEvent, markLeaseChanged } from '../lib/leaseEvents'

const scope = { tenantId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222' }
const refusal: ClassifiedSalesError = { kind: 'permanent', status: 409, code: 'recurring_cancel_would_credit', message: 'Would credit' }

function seedLease(em: FakeEm, overrides: Partial<Lease> = {}): Lease {
  em.seed(Unit, { id: 'unit-1', ...scope, buildingId: 'b1', floorId: 'f1', spaceId: 's1', name: 'Office 1' })
  return em.seed(Lease, {
    id: 'lease-1',
    ...scope,
    reference: 'L-2026-001',
    buildingId: 'b1',
    unitId: 'unit-1',
    customerCompanyId: 'company-1',
    status: 'active',
    startsOn: '2026-01-10',
    termMonths: 12,
    endsOn: '2027-01-09',
    currentVersionId: 'v1',
    holdToken: null,
    salesOrderId: 'order-1',
    pendingChange: null,
    billingAttention: false,
    lastBillingRefusal: null,
    deletedAt: null,
    ...overrides,
  } as never) as unknown as Lease
}

function seedOp(em: FakeEm, overrides: Partial<SalesOperation> & { id: string; kind: SalesOperationKind }): SalesOperation {
  return em.seed(SalesOperation, {
    ...scope,
    subjectKey: overrides.id,
    payloadHash: 'h',
    payload: {},
    changeId: null,
    sequence: 1,
    targetType: 'lease',
    targetId: 'lease-1',
    leaseId: 'lease-1',
    status: 'pending',
    token: 'token-1',
    attempts: 0,
    lastError: null,
    ...overrides,
  } as never) as unknown as SalesOperation
}

function context(em: FakeEm, op: SalesOperation, today = '2026-06-01') {
  const enqueued: string[] = []
  const ctx: OperationRunContext = {
    tx: em as never,
    op,
    scope,
    container: { resolve: jest.fn() } as unknown as AwilixContainer,
    dispatcher: {} as SalesDispatcher,
    postCommit: [],
    enqueue: (ids) => enqueued.push(...ids),
    today,
  }
  const runPostCommit = async () => {
    for (const effect of ctx.postCommit) await effect()
  }
  return { ctx, enqueued, runPostCommit }
}

const previous = { endsOn: '2027-01-09', startsOn: '2026-01-10', status: 'active' as const, termMonths: 12, currentVersionId: 'v1' }

beforeEach(() => jest.clearAllMocks())

describe('lease activation and proposals', () => {
  it('activates a lease when the hold still carries the operation token', async () => {
    const em = new FakeEm()
    const lease = seedLease(em, { status: 'pending_order', holdToken: 'token-1', currentVersionId: null, salesOrderId: null })
    em.seed(LeaseVersion, { id: 'v1', ...scope, leaseId: lease.id, versionNo: 1, state: 'pending', holdToken: 'token-1' } as never)
    const op = seedOp(em, { id: 'op-1', kind: 'lease_order', targetType: 'lease_version', targetId: 'v1', salesDocumentId: 'order-9', salesDocumentLineId: 'line-9' })
    const { ctx, runPostCommit } = context(em, op)
    expect(await leaseOperationHandler.isHoldValid(ctx)).toBe(true)
    expect(await leaseOperationHandler.finish(ctx)).toBe('done')
    await runPostCommit()
    expect(lease).toMatchObject({ status: 'active', salesOrderId: 'order-9', currentVersionId: 'v1', holdToken: null })
    expect(em.rows(LeaseVersion)[0]).toMatchObject({ state: 'in_force', salesOrderId: 'order-9', salesOrderLineId: 'line-9' })
    expect(emitLeaseEvent).toHaveBeenCalledWith('property_management.lease.activated', lease, expect.anything())
  })

  it('ends a lease whose term has already passed when its order is created, emitting both events', async () => {
    const em = new FakeEm()
    const lease = seedLease(em, { status: 'pending_order', holdToken: 'token-1', currentVersionId: null, salesOrderId: null, endsOn: '2026-05-14' })
    em.seed(LeaseVersion, { id: 'v1', ...scope, leaseId: lease.id, versionNo: 1, state: 'pending', holdToken: 'token-1' } as never)
    const op = seedOp(em, { id: 'op-1', kind: 'lease_order', targetType: 'lease_version', targetId: 'v1', salesDocumentId: 'order-9' })
    const { ctx, runPostCommit } = context(em, op, '2026-06-01')
    expect(await leaseOperationHandler.finish(ctx)).toBe('done')
    await runPostCommit()
    expect(lease.status).toBe('ended')
    expect(emitLeaseEvent).toHaveBeenCalledWith('property_management.lease.activated', lease, expect.anything())
    expect(emitLeaseEvent).toHaveBeenCalledWith('property_management.lease.ended', lease)
  })

  it('emits no ended event for a lease activated within its term', async () => {
    const em = new FakeEm()
    const lease = seedLease(em, { status: 'pending_order', holdToken: 'token-1', currentVersionId: null, salesOrderId: null })
    em.seed(LeaseVersion, { id: 'v1', ...scope, leaseId: lease.id, versionNo: 1, state: 'pending', holdToken: 'token-1' } as never)
    const op = seedOp(em, { id: 'op-1', kind: 'lease_order', targetType: 'lease_version', targetId: 'v1', salesDocumentId: 'order-9' })
    const { ctx, runPostCommit } = context(em, op)
    await leaseOperationHandler.finish(ctx)
    await runPostCommit()
    expect(lease.status).toBe('active')
    expect(emitLeaseEvent).not.toHaveBeenCalledWith('property_management.lease.ended', expect.anything())
  })

  it('reports an invalid hold once the lease released it', async () => {
    const em = new FakeEm()
    seedLease(em, { status: 'pending_order', holdToken: null })
    const op = seedOp(em, { id: 'op-1', kind: 'lease_order', targetType: 'lease_version', targetId: 'v1' })
    const { ctx } = context(em, op)
    expect(await leaseOperationHandler.isHoldValid(ctx)).toBe(false)
    expect(await leaseOperationHandler.finish(ctx)).toBe('invalid')
  })

  it('moves the end of the lease when a direct extension order exists', async () => {
    const em = new FakeEm()
    const lease = seedLease(em)
    em.seed(LeaseVersion, { id: 'v2', ...scope, leaseId: lease.id, versionNo: 2, state: 'pending', holdToken: 'token-1', endsOn: '2027-07-09', months: 6 } as never)
    const op = seedOp(em, { id: 'op-2', kind: 'extension_order', targetType: 'lease_version', targetId: 'v2', salesDocumentId: 'order-2' })
    const { ctx } = context(em, op)
    expect(await leaseOperationHandler.finish(ctx)).toBe('done')
    expect(lease).toMatchObject({ endsOn: '2027-07-09', termMonths: 18, currentVersionId: 'v2', salesOrderId: 'order-2' })
  })

  it('compensates a direct extension order whose lease has meanwhile ended', async () => {
    const em = new FakeEm()
    const lease = seedLease(em, { status: 'ended' })
    const version = em.seed(LeaseVersion, { id: 'v2', ...scope, leaseId: lease.id, versionNo: 2, state: 'pending', holdToken: 'token-1', endsOn: '2027-07-09', months: 6 } as never)
    const op = seedOp(em, { id: 'op-2', kind: 'extension_order', targetType: 'lease_version', targetId: 'v2', salesDocumentId: 'order-2' })
    const { ctx } = context(em, op)
    expect(await leaseOperationHandler.finish(ctx)).toBe('invalid')
    expect(lease).toMatchObject({ status: 'ended', endsOn: '2027-01-09', termMonths: 12, currentVersionId: 'v1', salesOrderId: 'order-1' })
    expect(version).toMatchObject({ state: 'pending', holdToken: 'token-1' })
  })

  it('clears the refusal of an earlier extension once a later extension order exists', async () => {
    const em = new FakeEm()
    const lease = seedLease(em, {
      lastBillingRefusal: { changeId: 'op-old', kind: 'activation', code: 'order_locked', message: null, at: '2026-05-01T00:00:00Z', restored: null },
    })
    em.seed(LeaseVersion, { id: 'v2', ...scope, leaseId: lease.id, versionNo: 2, state: 'pending', holdToken: 'token-1', endsOn: '2027-07-09', months: 6 } as never)
    const op = seedOp(em, { id: 'op-2', kind: 'extension_order', targetType: 'lease_version', targetId: 'v2', salesDocumentId: 'order-2' })
    expect(await leaseOperationHandler.finish(context(em, op).ctx)).toBe('done')
    expect(lease.lastBillingRefusal).toBeNull()
  })

  it('clears the refusal of an earlier proposal once a later quote is sent', async () => {
    const em = new FakeEm()
    const lease = seedLease(em, {
      lastBillingRefusal: { changeId: 'op-old', kind: 'proposal', code: 'quote_refused', message: null, at: '2026-05-01T00:00:00Z', restored: null },
    })
    em.seed(LeaseProposal, { id: 'p2', ...scope, leaseId: 'lease-1', kind: 'extension', status: 'sending', holdToken: 'token-1' } as never)
    const op = seedOp(em, { id: 'op-q2', kind: 'quote', targetType: 'lease_proposal', targetId: 'p2', salesDocumentId: 'quote-2' })
    const { ctx, runPostCommit } = context(em, op)
    expect(await leaseOperationHandler.finish(ctx)).toBe('done')
    await runPostCommit()
    expect(lease.lastBillingRefusal).toBeNull()
    expect(markLeaseChanged).toHaveBeenCalledWith(ctx.container, lease, 'updated')
  })

  it('keeps a refusal that still holds billing attention when a later extension order exists', async () => {
    const em = new FakeEm()
    const stuck = { changeId: 'change-1', kind: 'end' as const, code: 'order_locked', message: null, at: '2026-05-01T00:00:00Z', restored: null }
    const lease = seedLease(em, { billingAttention: true, lastBillingRefusal: stuck })
    em.seed(LeaseVersion, { id: 'v2', ...scope, leaseId: lease.id, versionNo: 2, state: 'pending', holdToken: 'token-1', endsOn: '2027-07-09', months: 6 } as never)
    const op = seedOp(em, { id: 'op-2', kind: 'extension_order', targetType: 'lease_version', targetId: 'v2', salesDocumentId: 'order-2' })
    expect(await leaseOperationHandler.finish(context(em, op).ctx)).toBe('done')
    expect(lease.lastBillingRefusal).toEqual(stuck)
  })

  it('marks a proposal sent with its quote', async () => {
    const em = new FakeEm()
    seedLease(em, { status: 'proposed' })
    const proposal = em.seed(LeaseProposal, { id: 'p1', ...scope, leaseId: 'lease-1', kind: 'new', status: 'sending', holdToken: 'token-1' } as never)
    const op = seedOp(em, { id: 'op-q', kind: 'quote', targetType: 'lease_proposal', targetId: 'p1', salesDocumentId: 'quote-1' })
    const { ctx, runPostCommit } = context(em, op)
    expect(await leaseOperationHandler.finish(ctx)).toBe('done')
    await runPostCommit()
    expect(proposal).toMatchObject({ status: 'sent', salesQuoteId: 'quote-1', holdToken: null })
    expect(emitProposalEvent).toHaveBeenCalledWith('property_management.lease_proposal.sent', proposal)
  })
})

describe('lease changes', () => {
  it('enqueues the next operation of a change and only completes after the last', async () => {
    const em = new FakeEm()
    const lease = seedLease(em, {
      endsOn: '2026-05-14',
      pendingChange: { kind: 'end', changeId: 'change-1', previous, operationIds: ['op-1', 'op-2'] },
    })
    const first = seedOp(em, { id: 'op-1', kind: 'recurrence_cancel', changeId: 'change-1', sequence: 1, status: 'done' })
    const second = seedOp(em, { id: 'op-2', kind: 'recurrence_cancel', changeId: 'change-1', sequence: 2 })
    const firstRun = context(em, first)
    await leaseOperationHandler.onDone(firstRun.ctx)
    expect(firstRun.enqueued).toEqual(['op-2'])
    expect(lease.pendingChange).not.toBeNull()
    second.status = 'done'
    const secondRun = context(em, second, '2026-06-01')
    await leaseOperationHandler.onDone(secondRun.ctx)
    await secondRun.runPostCommit()
    expect(lease.pendingChange).toBeNull()
    expect(lease.status).toBe('ended')
    expect(emitLeaseEvent).toHaveBeenCalledWith('property_management.lease.ended', lease)
  })

  it('keeps a lease active until its future end passes', async () => {
    const em = new FakeEm()
    const lease = seedLease(em, {
      endsOn: '2026-09-30',
      pendingChange: { kind: 'end', changeId: 'change-1', previous, operationIds: ['op-1'] },
    })
    const op = seedOp(em, { id: 'op-1', kind: 'recurrence_cancel', changeId: 'change-1', sequence: 1, status: 'done' })
    await leaseOperationHandler.onDone(context(em, op, '2026-06-01').ctx)
    expect(lease.pendingChange).toBeNull()
    expect(lease.status).toBe('active')
  })

  it('reverts the lease and notifies the managers when its only cancellation is refused', async () => {
    const em = new FakeEm()
    const lease = seedLease(em, {
      endsOn: '2026-05-14',
      pendingChange: { kind: 'end', changeId: 'change-1', previous, operationIds: ['op-1'] },
    })
    const op = seedOp(em, { id: 'op-1', kind: 'recurrence_cancel', changeId: 'change-1', sequence: 1, status: 'refused', lastError: refusal })
    const { ctx, runPostCommit } = context(em, op)
    await leaseOperationHandler.onRefused(ctx, refusal)
    await runPostCommit()
    expect(lease).toMatchObject({ endsOn: '2027-01-09', status: 'active', pendingChange: null })
    expect(lease.lastBillingRefusal).toMatchObject({ code: 'recurring_cancel_would_credit', restored: { endsOn: '2027-01-09' } })
    expect(notifyStaff).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'property_management.lease.billing_change_refused', buildingId: 'b1', audience: 'building' }),
    )
  })

  it('tells the building staff when sales keeps a lease document in its status', async () => {
    const em = new FakeEm()
    const lease = seedLease(em)
    const op = seedOp(em, { id: 'op-1', kind: 'quote_status', sequence: 1, status: 'refused', lastError: refusal })
    const { ctx, runPostCommit } = context(em, op)
    await leaseOperationHandler.onRefused(ctx, refusal)
    await runPostCommit()
    expect(lease.billingAttention).toBeFalsy()
    expect(notifyStaff).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'property_management.lease.document_status_refused', leaseId: lease.id, buildingId: 'b1', audience: 'building' }),
    )
  })

  it('refuses the rest of the change and waits for compensations before reverting', async () => {
    const em = new FakeEm()
    const lease = seedLease(em, {
      pendingChange: { kind: 'correction', changeId: 'change-1', previous, operationIds: ['op-1', 'op-2', 'op-3'] },
    })
    const creation = seedOp(em, { id: 'op-1', kind: 'lease_order', changeId: 'change-1', sequence: 1, status: 'done', targetType: 'lease_version', targetId: 'v2' })
    const refused = seedOp(em, { id: 'op-2', kind: 'recurrence_cancel', changeId: 'change-1', sequence: 2, status: 'refused', lastError: refusal })
    const later = seedOp(em, { id: 'op-3', kind: 'recurrence_cancel', changeId: 'change-1', sequence: 3 })
    const refusedRun = context(em, refused)
    await leaseOperationHandler.onRefused(refusedRun.ctx, refusal)
    expect(later.status).toBe('refused')
    expect(later.lastError).toMatchObject({ code: 'predecessor_refused' })
    expect(creation.status).toBe('compensating')
    expect(refusedRun.enqueued).toEqual(['op-1'])
    expect(lease.pendingChange).not.toBeNull()
    expect(notifyStaff).not.toHaveBeenCalled()

    creation.status = 'compensated'
    const compensationRun = context(em, creation)
    await leaseOperationHandler.onCompensated(compensationRun.ctx)
    await compensationRun.runPostCommit()
    expect(lease.pendingChange).toBeNull()
    expect(lease.lastBillingRefusal).toMatchObject({ code: 'recurring_cancel_would_credit' })
    expect(notifyStaff).toHaveBeenCalledTimes(1)
  })

  it('locks and updates the sibling operations of a refused change before it locks the unit', async () => {
    const em = new FakeEm()
    seedLease(em, { pendingChange: { kind: 'correction', changeId: 'change-1', previous, operationIds: ['op-1', 'op-2', 'op-3'] } })
    seedOp(em, { id: 'op-1', kind: 'lease_order', changeId: 'change-1', sequence: 1, status: 'done', targetType: 'lease_version', targetId: 'v2' })
    const refused = seedOp(em, { id: 'op-2', kind: 'recurrence_cancel', changeId: 'change-1', sequence: 2, status: 'refused', lastError: refusal })
    seedOp(em, { id: 'op-3', kind: 'recurrence_cancel', changeId: 'change-1', sequence: 3 })
    const steps: string[] = []
    const findOne = em.findOne.bind(em)
    em.findOne = async (entity, where, options) => {
      if (options?.lockMode) steps.push(`lock:${entity.name}:${String(where.id)}`)
      return findOne(entity, where, options)
    }
    const flush = em.flush.bind(em)
    em.flush = async () => {
      steps.push('flush')
      return flush()
    }
    await leaseOperationHandler.onRefused(context(em, refused).ctx, refusal)
    expect(steps).toEqual(['lock:SalesOperation:op-1', 'lock:SalesOperation:op-3', 'flush', 'lock:Unit:unit-1'])
  })

  it('takes no unit lock and changes nothing when a sibling operation of a refused change is locked', async () => {
    const em = new FakeEm()
    const lease = seedLease(em, { pendingChange: { kind: 'correction', changeId: 'change-1', previous, operationIds: ['op-1', 'op-2', 'op-3'] } })
    const refused = seedOp(em, { id: 'op-2', kind: 'recurrence_cancel', changeId: 'change-1', sequence: 2, status: 'refused', lastError: refusal })
    const later = seedOp(em, { id: 'op-3', kind: 'recurrence_cancel', changeId: 'change-1', sequence: 3 })
    em.lockFailures.add('op-3')
    const lockedEntities: string[] = []
    const findOne = em.findOne.bind(em)
    em.findOne = async (entity, where, options) => {
      if (options?.lockMode) lockedEntities.push(entity.name)
      return findOne(entity, where, options)
    }
    await expect(leaseOperationHandler.onRefused(context(em, refused).ctx, refusal)).rejects.toMatchObject({ code: '55P03' })
    expect(lockedEntities).toEqual(['SalesOperation'])
    expect(later.status).toBe('pending')
    expect(lease.pendingChange).not.toBeNull()
  })

  it('keeps the new end and flags the lease when an earlier cancellation of the change already ran', async () => {
    const em = new FakeEm()
    const lease = seedLease(em, {
      endsOn: '2026-05-14',
      pendingChange: { kind: 'end', changeId: 'change-1', previous, operationIds: ['op-1', 'op-2'] },
    })
    seedOp(em, { id: 'op-1', kind: 'recurrence_cancel', changeId: 'change-1', sequence: 1, status: 'done' })
    const refused = seedOp(em, { id: 'op-2', kind: 'recurrence_cancel', changeId: 'change-1', sequence: 2, status: 'refused', lastError: refusal })
    const { ctx, runPostCommit } = context(em, refused)
    await leaseOperationHandler.onRefused(ctx, refusal)
    await runPostCommit()
    expect(lease).toMatchObject({ endsOn: '2026-05-14', billingAttention: true, pendingChange: null })
    expect(notifyStaff).toHaveBeenCalledWith(expect.objectContaining({ audience: 'administrators' }))
  })

  it('restores a deleted lease when sales refuses its first cancellation, so nothing was cancelled', async () => {
    const em = new FakeEm()
    const lease = seedLease(em, {
      deletedAt: new Date(),
      pendingChange: { kind: 'delete', changeId: 'change-1', previous, operationIds: ['op-1', 'op-2'] },
    })
    const refused = seedOp(em, { id: 'op-1', kind: 'recurrence_cancel', changeId: 'change-1', sequence: 1, status: 'refused', lastError: refusal })
    const later = seedOp(em, { id: 'op-2', kind: 'recurrence_cancel', changeId: 'change-1', sequence: 2, status: 'pending' })
    const { ctx, runPostCommit } = context(em, refused)
    await leaseOperationHandler.onRefused(ctx, refusal)
    await runPostCommit()
    expect(lease.deletedAt).toBeNull()
    expect(lease).toMatchObject({ status: 'active', startsOn: '2026-01-10', endsOn: '2027-01-09', pendingChange: null, billingAttention: false })
    expect(lease.lastBillingRefusal).toMatchObject({
      kind: 'delete',
      code: 'recurring_cancel_would_credit',
      restored: { startsOn: '2026-01-10', endsOn: '2027-01-09', status: 'active' },
    })
    expect(later).toMatchObject({ status: 'refused', lastError: { code: 'predecessor_refused' } })
    expect(notifyStaff).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'property_management.lease.billing_change_refused', audience: 'building', leaseId: lease.id }),
    )
    expect(markLeaseChanged).toHaveBeenCalledWith(expect.anything(), lease, 'updated')
  })

  it('keeps a delete whose earlier cancellation already went through, flagging it for the administrators', async () => {
    const em = new FakeEm()
    const lease = seedLease(em, {
      deletedAt: new Date(),
      pendingChange: { kind: 'delete', changeId: 'change-1', previous, operationIds: ['op-1', 'op-2'] },
    })
    seedOp(em, { id: 'op-1', kind: 'recurrence_cancel', changeId: 'change-1', sequence: 1, status: 'done' })
    const refused = seedOp(em, { id: 'op-2', kind: 'recurrence_cancel', changeId: 'change-1', sequence: 2, status: 'refused', lastError: refusal })
    const { ctx, runPostCommit } = context(em, refused)
    await leaseOperationHandler.onRefused(ctx, refusal)
    await runPostCommit()
    expect(lease.deletedAt).toBeInstanceOf(Date)
    expect(lease).toMatchObject({ billingAttention: true, pendingChange: null, lastBillingRefusal: { kind: 'delete', restored: null } })
    expect(notifyStaff).toHaveBeenCalledWith(expect.objectContaining({ audience: 'administrators' }))
  })

  it('keeps a refused delete when another lease took the unit meanwhile', async () => {
    const em = new FakeEm()
    const lease = seedLease(em, {
      deletedAt: new Date(),
      pendingChange: { kind: 'delete', changeId: 'change-1', previous, operationIds: ['op-1'] },
    })
    em.seed(Lease, {
      id: 'lease-2',
      ...scope,
      reference: 'L-2026-002',
      buildingId: 'b1',
      unitId: 'unit-1',
      status: 'active',
      startsOn: '2026-07-01',
      termMonths: 6,
      endsOn: '2026-12-31',
      pendingChange: null,
      deletedAt: null,
    } as never)
    const refused = seedOp(em, { id: 'op-1', kind: 'recurrence_cancel', changeId: 'change-1', sequence: 1, status: 'refused', lastError: refusal })
    await leaseOperationHandler.onRefused(context(em, refused).ctx, refusal)
    expect(lease.deletedAt).toBeInstanceOf(Date)
    expect(lease).toMatchObject({ billingAttention: true, pendingChange: null })
  })

  it('reverts a refused direct extension without touching the lease term', async () => {
    const em = new FakeEm()
    const lease = seedLease(em)
    const version = em.seed(LeaseVersion, { id: 'v2', ...scope, leaseId: lease.id, versionNo: 2, state: 'pending', holdToken: 'token-1' } as never)
    const op = seedOp(em, { id: 'op-x', kind: 'extension_order', targetType: 'lease_version', targetId: 'v2', status: 'refused' })
    await leaseOperationHandler.onRefused(context(em, op).ctx, refusal)
    expect(version).toMatchObject({ state: 'reverted', holdToken: null })
    expect(lease.endsOn).toBe('2027-01-09')
    expect(lease.lastBillingRefusal).toMatchObject({ kind: 'extension' })
    expect(lease.billingAttention).toBeFalsy()
  })

  it('flags a refused activation and tells the administrators', async () => {
    const em = new FakeEm()
    const lease = seedLease(em, { status: 'pending_order', holdToken: 'token-1', currentVersionId: null, salesOrderId: null })
    const op = seedOp(em, { id: 'op-a', kind: 'lease_order', targetType: 'lease_version', targetId: 'v1', status: 'refused' })
    const { ctx, runPostCommit } = context(em, op)
    await leaseOperationHandler.onRefused(ctx, refusal)
    await runPostCommit()
    expect(lease.billingAttention).toBe(true)
    expect(notifyStaff).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'property_management.lease.billing_change_refused', audience: 'administrators' }),
    )
  })

  it('tells the building staff about a refused direct extension, which flags nothing', async () => {
    const em = new FakeEm()
    const lease = seedLease(em)
    em.seed(LeaseVersion, { id: 'v2', ...scope, leaseId: lease.id, versionNo: 2, state: 'pending', holdToken: 'token-1' } as never)
    const op = seedOp(em, { id: 'op-x', kind: 'extension_order', targetType: 'lease_version', targetId: 'v2', status: 'refused' })
    const { ctx, runPostCommit } = context(em, op)
    await leaseOperationHandler.onRefused(ctx, refusal)
    await runPostCommit()
    expect(lease.billingAttention).toBe(false)
    expect(notifyStaff).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'property_management.lease.billing_change_refused', audience: 'building' }),
    )
  })

  it('keeps an unrelated billing attention flag when a direct extension is refused', async () => {
    const em = new FakeEm()
    const lease = seedLease(em, { billingAttention: true })
    em.seed(LeaseVersion, { id: 'v2', ...scope, leaseId: lease.id, versionNo: 2, state: 'pending', holdToken: 'token-1' } as never)
    const op = seedOp(em, { id: 'op-x', kind: 'extension_order', targetType: 'lease_version', targetId: 'v2', status: 'refused' })
    await leaseOperationHandler.onRefused(context(em, op).ctx, refusal)
    expect(lease.billingAttention).toBe(true)
  })

  it('withdraws a proposal whose quote sales refused, releasing its hold', async () => {
    const em = new FakeEm()
    const lease = seedLease(em, { status: 'proposed', currentVersionId: null, salesOrderId: null })
    const version = em.seed(LeaseVersion, { id: 'v1', ...scope, leaseId: lease.id, versionNo: 1, state: 'pending', holdToken: null } as never)
    const proposal = em.seed(LeaseProposal, {
      id: 'p1',
      ...scope,
      leaseId: lease.id,
      versionId: 'v1',
      kind: 'new',
      status: 'sending',
      holdToken: 'token-1',
      salesQuoteId: null,
    } as never)
    const op = seedOp(em, { id: 'op-q', kind: 'quote', targetType: 'lease_proposal', targetId: 'p1', status: 'refused' })
    const { ctx, enqueued, runPostCommit } = context(em, op)
    await leaseOperationHandler.onRefused(ctx, refusal)
    await runPostCommit()
    expect(proposal).toMatchObject({ status: 'withdrawn', holdToken: null })
    expect(version).toMatchObject({ state: 'reverted' })
    expect(lease).toMatchObject({ status: 'withdrawn', billingAttention: false })
    expect(lease.lastBillingRefusal).toMatchObject({ kind: 'proposal' })
    expect(enqueued).toEqual([])
    expect(emitProposalEvent).toHaveBeenCalledWith('property_management.lease_proposal.withdrawn', proposal)
  })

  it('leaves a proposal alone when the refused quote no longer holds it', async () => {
    const em = new FakeEm()
    seedLease(em, { status: 'proposed' })
    const proposal = em.seed(LeaseProposal, { id: 'p1', ...scope, leaseId: 'lease-1', kind: 'new', status: 'sending', holdToken: 'token-other' } as never)
    const op = seedOp(em, { id: 'op-q', kind: 'quote', targetType: 'lease_proposal', targetId: 'p1', status: 'refused' })
    await leaseOperationHandler.onRefused(context(em, op).ctx, refusal)
    expect(proposal).toMatchObject({ status: 'sending', holdToken: 'token-other' })
    expect(emitProposalEvent).not.toHaveBeenCalled()
  })

  it('alerts staff once when compensation keeps failing', async () => {
    const em = new FakeEm()
    const lease = seedLease(em)
    const op = seedOp(em, { id: 'op-c', kind: 'lease_order', status: 'compensating', attempts: 3 })
    const { ctx, runPostCommit } = context(em, op)
    await leaseOperationHandler.onCompensationFailed(ctx, refusal, { first: true })
    await runPostCommit()
    expect(lease.billingAttention).toBe(true)
    expect(notifyStaff).toHaveBeenCalledWith(expect.objectContaining({ type: 'property_management.lease.order_orphaned' }))
    jest.clearAllMocks()
    const second = context(em, op)
    await leaseOperationHandler.onCompensationFailed(second.ctx, refusal, { first: false })
    await second.runPostCommit()
    expect(notifyStaff).not.toHaveBeenCalled()
  })

  it('cancels a duplicated sent quote although sales reverts its first update to draft', async () => {
    const em = new FakeEm()
    seedLease(em)
    const op = seedOp(em, { id: 'op-q', kind: 'quote', targetType: 'lease_proposal', targetId: 'proposal-1' })
    const quote = { id: 'quote-dup', number: 'Q-2', status: 'sent', statusEntryId: 'status-sent', deleted: false }
    const updateDocumentStatus = jest.fn(async (_kind: string, _id: string, statusEntryId: string) => {
      if (quote.status === 'sent') {
        quote.status = 'draft'
        quote.statusEntryId = 'status-draft'
        return
      }
      quote.status = 'canceled'
      quote.statusEntryId = statusEntryId
    })
    const { ctx, runPostCommit } = context(em, op)
    ctx.dispatcher = {
      resolveStatusEntryId: jest.fn(async () => 'status-canceled'),
      updateDocumentStatus,
      loadDocument: jest.fn(async () => ({ ...quote })),
    } as unknown as SalesDispatcher
    await leaseOperationHandler.onDuplicated(ctx, ['quote-dup'])
    await runPostCommit()
    expect(updateDocumentStatus).toHaveBeenCalledTimes(2)
    expect(quote).toMatchObject({ status: 'canceled', statusEntryId: 'status-canceled' })
    expect(notifyStaff).toHaveBeenCalledWith(expect.objectContaining({ type: 'property_management.sales_operation.duplicated' }))
  })

  it('records a retried quote cancellation when cancelling a duplicated quote fails', async () => {
    const em = new FakeEm()
    const lease = seedLease(em)
    const op = seedOp(em, { id: 'op-q', kind: 'quote', targetType: 'lease_proposal', targetId: 'proposal-1' })
    const { ctx, enqueued } = context(em, op)
    ctx.dispatcher = {
      resolveStatusEntryId: jest.fn(async () => 'status-canceled'),
      updateDocumentStatus: jest.fn(async () => {
        throw new Error('sales is restarting')
      }),
      loadDocument: jest.fn(async () => ({ id: 'quote-dup', number: 'Q-2', status: 'sent', statusEntryId: 'status-sent', deleted: false })),
    } as unknown as SalesDispatcher
    await leaseOperationHandler.onDuplicated(ctx, ['quote-dup'])
    const follow = em.rows(SalesOperation).find((row) => row.subjectKey === 'quote_status:quote-dup:canceled') as unknown as SalesOperation
    expect(follow).toMatchObject({
      kind: 'quote_status',
      status: 'pending',
      payload: { quoteId: 'quote-dup', status: 'canceled' },
      targetType: 'lease_proposal',
      targetId: 'proposal-1',
      leaseId: 'lease-1',
    })
    expect(enqueued).toEqual([follow.id])
    expect(lease.billingAttention).toBe(false)
    await leaseOperationHandler.onDuplicated(ctx, ['quote-dup'])
    expect(em.rows(SalesOperation).filter((row) => row.subjectKey === 'quote_status:quote-dup:canceled')).toHaveLength(1)
    expect(enqueued).toEqual([follow.id, follow.id])
  })
})

describe('flushing before reads', () => {
  function flushesAtCompensatingQuery(em: FakeEm): number[] {
    const seen: number[] = []
    const find = em.find.bind(em)
    jest.spyOn(em, 'find').mockImplementation(async (entity, where, options) => {
      if (entity === SalesOperation && (where as { status?: unknown }).status === 'compensating') seen.push(em.flushes)
      return find(entity, where, options)
    })
    return seen
  }

  it('flushes a completed change before looking for failing operations', async () => {
    const em = new FakeEm()
    const lease = seedLease(em, { billingAttention: true, pendingChange: { kind: 'end', changeId: 'change-1', previous, operationIds: ['op-1'] } })
    const op = seedOp(em, { id: 'op-1', kind: 'recurrence_cancel', changeId: 'change-1', sequence: 1, status: 'done' })
    const seen = flushesAtCompensatingQuery(em)
    await leaseOperationHandler.onDone(context(em, op).ctx)
    expect(lease.pendingChange).toBeNull()
    expect(seen).toEqual([1])
  })

  it('flushes a reverted version and a reverted lease before reading further', async () => {
    const em = new FakeEm()
    const lease = seedLease(em, { billingAttention: true, pendingChange: { kind: 'correction', changeId: 'change-1', previous, operationIds: ['op-1', 'op-2'] } })
    em.seed(LeaseVersion, { id: 'v2', ...scope, leaseId: lease.id, versionNo: 2, state: 'pending', holdToken: 'token-1' } as never)
    const op = seedOp(em, { id: 'op-1', kind: 'lease_order', changeId: 'change-1', sequence: 1, targetType: 'lease_version', targetId: 'v2', status: 'compensated' })
    seedOp(em, { id: 'op-2', kind: 'recurrence_cancel', changeId: 'change-1', sequence: 2, status: 'refused', lastError: refusal })
    const seen = flushesAtCompensatingQuery(em)
    await leaseOperationHandler.onCompensated(context(em, op).ctx)
    expect(lease.pendingChange).toBeNull()
    expect(em.flushes).toBe(2)
    expect(seen).toEqual([2])
  })
})

describe('billing attention', () => {
  it('clears the flag once a failing compensation succeeds and nothing else is failing', async () => {
    const em = new FakeEm()
    const lease = seedLease(em, { billingAttention: true })
    const op = seedOp(em, { id: 'op-c', kind: 'extension_order', targetType: 'lease_version', targetId: 'v2', status: 'compensated' })
    await leaseOperationHandler.onCompensated(context(em, op).ctx)
    expect(lease.billingAttention).toBe(false)
  })

  it('keeps the flag while another operation of the lease is still compensating', async () => {
    const em = new FakeEm()
    const lease = seedLease(em, { billingAttention: true })
    seedOp(em, { id: 'op-other', kind: 'lease_order', status: 'compensating' })
    const op = seedOp(em, { id: 'op-c', kind: 'extension_order', targetType: 'lease_version', targetId: 'v2', status: 'compensated' })
    await leaseOperationHandler.onCompensated(context(em, op).ctx)
    expect(lease.billingAttention).toBe(true)
  })

  it('keeps the flag a cancellation sales could not undo raised', async () => {
    const em = new FakeEm()
    const lease = seedLease(em, {
      billingAttention: true,
      lastBillingRefusal: { changeId: 'change-1', kind: 'end', code: 'x', message: null, at: '2026-05-01T00:00:00.000Z', restored: null },
    })
    const op = seedOp(em, { id: 'op-c', kind: 'extension_order', targetType: 'lease_version', targetId: 'v2', status: 'compensated' })
    await leaseOperationHandler.onCompensated(context(em, op).ctx)
    expect(lease.billingAttention).toBe(true)
  })

  it('clears the flag when a later change completes with nothing failing', async () => {
    const em = new FakeEm()
    const lease = seedLease(em, {
      billingAttention: true,
      endsOn: '2026-09-30',
      pendingChange: { kind: 'end', changeId: 'change-1', previous, operationIds: ['op-1'] },
    })
    const op = seedOp(em, { id: 'op-1', kind: 'recurrence_cancel', changeId: 'change-1', sequence: 1, status: 'done' })
    await leaseOperationHandler.onDone(context(em, op).ctx)
    expect(lease).toMatchObject({ pendingChange: null, billingAttention: false })
  })

  it('keeps the flag on change completion while a compensation is still failing', async () => {
    const em = new FakeEm()
    const lease = seedLease(em, {
      billingAttention: true,
      endsOn: '2026-09-30',
      pendingChange: { kind: 'end', changeId: 'change-1', previous, operationIds: ['op-1'] },
    })
    seedOp(em, { id: 'op-orphan', kind: 'extension_order', status: 'compensating', lastError: { code: 'x', message: null, status: 503, compensation: true } })
    const op = seedOp(em, { id: 'op-1', kind: 'recurrence_cancel', changeId: 'change-1', sequence: 1, status: 'done' })
    await leaseOperationHandler.onDone(context(em, op).ctx)
    expect(lease).toMatchObject({ pendingChange: null, billingAttention: true })
  })

  it('does not flag the lease when sales refuses a proposal quote', async () => {
    const em = new FakeEm()
    const lease = seedLease(em, { status: 'proposed' })
    em.seed(LeaseProposal, { id: 'p1', ...scope, leaseId: lease.id, kind: 'extension', status: 'sending', holdToken: 'token-1' } as never)
    const op = seedOp(em, { id: 'op-q', kind: 'quote', targetType: 'lease_proposal', targetId: 'p1', status: 'refused' })
    await leaseOperationHandler.onRefused(context(em, op).ctx, refusal)
    expect(lease.billingAttention).toBe(false)
  })
})

describe('lease staff notification texts', () => {
  it('shows the generic text instead of an internal message or a bare code', async () => {
    const em = new FakeEm()
    seedLease(em)
    const op = seedOp(em, { id: 'op-c', kind: 'lease_order', status: 'compensating', attempts: 3 })
    const internal: ClassifiedSalesError = { kind: 'permanent', status: 422, code: 'some_runner_code', message: '[internal] Something internal' }
    const { ctx, runPostCommit } = context(em, op)
    await leaseOperationHandler.onCompensationFailed(ctx, internal, { first: true })
    await runPostCommit()
    expect(notifyStaff).toHaveBeenCalledWith(
      expect.objectContaining({ bodyVariables: expect.objectContaining({ error: 'Sales could not be reached or failed unexpectedly.' }) }),
    )
  })

  it('lists the cancelled duplicates in the alert', async () => {
    const em = new FakeEm()
    seedLease(em)
    const op = seedOp(em, { id: 'op-d', kind: 'lease_order' })
    const { ctx, runPostCommit } = context(em, op)
    ctx.dispatcher = {
      cancelRecurrence: jest.fn(async () => ({ status: 'cancelled', cancelEffectiveOn: null, creditMemoIds: [] })),
      readRecurrence: jest.fn(async () => ({ orderId: 'order-dup', startsOn: '2026-01-10', scheduleVersion: 1, periods: [] })),
    } as unknown as SalesDispatcher
    await leaseOperationHandler.onDuplicated(ctx, ['order-dup'])
    await runPostCommit()
    expect(notifyStaff).toHaveBeenCalledWith(
      expect.objectContaining({ bodyVariables: expect.objectContaining({ error: 'The extras were cancelled: order-dup.' }) }),
    )
  })
})

describe('duplicated lease orders while sales cannot cancel', () => {
  function unavailableDispatcher() {
    return {
      cancelRecurrence: jest.fn(async () => {
        throw new SalesContractUnavailableError('sales.orders.recurrence.cancel')
      }),
      readRecurrence: jest.fn(async () => ({ orderId: 'order-dup', status: 'scheduled', startsOn: '2026-07-01', scheduleVersion: 1, periods: [] })),
    } as unknown as SalesDispatcher
  }

  it('records a compensating cancellation for the duplicate and flags the lease', async () => {
    const em = new FakeEm()
    const lease = seedLease(em)
    const op = seedOp(em, { id: 'op-d', kind: 'lease_order', targetType: 'lease_version', targetId: 'v1', status: 'done', salesDocumentId: 'order-1' })
    const { ctx, enqueued } = context(em, op)
    ctx.dispatcher = unavailableDispatcher()
    await leaseOperationHandler.onDuplicated(ctx, ['order-dup'])
    const follow = em.rows(SalesOperation).find((row) => row.subjectKey === 'duplicate_cancel:order-dup') as unknown as SalesOperation
    expect(follow).toMatchObject({
      kind: 'recurrence_cancel',
      status: 'compensating',
      salesDocumentType: 'order',
      salesDocumentId: 'order-dup',
      leaseId: 'lease-1',
      targetType: 'lease_version',
      targetId: 'v1',
      allowCredit: true,
    })
    expect(enqueued).toEqual([follow.id])
    expect(lease.billingAttention).toBe(true)
    await leaseOperationHandler.onDuplicated(ctx, ['order-dup'])
    expect(em.rows(SalesOperation).filter((row) => row.subjectKey === 'duplicate_cancel:order-dup')).toHaveLength(1)
  })

  it('keeps the billing flag when the lease activates while the duplicate still waits', async () => {
    const em = new FakeEm()
    const lease = seedLease(em, { status: 'pending_order', holdToken: 'token-1', currentVersionId: null, salesOrderId: null })
    em.seed(LeaseVersion, { id: 'v1', ...scope, leaseId: lease.id, versionNo: 1, state: 'pending', holdToken: 'token-1' } as never)
    const op = seedOp(em, { id: 'op-a', kind: 'lease_order', targetType: 'lease_version', targetId: 'v1', salesDocumentId: 'order-9' })
    const { ctx } = context(em, op)
    ctx.dispatcher = unavailableDispatcher()
    await leaseOperationHandler.onDuplicated(ctx, ['order-dup'])
    expect(await leaseOperationHandler.finish(ctx)).toBe('done')
    expect(lease).toMatchObject({ status: 'active', billingAttention: true })
  })

  it('clears the flag once the duplicate is compensated', async () => {
    const em = new FakeEm()
    const lease = seedLease(em, { billingAttention: true })
    const follow = seedOp(em, { id: 'op-f', kind: 'recurrence_cancel', status: 'compensated', salesDocumentType: 'order', salesDocumentId: 'order-dup' })
    await leaseOperationHandler.onCompensated(context(em, follow).ctx)
    expect(lease.billingAttention).toBe(false)
  })
})

describe('stored billing refusal text', () => {
  it('keeps the message sales returned', async () => {
    const em = new FakeEm()
    const lease = seedLease(em)
    const op = seedOp(em, { id: 'op-r', kind: 'lease_order', status: 'refused' })
    await leaseOperationHandler.onRefused(context(em, op).ctx, refusal)
    expect(lease.lastBillingRefusal).toMatchObject({ code: 'recurring_cancel_would_credit', message: 'Would credit' })
  })

  it('stores no raw text for internal or non-sales errors', async () => {
    for (const error of [
      { kind: 'permanent', status: null, code: 'sales_status_missing', message: '[internal] Sales status "x" is not configured' },
      { kind: 'transient', status: null, code: 'ECONNREFUSED', message: 'connect ECONNREFUSED 10.0.0.12:5432' },
      { kind: 'permanent', status: 422, code: 'some_sales_code', message: '[internal] Something internal' },
    ] satisfies ClassifiedSalesError[]) {
      const em = new FakeEm()
      const lease = seedLease(em)
      const op = seedOp(em, { id: 'op-i', kind: 'lease_order', status: 'refused' })
      await leaseOperationHandler.onRefused(context(em, op).ctx, error)
      expect(lease.lastBillingRefusal).toMatchObject({ code: error.code, message: null })
    }
  })
})

describe('compensating several finished creations of a refused change', () => {
  it('compensates both creations in any order and reverts the lease after the last', async () => {
    const em = new FakeEm()
    const lease = seedLease(em, {
      endsOn: '2027-07-09',
      pendingChange: { kind: 'correction', changeId: 'change-1', previous, operationIds: ['op-1', 'op-2', 'op-3'] },
    })
    const first = seedOp(em, { id: 'op-1', kind: 'extension_order', changeId: 'change-1', sequence: 1, status: 'done', salesDocumentType: 'order', salesDocumentId: 'order-a' })
    const second = seedOp(em, { id: 'op-2', kind: 'extension_order', changeId: 'change-1', sequence: 2, status: 'done', salesDocumentType: 'order', salesDocumentId: 'order-b' })
    const cancel = seedOp(em, {
      id: 'op-3',
      kind: 'recurrence_cancel',
      changeId: 'change-1',
      sequence: 3,
      payload: { orderId: 'order-1', effectiveOn: '2026-07-01', settlement: 'keep' },
    })
    const cancelled: string[] = []
    const dispatcher = {
      readRecurrence: jest.fn(async (orderId: string) => ({ orderId, status: 'scheduled', startsOn: '2026-01-10', scheduleVersion: 1, cancelEffectiveOn: null, periods: [] })),
      cancelRecurrence: jest.fn(async (input: { orderId: string; idempotencyKey: string }) => {
        if (input.idempotencyKey === 'op-3') throw new CrudHttpError(409, { error: 'Would credit', code: 'recurring_cancel_would_credit' })
        cancelled.push(input.orderId)
        return { status: 'cancelled', cancelEffectiveOn: '2026-01-10', creditMemoIds: [] }
      }),
    } as unknown as SalesDispatcher
    const enqueued: string[] = []
    const runner = {
      container: { resolve: jest.fn() } as unknown as AwilixContainer,
      em: em as never,
      resolveHandler: () => leaseOperationHandler,
      dispatcherFactory: () => dispatcher,
      enqueuer: jest.fn(async (ids: readonly string[]) => {
        enqueued.push(...ids)
      }),
      today: () => '2026-06-01',
    }
    expect(await runSalesOperation(runner, cancel.id)).toBe('refused')
    expect(enqueued.sort()).toEqual(['op-1', 'op-2'])
    expect(await runSalesOperation(runner, second.id)).toBe('compensated')
    expect(lease.pendingChange).not.toBeNull()
    expect(await runSalesOperation(runner, first.id)).toBe('compensated')
    expect(cancelled.sort()).toEqual(['order-a', 'order-b'])
    expect([first.status, second.status]).toEqual(['compensated', 'compensated'])
    expect(lease).toMatchObject({ pendingChange: null, endsOn: '2027-01-09' })
    expect(lease.lastBillingRefusal).toMatchObject({ code: 'recurring_cancel_would_credit' })
  })
})
