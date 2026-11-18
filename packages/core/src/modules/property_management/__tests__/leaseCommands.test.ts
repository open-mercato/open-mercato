/** @jest-environment node */
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CatalogProduct } from '@open-mercato/core/modules/catalog/data/entities'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import {
  Building,
  Lease,
  LeaseProposal,
  LeaseReferenceCounter,
  LeaseVersion,
  PropertyManagementSettings,
  SalesOperation,
  Unit,
  UnitProductPeriod,
} from '../data/entities'
import { FakeEm } from './support/fakeEm'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    dict: {},
    t: (key: string) => key,
    translate: (key: string, fallback?: string) => fallback ?? key,
  }),
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => jest.requireActual('./support/fakeEm').encryptionFindMock())
jest.mock('@open-mercato/queue', () => ({ createModuleQueue: jest.fn(() => ({ enqueue: jest.fn() })) }))
jest.mock('@open-mercato/shared/lib/crud/optimistic-lock-command', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/crud/optimistic-lock-command')
  return { ...actual, enforceCommandOptimisticLockWithGuards: jest.fn(actual.enforceCommandOptimisticLockWithGuards) }
})
jest.mock('../lib/buildingAccess', () => {
  const actual = jest.requireActual('../lib/buildingAccess')
  return { ...actual, permittedBuildingIds: jest.fn(async () => null) }
})
jest.mock('../lib/leaseRecords', () => {
  const actual = jest.requireActual('../lib/leaseRecords')
  return { ...actual, lockLeaseRow: jest.fn(actual.lockLeaseRow) }
})
jest.mock('../lib/leaseEndPlan', () => {
  const actual = jest.requireActual('../lib/leaseEndPlan')
  return { ...actual, planLeaseEnd: jest.fn(actual.planLeaseEnd) }
})
jest.mock('../lib/salesRecurrence', () => {
  const actual = jest.requireActual('../lib/salesRecurrence')
  return {
    ...actual,
    readRecurrence: jest.fn(async () => null),
    defaultCancelSettlement: jest.fn(async () => 'keep'),
    isRecurrenceCancelAvailable: jest.fn(async () => true),
  }
})
jest.mock('../lib/creditPermission', () => ({ hasCreditPermission: jest.fn(async () => true) }))
jest.mock('../lib/salesOperations', () => {
  const actual = jest.requireActual('../lib/salesOperations')
  return { ...actual, enqueueSalesOperations: jest.fn(async () => undefined) }
})
jest.mock('../lib/leaseEvents', () => {
  const actual = jest.requireActual('../lib/leaseEvents')
  return { ...actual, emitLeaseEvent: jest.fn(async () => undefined), emitProposalEvent: jest.fn(async () => undefined) }
})
jest.mock('../commands/shared', () => {
  const actual = jest.requireActual('../commands/shared')
  return { ...actual, emitSideEffects: jest.fn(async () => undefined) }
})

