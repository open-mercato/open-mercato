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
import type { OperationRunContext } from '../lib/salesOperationRunner'
import type { SalesDispatcher } from '../lib/salesDispatcher'
import type { ClassifiedSalesError } from '../lib/salesErrors'
import { notifyStaff } from '../lib/staffNotifications'
import { emitLeaseEvent, emitProposalEvent } from '../lib/leaseEvents'

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

  it('never reverts a delete', async () => {
    const em = new FakeEm()
    const lease = seedLease(em, {
      deletedAt: new Date(),
      pendingChange: { kind: 'delete', changeId: 'change-1', previous, operationIds: ['op-1'] },
    })
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
    expect(lease.lastBillingRefusal).toMatchObject({ kind: 'activation' })
  })

  it('alerts staff once when compensation keeps failing', async () => {
    const em = new FakeEm()
    const lease = seedLease(em)
    const op = seedOp(em, { id: 'op-c', kind: 'lease_order', status: 'compensating', attempts: 1 })
    const { ctx, runPostCommit } = context(em, op)
    await leaseOperationHandler.onCompensationFailed(ctx, refusal)
    await runPostCommit()
    expect(lease.billingAttention).toBe(true)
    expect(notifyStaff).toHaveBeenCalledWith(expect.objectContaining({ type: 'property_management.lease.order_orphaned' }))
    op.attempts = 2
    jest.clearAllMocks()
    const second = context(em, op)
    await leaseOperationHandler.onCompensationFailed(second.ctx, refusal)
    await second.runPostCommit()
    expect(notifyStaff).not.toHaveBeenCalled()
  })
})