import '../commands'
import { OPTIMISTIC_LOCK_CONFLICT_CODE, OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { lockLeaseRow } from '../lib/leaseRecords'
import { permittedBuildingIds } from '../lib/buildingAccess'
import { addDays, localToday } from '../lib/leaseTerm'
import { planLeaseEnd } from '../lib/leaseEndPlan'
import { isRecurrenceCancelAvailable, readRecurrence, type RecurrenceRead } from '../lib/salesRecurrence'
import { hasCreditPermission } from '../lib/creditPermission'
import { enqueueSalesOperations } from '../lib/salesOperations'
import { emitLeaseEvent, emitProposalEvent } from '../lib/leaseEvents'

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const scope = { tenantId: TENANT, organizationId: ORG }
const BUILDING = '70000000-0000-4000-8000-000000000001'
const UNIT = '70000000-0000-4000-8000-000000000002'
const PRODUCT = '70000000-0000-4000-8000-000000000003'
const COMPANY = '70000000-0000-4000-8000-000000000004'
const CHANNEL = '70000000-0000-4000-8000-000000000005'
const LEASE = '70000000-0000-4000-8000-000000000006'
const VERSION = '70000000-0000-4000-8000-000000000007'
const EXTENSION = '70000000-0000-4000-8000-000000000008'
const PROPOSAL = '70000000-0000-4000-8000-000000000009'

const actualLockLeaseRow = jest.requireActual('../lib/leaseRecords').lockLeaseRow as typeof lockLeaseRow
const year = new Date().getFullYear()
const NEXT = year + 1
const LAST = year - 1

function seedProperty(em: FakeEm): void {
  em.seed(Building, { id: BUILDING, ...scope, name: 'Harbor Point', status: 'active', deletedAt: null } as never)
  em.seed(Unit, { id: UNIT, ...scope, buildingId: BUILDING, floorId: 'f1', spaceId: 's1', name: 'Studio 2B', catalogProductId: PRODUCT, deletedAt: null } as never)
  em.seed(UnitProductPeriod, {
    id: 'period-1',
    ...scope,
    unitId: UNIT,
    catalogProductId: PRODUCT,
    productName: 'Private office',
    use: 'leasable',
    billingUnit: 'month',
    priceAmount: '1200.0000',
    currencyCode: 'PLN',
    validTo: null,
  } as never)
  em.seed(CatalogProduct, { id: PRODUCT, ...scope, title: 'Private office', deletedAt: null } as never)
  em.seed(CustomerEntity, { id: COMPANY, ...scope, kind: 'company', displayName: 'Solstice Analytics', deletedAt: null } as never)
  em.seed(PropertyManagementSettings, { id: 'settings-1', ...scope, billingChannelId: CHANNEL, proposalExpiryDays: 14 } as never)
  em.seed(LeaseReferenceCounter, { id: 'counter-1', ...scope, year, lastNumber: 0 } as never)
}

type LeaseSeed = { status: Lease['status']; startsOn: string; endsOn: string; termMonths: number; holdToken?: string | null }

function seedLease(em: FakeEm, lease: LeaseSeed): Lease {
  return em.seed(Lease, {
    id: LEASE,
    ...scope,
    reference: `L-${NEXT}-001`,
    buildingId: BUILDING,
    unitId: UNIT,
    customerCompanyId: COMPANY,
    primaryContactPersonId: null,
    currentVersionId: VERSION,
    salesOrderId: lease.status === 'pending_order' ? null : 'order-1',
    pendingChange: null,
    billingAttention: false,
    lastBillingRefusal: null,
    deletedAt: null,
    holdToken: null,
    ...lease,
  } as never) as unknown as Lease
}

function seedVersion(em: FakeEm, version: Partial<LeaseVersion> & { startsOn: string; endsOn: string; months: number }): LeaseVersion {
  return em.seed(LeaseVersion, {
    id: VERSION,
    ...scope,
    leaseId: LEASE,
    versionNo: 1,
    event: 'activated',
    state: 'in_force',
    catalogProductId: PRODUCT,
    productName: 'Private office',
    monthlyRate: '1200.0000',
    currencyCode: 'PLN',
    salesOrderId: 'order-1',
    holdToken: null,
    effectiveFrom: version.startsOn,
    ...version,
  } as never) as unknown as LeaseVersion
}

function seedActiveLease(em: FakeEm): Lease {
  seedProperty(em)
  seedVersion(em, { startsOn: `${NEXT}-01-01`, endsOn: `${NEXT}-12-31`, months: 12 })
  return seedLease(em, { status: 'active', startsOn: `${NEXT}-01-01`, endsOn: `${NEXT}-12-31`, termMonths: 12 })
}

function seedPendingOrderLease(em: FakeEm): { lease: Lease; version: LeaseVersion } {
  seedProperty(em)
  const version = seedVersion(em, { startsOn: `${NEXT}-01-01`, endsOn: `${NEXT}-12-31`, months: 12, state: 'pending', salesOrderId: null, holdToken: 'token-1' })
  const lease = seedLease(em, { status: 'pending_order', startsOn: `${NEXT}-01-01`, endsOn: `${NEXT}-12-31`, termMonths: 12, holdToken: 'token-1' })
  return { lease, version }
}

type CtxOptions = { request?: Request; systemActor?: boolean }

function buildCtx(em: FakeEm, options: CtxOptions = {}): CommandRuntimeContext {
  return {
    container: {
      resolve: (name: string) => {
        if (name === 'em') return em
        throw new Error(`[internal] unexpected ${name}`)
      },
    } as never,
    auth: options.systemActor ? null : ({ sub: 'user-1', tenantId: TENANT, orgId: ORG } as never),
    ...(options.systemActor ? { systemActor: true } : {}),
    organizationScope: null,
    selectedOrganizationId: ORG,
    organizationIds: [ORG],
    ...(options.request ? { request: options.request } : {}),
  }
}

async function run<T>(em: FakeEm, commandId: string, input: Record<string, unknown>, options: CtxOptions = {}): Promise<T> {
  const handler = commandRegistry.get(commandId)
  if (!handler) throw new Error(`[internal] missing ${commandId}`)
  return handler.execute({ ...scope, ...input }, buildCtx(em, options)) as Promise<T>
}

function lockedRequest(updatedAt: Date): Request {
  return new Request('http://localhost/api/property_management/leases', { headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: updatedAt.toISOString() } })
}

async function expectHttpError(promise: Promise<unknown>, status: number, code?: string): Promise<void> {
  try {
    await promise
  } catch (err) {
    expect(err).toBeInstanceOf(CrudHttpError)
    expect((err as CrudHttpError).status).toBe(status)
    if (code) expect((err as CrudHttpError).body).toMatchObject({ code })
    return
  }
  throw new Error('[internal] expected the command to fail')
}

function operations(em: FakeEm): SalesOperation[] {
  return em.rows(SalesOperation) as unknown as SalesOperation[]
}

function invoicedRecurrence(): RecurrenceRead {
  return {
    orderId: 'order-1',
    status: 'active',
    startsOn: `${NEXT}-01-01`,
    periodCount: 12,
    endsOn: `${NEXT}-12-31`,
    nextPeriodIndex: 1,
    nextInvoiceOn: `${NEXT}-02-01`,
    scheduleVersion: 1,
    cancelEffectiveOn: null,
    cancelSettlement: null,
    invoicesAvailable: true,
    periods: [],
  } as unknown as RecurrenceRead
}

beforeEach(() => jest.clearAllMocks())

describe('property_management.lease.create', () => {
  it('holds the unit as pending_order and records the lease order operation with the hold token', async () => {
    const em = new FakeEm()
    seedProperty(em)
    const result = await run<{ leaseId: string; status: string; operationId: string; proposalId: string | null }>(em, 'property_management.lease.create', {
      unitId: UNIT,
      customerCompanyId: COMPANY,
      startsOn: `${NEXT}-01-01`,
      termMonths: 12,
      monthlyRate: 1200,
    })
    const lease = em.rows(Lease)[0] as unknown as Lease
    const version = em.rows(LeaseVersion)[0] as unknown as LeaseVersion
    const [operation] = operations(em)
    expect(result).toMatchObject({ leaseId: lease.id, status: 'pending_order', proposalId: null, operationId: operation.id })
    expect(lease).toMatchObject({ status: 'pending_order', startsOn: `${NEXT}-01-01`, endsOn: `${NEXT}-12-31`, termMonths: 12, reference: `L-${year}-001` })
    expect(version).toMatchObject({ state: 'pending', event: 'activated', monthlyRate: '1200', holdToken: lease.holdToken })
    expect(operation).toMatchObject({ kind: 'lease_order', subjectKey: `lease_order:${version.id}`, targetId: version.id, leaseId: lease.id, token: lease.holdToken })
    expect(em.rows(LeaseProposal)).toHaveLength(0)
    expect(enqueueSalesOperations).toHaveBeenCalledWith([operation.id])
  })

  it('persists the normalized rate string and sends exactly that string to sales', async () => {
    const em = new FakeEm()
    seedProperty(em)
    await run(em, 'property_management.lease.propose', {
      unitId: UNIT,
      customerCompanyId: COMPANY,
      startsOn: `${NEXT}-03-01`,
      termMonths: 6,
      monthlyRate: '1234.5670',
    })
    const version = em.rows(LeaseVersion)[0] as unknown as LeaseVersion
    const proposal = em.rows(LeaseProposal)[0] as unknown as LeaseProposal
    const payload = operations(em)[0].payload as { lines: Array<{ unitPriceNet: string }> }
    expect(version.monthlyRate).toBe('1234.567')
    expect(proposal.monthlyRate).toBe('1234.567')
    expect(payload.lines[0].unitPriceNet).toBe(version.monthlyRate)
  })

  it('refuses a rate with more than four decimal places before holding the unit', async () => {
    const em = new FakeEm()
    seedProperty(em)
    await expect(
      run(em, 'property_management.lease.create', { unitId: UNIT, customerCompanyId: COMPANY, startsOn: `${NEXT}-03-01`, termMonths: 6, monthlyRate: 2.00005 }),
    ).rejects.toThrow()
    expect(em.rows(Lease)).toHaveLength(0)
  })

  it('records a sending proposal and its quote operation for a proposed lease', async () => {
    const em = new FakeEm()
    seedProperty(em)
    const result = await run<{ status: string; proposalId: string | null }>(em, 'property_management.lease.propose', {
      unitId: UNIT,
      customerCompanyId: COMPANY,
      startsOn: `${NEXT}-03-01`,
      termMonths: 6,
      monthlyRate: 1200,
    })
    const lease = em.rows(Lease)[0] as unknown as Lease
    const proposal = em.rows(LeaseProposal)[0] as unknown as LeaseProposal
    expect(result).toMatchObject({ status: 'sending', proposalId: proposal.id })
    expect(lease).toMatchObject({ status: 'proposed', holdToken: null })
    expect(proposal).toMatchObject({ status: 'sending', kind: 'new', respondBy: expect.any(String) })
    expect(operations(em)[0]).toMatchObject({ kind: 'quote', subjectKey: `quote:${proposal.id}`, token: proposal.holdToken })
  })

  it('refuses a term overlapping another lease of the unit', async () => {
    const em = new FakeEm()
    seedActiveLease(em)
    await expectHttpError(
      run(em, 'property_management.lease.create', { unitId: UNIT, customerCompanyId: COMPANY, startsOn: `${NEXT}-06-01`, termMonths: 12, monthlyRate: 1200 }),
      409,
      'lease_overlap',
    )
    expect(em.rows(Lease)).toHaveLength(1)
    expect(operations(em)).toHaveLength(0)
  })

  it('refuses a lease until the billing channel is configured', async () => {
    const em = new FakeEm()
    seedProperty(em)
    ;(em.rows(PropertyManagementSettings)[0] as unknown as PropertyManagementSettings).billingChannelId = null
    await expectHttpError(
      run(em, 'property_management.lease.create', { unitId: UNIT, customerCompanyId: COMPANY, startsOn: `${NEXT}-03-01`, termMonths: 12, monthlyRate: 1200 }),
      422,
      'billing_channel_missing',
    )
    expect(em.rows(Lease)).toHaveLength(0)
  })
})

describe('property_management.lease.end', () => {
  it('records a pending end with one cancellation per order and withdraws the extension in flight', async () => {
    const em = new FakeEm()
    const lease = seedActiveLease(em)
    const extension = seedVersion(em, {
      id: EXTENSION,
      versionNo: 2,
      event: 'extended',
      state: 'pending',
      salesOrderId: null,
      holdToken: 'token-ext',
      startsOn: `${NEXT + 1}-01-01`,
      endsOn: `${NEXT + 1}-06-30`,
      months: 6,
    })
    em.seed(LeaseProposal, { id: PROPOSAL, ...scope, leaseId: LEASE, kind: 'extension', status: 'sent', salesQuoteId: 'quote-1', holdToken: null } as never)
    const result = await run<{ changeId: string | null; pending: boolean }>(em, 'property_management.lease.end', { id: LEASE, endsOn: `${NEXT}-06-30` })
    expect(result.pending).toBe(true)
    const cancel = operations(em).find((op) => op.kind === 'recurrence_cancel')
    const quoteStatus = operations(em).find((op) => op.kind === 'quote_status')
    expect(cancel).toMatchObject({
      changeId: result.changeId,
      sequence: 1,
      allowCredit: true,
      payload: { orderId: 'order-1', effectiveOn: `${NEXT}-07-01`, settlement: 'keep' },
    })
    expect(lease).toMatchObject({ endsOn: `${NEXT}-06-30`, status: 'active' })
    expect(lease.pendingChange).toMatchObject({ kind: 'end', changeId: result.changeId, previous: { endsOn: `${NEXT}-12-31` }, operationIds: [cancel?.id] })
    expect(extension.holdToken).toBeNull()
    expect(em.rows(LeaseProposal)[0]).toMatchObject({ status: 'withdrawn' })
    expect(enqueueSalesOperations).toHaveBeenCalledWith([quoteStatus?.id, cancel?.id])
    expect(emitProposalEvent).toHaveBeenCalledTimes(1)
    expect(emitProposalEvent).toHaveBeenCalledWith('property_management.lease_proposal.withdrawn', em.rows(LeaseProposal)[0])
  })

  it('refuses an active lease whose term is already over', async () => {
    const em = new FakeEm()
    seedProperty(em)
    seedVersion(em, { startsOn: `${LAST}-01-01`, endsOn: `${LAST}-12-31`, months: 12 })
    seedLease(em, { status: 'active', startsOn: `${LAST}-01-01`, endsOn: `${LAST}-12-31`, termMonths: 12 })
    await expectHttpError(run(em, 'property_management.lease.end', { id: LEASE, endsOn: `${LAST}-06-30` }), 409, 'lease_already_ended')
    expect(operations(em)).toHaveLength(0)
  })

  it('refuses an end later than the current one', async () => {
    const em = new FakeEm()
    seedActiveLease(em)
    await expectHttpError(run(em, 'property_management.lease.end', { id: LEASE, endsOn: `${NEXT + 1}-03-31` }), 409, 'lease_end_later_than_current')
  })

  it('needs the credit permission when the cancellation would credit an invoice', async () => {
    const em = new FakeEm()
    seedActiveLease(em)
    jest.mocked(hasCreditPermission).mockResolvedValueOnce(false)
    jest.mocked(planLeaseEnd).mockResolvedValueOnce({ entries: [], wouldCredit: true })
    await expectHttpError(run(em, 'property_management.lease.end', { id: LEASE, endsOn: `${NEXT}-06-30`, settlement: 'prorate' }), 403, 'credit_permission_required')
    expect(operations(em)).toHaveLength(0)
  })

  it('refuses when the lease end moved between the pre-check and the lock', async () => {
    const em = new FakeEm()
    const lease = seedActiveLease(em)
    jest.mocked(lockLeaseRow).mockImplementationOnce(async (trx, lockScope, leaseId) => {
      const locked = await actualLockLeaseRow(trx, lockScope, leaseId)
      return Object.assign(Object.create(Object.getPrototypeOf(locked)), locked, { endsOn: `${NEXT}-09-30` })
    })
    await expectHttpError(run(em, 'property_management.lease.end', { id: LEASE, endsOn: `${NEXT}-06-30` }), 409, 'lease_changed')
    expect(lease.pendingChange).toBeNull()
    expect(operations(em)).toHaveLength(0)
  })

  it('ends at once without sales work when no order reaches past a past end', async () => {
    const em = new FakeEm()
    seedProperty(em)
    seedVersion(em, { startsOn: `${LAST}-01-01`, endsOn: `${NEXT}-12-31`, months: 36 })
    const lease = seedLease(em, { status: 'active', startsOn: `${LAST}-01-01`, endsOn: `${NEXT}-12-31`, termMonths: 36 })
    jest.mocked(planLeaseEnd).mockResolvedValueOnce({ entries: [], wouldCredit: false })
    const result = await run<{ pending: boolean }>(em, 'property_management.lease.end', { id: LEASE, endsOn: `${LAST}-12-31` })
    expect(result.pending).toBe(false)
    expect(lease).toMatchObject({ status: 'ended', endsOn: `${LAST}-12-31`, pendingChange: null })
    expect(emitLeaseEvent).toHaveBeenCalledWith('property_management.lease.ended', lease)
  })
})

describe('property_management.lease.delete', () => {
  it('soft-deletes a lease still waiting for its order and releases its hold', async () => {
    const em = new FakeEm()
    const { lease } = seedPendingOrderLease(em)
    const result = await run<{ pending: boolean; changeId: string | null }>(em, 'property_management.lease.delete', { id: LEASE })
    expect(result).toMatchObject({ pending: false, changeId: null })
    expect(lease.deletedAt).toBeInstanceOf(Date)
    expect(lease.holdToken).toBeNull()
    expect(lease.pendingChange).toBeNull()
    expect(operations(em)).toHaveLength(0)
  })

  it('cancels every billed order from its start with a full credit', async () => {
    const em = new FakeEm()
    const lease = seedActiveLease(em)
    const result = await run<{ pending: boolean; changeId: string | null }>(em, 'property_management.lease.delete', { id: LEASE })
    const [cancel] = operations(em)
    expect(result.pending).toBe(true)
    expect(cancel).toMatchObject({
      kind: 'recurrence_cancel',
      subjectKey: `recurrence_cancel:order-1:${result.changeId}`,
      allowCredit: true,
      payload: { orderId: 'order-1', effectiveOn: `${NEXT}-01-01`, settlement: 'credit_full' },
    })
    expect(lease.pendingChange).toMatchObject({ kind: 'delete', operationIds: [cancel.id] })
    expect(lease.deletedAt).toBeInstanceOf(Date)
    expect(enqueueSalesOperations).toHaveBeenCalledWith([cancel.id])
    expect(emitProposalEvent).not.toHaveBeenCalled()
  })

  it('withdraws every open proposal of the deleted lease and emits lease_proposal.withdrawn for each', async () => {
    const em = new FakeEm()
    seedActiveLease(em)
    em.seed(LeaseProposal, { id: PROPOSAL, ...scope, leaseId: LEASE, kind: 'extension', status: 'sent', salesQuoteId: 'quote-1', holdToken: null } as never)
    await run(em, 'property_management.lease.delete', { id: LEASE })
    const [proposal] = em.rows(LeaseProposal)
    expect(proposal).toMatchObject({ status: 'withdrawn' })
    expect(emitProposalEvent).toHaveBeenCalledTimes(1)
    expect(emitProposalEvent).toHaveBeenCalledWith('property_management.lease_proposal.withdrawn', proposal)
  })

  it('refuses a lease that has been invoiced', async () => {
    const em = new FakeEm()
    const lease = seedActiveLease(em)
    jest.mocked(readRecurrence).mockResolvedValueOnce(invoicedRecurrence())
    await expectHttpError(run(em, 'property_management.lease.delete', { id: LEASE }), 409, 'lease_invoiced')
    expect(lease.deletedAt).toBeNull()
    expect(operations(em)).toHaveLength(0)
  })

  it('records the cancellation without credit for a caller without the credit memo permission', async () => {
    const em = new FakeEm()
    seedActiveLease(em)
    jest.mocked(hasCreditPermission).mockResolvedValueOnce(false)
    await run(em, 'property_management.lease.delete', { id: LEASE })
    const [cancel] = operations(em)
    expect(cancel).toMatchObject({ kind: 'recurrence_cancel', allowCredit: false, payload: expect.objectContaining({ settlement: 'credit_full' }) })
  })

  it('repeats the invoice check on the locking transaction, not on the outer entity manager', async () => {
    const em = new FakeEm()
    seedActiveLease(em)
    const trx = new Proxy(em, {})
    jest.spyOn(em, 'transactional').mockImplementation(async (callback) => callback(trx))
    await run(em, 'property_management.lease.delete', { id: LEASE })
    const calls = jest.mocked(readRecurrence).mock.calls
    expect(calls.length).toBeGreaterThanOrEqual(2)
    expect(calls[calls.length - 1][0]).toBe(trx)
  })

  it('refuses a lease invoiced between the pre-check and the lock', async () => {
    const em = new FakeEm()
    const lease = seedActiveLease(em)
    jest.mocked(readRecurrence).mockResolvedValueOnce(null).mockResolvedValueOnce(invoicedRecurrence())
    await expectHttpError(run(em, 'property_management.lease.delete', { id: LEASE }), 409, 'lease_invoiced')
    expect(lease.deletedAt).toBeNull()
    expect(lease.pendingChange).toBeNull()
    expect(operations(em)).toHaveLength(0)
  })

  it('refuses when the activation finishes between the pre-check and the lock', async () => {
    const em = new FakeEm()
    const { lease, version } = seedPendingOrderLease(em)
    jest.mocked(lockLeaseRow).mockImplementationOnce(async (trx, lockScope, leaseId) => {
      version.state = 'in_force'
      version.salesOrderId = 'order-1'
      version.holdToken = null
      lease.status = 'active'
      lease.salesOrderId = 'order-1'
      lease.holdToken = null
      return actualLockLeaseRow(trx, lockScope, leaseId)
    })
    await expectHttpError(run(em, 'property_management.lease.delete', { id: LEASE }), 409, 'lease_changed')
    expect(lease.deletedAt).toBeNull()
    expect(lease.status).toBe('active')
    expect(operations(em)).toHaveLength(0)
  })

  it('cancels the order once retried after the activation finished', async () => {
    const em = new FakeEm()
    const { lease, version } = seedPendingOrderLease(em)
    version.state = 'in_force'
    version.salesOrderId = 'order-1'
    version.holdToken = null
    lease.status = 'active'
    lease.holdToken = null
    const result = await run<{ pending: boolean }>(em, 'property_management.lease.delete', { id: LEASE })
    expect(result.pending).toBe(true)
    expect(operations(em)).toEqual([expect.objectContaining({ kind: 'recurrence_cancel', payload: expect.objectContaining({ orderId: 'order-1' }) })])
  })
})

describe('lease end and delete while sales cannot cancel recurrences', () => {
  beforeEach(() => jest.mocked(isRecurrenceCancelAvailable).mockResolvedValue(false))
  afterEach(() => jest.mocked(isRecurrenceCancelAvailable).mockResolvedValue(true))

  it('refuses an early end that needs a recurrence cancellation', async () => {
    const em = new FakeEm()
    const lease = seedActiveLease(em)
    await expectHttpError(run(em, 'property_management.lease.end', { id: LEASE, endsOn: `${NEXT}-06-30` }), 409, 'lease_billing_cancel_unavailable')
    expect(lease).toMatchObject({ endsOn: `${NEXT}-12-31`, pendingChange: null })
    expect(operations(em)).toHaveLength(0)
  })

  it('still ends a lease that needs no cancellation', async () => {
    const em = new FakeEm()
    seedProperty(em)
    seedVersion(em, { startsOn: `${LAST}-01-01`, endsOn: `${NEXT}-12-31`, months: 36 })
    const lease = seedLease(em, { status: 'active', startsOn: `${LAST}-01-01`, endsOn: `${NEXT}-12-31`, termMonths: 36 })
    jest.mocked(planLeaseEnd).mockResolvedValueOnce({ entries: [], wouldCredit: false })
    const result = await run<{ pending: boolean }>(em, 'property_management.lease.end', { id: LEASE, endsOn: `${LAST}-12-31` })
    expect(result.pending).toBe(false)
    expect(lease.status).toBe('ended')
  })

  it('refuses an end that would release a direct extension whose order is being created', async () => {
    const em = new FakeEm()
    seedActiveLease(em)
    seedVersion(em, { id: EXTENSION, versionNo: 2, event: 'extended', state: 'pending', salesOrderId: null, holdToken: 'token-ext', startsOn: `${NEXT + 1}-01-01`, endsOn: `${NEXT + 1}-06-30`, months: 6 })
    em.seed(SalesOperation, { id: 'op-ext', ...scope, kind: 'extension_order', status: 'pending', leaseId: LEASE, targetId: EXTENSION } as never)
    jest.mocked(planLeaseEnd).mockResolvedValueOnce({ entries: [], wouldCredit: false })
    await expectHttpError(run(em, 'property_management.lease.end', { id: LEASE, endsOn: `${NEXT}-12-31` }), 409, 'lease_billing_cancel_unavailable')
  })

  it('refuses to delete a lease with a sales order', async () => {
    const em = new FakeEm()
    const lease = seedActiveLease(em)
    await expectHttpError(run(em, 'property_management.lease.delete', { id: LEASE }), 409, 'lease_billing_cancel_unavailable')
    expect(lease.deletedAt).toBeNull()
    expect(operations(em)).toHaveLength(0)
  })

  it('deletes a lease whose order was never requested', async () => {
    const em = new FakeEm()
    const { lease } = seedPendingOrderLease(em)
    const result = await run<{ pending: boolean }>(em, 'property_management.lease.delete', { id: LEASE })
    expect(result.pending).toBe(false)
    expect(lease.deletedAt).toBeInstanceOf(Date)
  })

  it('refuses to delete a lease whose order is still being created', async () => {
    const em = new FakeEm()
    const { lease } = seedPendingOrderLease(em)
    em.seed(SalesOperation, { id: 'op-order', ...scope, kind: 'lease_order', status: 'pending', leaseId: LEASE, targetId: VERSION } as never)
    await expectHttpError(run(em, 'property_management.lease.delete', { id: LEASE }), 409, 'lease_billing_cancel_unavailable')
    expect(lease.deletedAt).toBeNull()
  })
})

describe('property_management.lease.delete after an early end', () => {
  it('does not cancel again an order already cut from its start', async () => {
    const em = new FakeEm()
    const lease = seedActiveLease(em)
    jest.mocked(readRecurrence).mockResolvedValueOnce({
      ...invoicedRecurrence(),
      status: 'cancelled',
      nextPeriodIndex: 0,
      cancelEffectiveOn: `${NEXT}-01-01`,
    } as RecurrenceRead)
    const result = await run<{ pending: boolean; changeId: string | null }>(em, 'property_management.lease.delete', { id: LEASE })
    expect(result).toMatchObject({ pending: false, changeId: null })
    expect(lease.deletedAt).toBeInstanceOf(Date)
    expect(lease.pendingChange).toBeNull()
    expect(operations(em)).toHaveLength(0)
  })

  it('still cancels an order whose cutoff is after its start', async () => {
    const em = new FakeEm()
    seedActiveLease(em)
    jest.mocked(readRecurrence).mockResolvedValueOnce({
      ...invoicedRecurrence(),
      status: 'cancelling',
      nextPeriodIndex: 0,
      cancelEffectiveOn: `${NEXT}-07-01`,
    } as RecurrenceRead)
    const result = await run<{ pending: boolean }>(em, 'property_management.lease.delete', { id: LEASE })
    expect(result.pending).toBe(true)
    expect(operations(em)).toEqual([expect.objectContaining({ kind: 'recurrence_cancel', payload: expect.objectContaining({ effectiveOn: `${NEXT}-01-01` }) })])
  })
})

describe('property_management.lease.update', () => {
  const FOREIGN_BUILDING = '70000000-0000-4000-8000-0000000000fe'

  function updateHandler() {
    const handler = commandRegistry.get('property_management.lease.update')
    if (!handler) throw new Error('[internal] missing property_management.lease.update')
    return handler
  }

  it('hides a lease of a building not assigned to the caller on a no-op update', async () => {
    const em = new FakeEm()
    seedActiveLease(em)
    jest.mocked(permittedBuildingIds).mockResolvedValue([FOREIGN_BUILDING])
    try {
      await expectHttpError(run(em, 'property_management.lease.update', { id: LEASE }), 404)
    } finally {
      jest.mocked(permittedBuildingIds).mockResolvedValue(null)
    }
  })

  it('takes no snapshot and writes no action log for a no-op update', async () => {
    const em = new FakeEm()
    seedActiveLease(em)
    const handler = updateHandler()
    const ctx = buildCtx(em)
    const input = { ...scope, id: LEASE }
    expect(await handler.prepare?.(input, ctx)).toEqual({})
    const result = await handler.execute(input, ctx)
    expect(result).toEqual({ leaseId: LEASE })
    expect(await handler.captureAfter?.(input, result, ctx)).toBeUndefined()
    expect(await handler.buildLog?.({ input, result, ctx, snapshots: {} })).toEqual({ skipLog: true })
  })

  it('snapshots nothing of a lease in a building not assigned to the caller', async () => {
    const em = new FakeEm()
    seedActiveLease(em)
    jest.mocked(permittedBuildingIds).mockResolvedValue([FOREIGN_BUILDING])
    try {
      const input = { ...scope, id: LEASE, primaryContactPersonId: null }
      expect(await updateHandler().prepare?.(input, buildCtx(em))).toEqual({})
      expect(await updateHandler().captureAfter?.(input, { leaseId: LEASE }, buildCtx(em))).toBeNull()
    } finally {
      jest.mocked(permittedBuildingIds).mockResolvedValue(null)
    }
  })
})

describe('property_management.lease.extend', () => {
  it('refuses to extend an active lease whose term is already over', async () => {
    const em = new FakeEm()
    seedProperty(em)
    seedVersion(em, { startsOn: `${LAST}-01-01`, endsOn: `${LAST}-12-31`, months: 12 })
    seedLease(em, { status: 'active', startsOn: `${LAST}-01-01`, endsOn: `${LAST}-12-31`, termMonths: 12 })
    await expectHttpError(run(em, 'property_management.lease.extend', { id: LEASE, months: 3, monthlyRate: 1200 }), 409, 'lease_already_ended')
    expect(em.rows(LeaseVersion)).toHaveLength(1)
    expect(operations(em)).toHaveLength(0)
  })
})

describe('lease writes racing a direct extension', () => {
  const LOADED_AT = new Date('2026-01-01T00:00:00.000Z')

  function seedLoadedLease(em: FakeEm): Lease {
    const lease = seedActiveLease(em)
    lease.updatedAt = LOADED_AT
    return lease
  }

  function extendDuringLock(em: FakeEm): void {
    jest.mocked(lockLeaseRow).mockImplementationOnce(async (trx, lockScope, leaseId) => {
      await run(em, 'property_management.lease.extend', { id: LEASE, months: 6, monthlyRate: 1200 })
      return actualLockLeaseRow(trx, lockScope, leaseId)
    })
  }

  function pendingExtension(em: FakeEm): LeaseVersion | undefined {
    return (em.rows(LeaseVersion) as unknown as LeaseVersion[]).find((version) => version.event === 'extended')
  }

  it('refuses an end loaded before the extension committed and keeps the extension hold', async () => {
    const em = new FakeEm()
    const lease = seedLoadedLease(em)
    extendDuringLock(em)
    await expectHttpError(
      run(em, 'property_management.lease.end', { id: LEASE, endsOn: `${NEXT}-06-30` }, { request: lockedRequest(LOADED_AT) }),
      409,
      OPTIMISTIC_LOCK_CONFLICT_CODE,
    )
    expect(pendingExtension(em)).toMatchObject({ state: 'pending', holdToken: expect.any(String) })
    expect(lease).toMatchObject({ endsOn: `${NEXT}-12-31`, pendingChange: null })
    expect(operations(em).map((op) => op.kind)).toEqual(['extension_order'])
  })

  it('refuses a delete loaded before the extension committed and keeps the lease', async () => {
    const em = new FakeEm()
    const lease = seedLoadedLease(em)
    extendDuringLock(em)
    await expectHttpError(run(em, 'property_management.lease.delete', { id: LEASE }, { request: lockedRequest(LOADED_AT) }), 409, OPTIMISTIC_LOCK_CONFLICT_CODE)
    expect(pendingExtension(em)).toMatchObject({ state: 'pending', holdToken: expect.any(String) })
    expect(lease.deletedAt).toBeNull()
    expect(operations(em).map((op) => op.kind)).toEqual(['extension_order'])
  })

  it('refuses a second extension loaded before the first one committed', async () => {
    const em = new FakeEm()
    seedLoadedLease(em)
    extendDuringLock(em)
    await expectHttpError(
      run(em, 'property_management.lease.extend', { id: LEASE, months: 3, monthlyRate: 1200 }, { request: lockedRequest(LOADED_AT) }),
      409,
      OPTIMISTIC_LOCK_CONFLICT_CODE,
    )
    expect(em.rows(LeaseVersion).filter((version) => version.event === 'extended')).toHaveLength(1)
  })

  it('still ends a lease whose version matches the one the caller loaded', async () => {
    const em = new FakeEm()
    seedLoadedLease(em)
    const result = await run<{ pending: boolean }>(em, 'property_management.lease.end', { id: LEASE, endsOn: `${NEXT}-06-30` }, { request: lockedRequest(LOADED_AT) })
    expect(result.pending).toBe(true)
  })
})

describe('lease proposal commands', () => {
  const OTHER_BUILDING = '70000000-0000-4000-8000-0000000000ff'
  const LOADED_AT = new Date('2026-01-01T00:00:00.000Z')

  function seedProposal(em: FakeEm, proposal: Partial<LeaseProposal> = {}): LeaseProposal {
    const lease = seedActiveLease(em)
    lease.updatedAt = LOADED_AT
    seedVersion(em, { id: EXTENSION, versionNo: 2, event: 'extended', state: 'pending', salesOrderId: null, holdToken: null, startsOn: `${NEXT + 1}-01-01`, endsOn: `${NEXT + 1}-06-30`, months: 6 })
    return em.seed(LeaseProposal, {
      id: PROPOSAL,
      ...scope,
      leaseId: LEASE,
      versionId: EXTENSION,
      kind: 'extension',
      status: 'sent',
      salesQuoteId: 'quote-1',
      holdToken: 'token-proposal',
      respondBy: addDays(localToday(), 10),
      remindedAt: null,
      ...proposal,
    } as never) as unknown as LeaseProposal
  }

  it('withdraws an open proposal, reverts its version and cancels the quote', async () => {
    const em = new FakeEm()
    const proposal = seedProposal(em)
    const result = await run<{ status: string; changed: boolean }>(
      em,
      'property_management.lease_proposal.withdraw',
      { id: PROPOSAL, leaseId: LEASE },
      { request: lockedRequest(LOADED_AT) },
    )
    expect(result).toMatchObject({ status: 'withdrawn', changed: true })
    expect(proposal).toMatchObject({ status: 'withdrawn', holdToken: null })
    expect(em.rows(LeaseVersion).find((version) => version.id === EXTENSION)).toMatchObject({ state: 'reverted' })
    const [quoteStatus] = operations(em)
    expect(quoteStatus).toMatchObject({ kind: 'quote_status', payload: { quoteId: 'quote-1', status: 'canceled' } })
    expect(enqueueSalesOperations).toHaveBeenCalledWith([quoteStatus.id])
    expect(emitProposalEvent).toHaveBeenCalledWith('property_management.lease_proposal.withdrawn', proposal)
  })

  it('refuses a withdraw from a page loaded before the lease changed', async () => {
    const em = new FakeEm()
    const proposal = seedProposal(em)
    await expectHttpError(
      run(em, 'property_management.lease_proposal.withdraw', { id: PROPOSAL, leaseId: LEASE }, { request: lockedRequest(new Date('2025-12-31T00:00:00.000Z')) }),
      409,
      OPTIMISTIC_LOCK_CONFLICT_CODE,
    )
    expect(proposal).toMatchObject({ status: 'sent', holdToken: 'token-proposal' })
    expect(operations(em)).toHaveLength(0)
    expect(emitProposalEvent).not.toHaveBeenCalled()
  })

  it('refuses a withdraw when the lease changed between the pre-check and the lock', async () => {
    const em = new FakeEm()
    const proposal = seedProposal(em)
    jest.mocked(lockLeaseRow).mockImplementationOnce(async (trx, lockScope, leaseId) => {
      const locked = await actualLockLeaseRow(trx, lockScope, leaseId)
      locked.updatedAt = new Date('2026-02-01T00:00:00.000Z')
      return locked
    })
    await expectHttpError(
      run(em, 'property_management.lease_proposal.withdraw', { id: PROPOSAL, leaseId: LEASE }, { request: lockedRequest(LOADED_AT) }),
      409,
      OPTIMISTIC_LOCK_CONFLICT_CODE,
    )
    expect(proposal.status).toBe('sent')
  })

  it('refuses to withdraw a proposal that is no longer open', async () => {
    const em = new FakeEm()
    seedProposal(em, { status: 'accepted' } as Partial<LeaseProposal>)
    await expectHttpError(run(em, 'property_management.lease_proposal.withdraw', { id: PROPOSAL, leaseId: LEASE }), 409, 'proposal_not_open')
  })

  it('hides a proposal of a building not assigned to the caller from withdraw', async () => {
    const em = new FakeEm()
    const proposal = seedProposal(em)
    jest.mocked(permittedBuildingIds).mockResolvedValueOnce([OTHER_BUILDING])
    await expectHttpError(run(em, 'property_management.lease_proposal.withdraw', { id: PROPOSAL, leaseId: LEASE }), 404)
    expect(proposal.status).toBe('sent')
  })

  it('expires a proposal past its respond-by date from the sweep', async () => {
    const em = new FakeEm()
    const proposal = seedProposal(em, { respondBy: addDays(localToday(), -1) })
    jest.mocked(permittedBuildingIds).mockImplementationOnce(jest.requireActual('../lib/buildingAccess').permittedBuildingIds)
    const result = await run<{ status: string; changed: boolean }>(em, 'property_management.lease_proposal.expire', { id: PROPOSAL }, { systemActor: true })
    expect(result).toMatchObject({ status: 'expired', changed: true })
    expect(proposal).toMatchObject({ status: 'expired', holdToken: null })
    expect(emitProposalEvent).toHaveBeenCalledWith('property_management.lease_proposal.expired', proposal)
  })

  it('leaves a proposal still within its respond-by date open', async () => {
    const em = new FakeEm()
    const proposal = seedProposal(em)
    const result = await run<{ changed: boolean }>(em, 'property_management.lease_proposal.expire', { id: PROPOSAL }, { systemActor: true })
    expect(result.changed).toBe(false)
    expect(proposal.status).toBe('sent')
    expect(emitProposalEvent).not.toHaveBeenCalled()
  })

  it('hides a proposal of a building not assigned to a staff caller from expire', async () => {
    const em = new FakeEm()
    const proposal = seedProposal(em, { respondBy: addDays(localToday(), -1) })
    jest.mocked(permittedBuildingIds).mockResolvedValueOnce([OTHER_BUILDING])
    await expectHttpError(run(em, 'property_management.lease_proposal.expire', { id: PROPOSAL }), 404)
    expect(proposal.status).toBe('sent')
  })

  it('registers no proposal reminder command, so nothing marks a proposal reminded before the portal notification is sent', () => {
    expect(commandRegistry.get('property_management.lease_proposal.remind')).toBeFalsy()
  })
})
