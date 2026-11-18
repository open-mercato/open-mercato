/** @jest-environment node */
import type { CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import { matchFeature } from '@open-mercato/shared/lib/auth/featureMatch'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import { Booking, Building, Floor, Lease, LeaseProposal, LeaseVersion, Unit } from '../data/entities'

type AfterList = (payload: unknown, ctx: CrudCtx) => Promise<void>

const capturedAfterList: AfterList[] = []

jest.mock('@open-mercato/shared/lib/crud/factory', () => ({
  makeCrudRoute: jest.fn((config: { hooks?: { afterList?: AfterList } }) => {
    if (config.hooks?.afterList) capturedAfterList.push(config.hooks.afterList)
    const handler = jest.fn()
    return { GET: handler, POST: handler, PUT: handler, DELETE: handler }
  }),
}))

const rows = new Map<unknown, Array<Record<string, unknown>>>()
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(async (_em: unknown, entity: unknown) => rows.get(entity) ?? []),
}))

const loadSalesDocuments = jest.fn(async (_em: unknown, _scope: unknown, _kind: string, ids: string[]) =>
  new Map(ids.map((id) => [id, { id, number: `SO-${id.slice(-4)}`, statusEntryId: null }])),
)
jest.mock('../lib/salesLookups', () => ({
  loadSalesDocuments: (...args: [unknown, unknown, string, string[]]) => loadSalesDocuments(...args),
}))
jest.mock('../lib/availabilityResolver', () => ({
  ...jest.requireActual('../lib/availabilityResolver'),
  resolveUnitsAvailability: jest.fn(async () => new Map()),
}))
jest.mock('../lib/settings', () => ({ loadSettings: jest.fn(async () => ({ cancelledOrderStatusEntryId: null })) }))
jest.mock('@open-mercato/queue', () => ({ createModuleQueue: jest.fn(() => ({ enqueue: jest.fn() })) }))

import '../api/leases/route'
import '../api/bookings/route'

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const scope = { tenantId: TENANT, organizationId: ORG }
const ORDER_A = '83000000-0000-4000-8000-00000000000a'
const ORDER_B = '83000000-0000-4000-8000-00000000000b'
const now = new Date('2026-11-17T10:00:00Z')

function seed() {
  rows.clear()
  rows.set(Building, [{ id: 'building-1', ...scope, name: 'Harbor Point' }])
  rows.set(Unit, [{ id: 'unit-1', ...scope, buildingId: 'building-1', floorId: 'floor-1', name: 'Studio 2B' }])
  rows.set(Floor, [{ id: 'floor-1', ...scope, name: 'Ground' }])
  rows.set(CustomerEntity, [])
  rows.set(LeaseVersion, [])
  rows.set(LeaseProposal, [])
  rows.set(Lease, ['lease-1', 'lease-2'].map((id, index) => ({
    id,
    ...scope,
    reference: `L-${index}`,
    status: 'active',
    buildingId: 'building-1',
    unitId: 'unit-1',
    customerCompanyId: 'company-1',
    primaryContactPersonId: null,
    startsOn: '2026-01-01',
    termMonths: 12,
    endsOn: '2026-12-31',
    salesOrderId: index === 0 ? ORDER_A : ORDER_B,
    pendingChange: null,
    billingAttention: false,
    createdAt: now,
    updatedAt: now,
  })))
  rows.set(Booking, ['booking-1', 'booking-2'].map((id, index) => ({
    id,
    ...scope,
    status: 'confirmed',
    buildingId: 'building-1',
    unitId: 'unit-1',
    bookedByPersonId: 'person-1',
    customerCompanyId: null,
    customerUserId: null,
    startsAt: '2026-11-20T09:00',
    endsAt: '2026-11-20T10:00',
    catalogProductId: 'product-1',
    productName: 'Meeting room',
    unitPrice: '10.0000',
    quantity: 1,
    billingUnit: 'hour',
    totalAmount: '10.0000',
    currencyCode: 'PLN',
    cancelReason: null,
    salesOrderId: index === 0 ? ORDER_A : ORDER_B,
    createdAt: now,
    updatedAt: now,
  })))
}

function buildCtx(granted: string[]) {
  const userHasAllFeatures = jest.fn(async (_userId: string, required: string[]) =>
    required.every((feature) => granted.some((grant) => matchFeature(feature, grant))),
  )
  const ctx = {
    container: {
      resolve: (name: string) => {
        if (name === 'em') return { fork: () => ({}) }
        if (name === 'rbacService') return { userHasAllFeatures }
        throw new Error(`[internal] unexpected ${name}`)
      },
    },
    auth: { sub: 'user-1', tenantId: TENANT, orgId: ORG },
    organizationScope: null,
    selectedOrganizationId: ORG,
    organizationIds: [ORG],
  } as unknown as CrudCtx
  return { ctx, userHasAllFeatures }
}

function salesChecks(userHasAllFeatures: jest.Mock): unknown[][] {
  return userHasAllFeatures.mock.calls.filter(([, required]) => (required as string[]).some((feature) => feature.startsWith('sales.')))
}

function payloadOf(ids: string[]) {
  return { items: ids.map((id) => ({ id })) }
}

const routes = [
  { name: 'leases', index: 0, ids: ['lease-1', 'lease-2'] },
  { name: 'bookings', index: 1, ids: ['booking-1', 'booking-2'] },
]

describe('list routes gate sales order numbers on sales.orders.view', () => {
  beforeEach(() => {
    seed()
    loadSalesDocuments.mockClear()
  })

  it('registers an afterList hook for both list routes', () => {
    expect(capturedAfterList).toHaveLength(2)
  })

  it.each(routes)('$name: returns null numbers but keeps order ids without sales.orders.view', async ({ index, ids }) => {
    const { ctx, userHasAllFeatures } = buildCtx(['property_management.view'])
    const payload = payloadOf(ids)
    await capturedAfterList[index](payload, ctx)
    expect(payload.items.map((item) => (item as Record<string, unknown>).salesOrderNumber)).toEqual([null, null])
    expect(payload.items.map((item) => (item as Record<string, unknown>).salesOrderId)).toEqual([ORDER_A, ORDER_B])
    expect(salesChecks(userHasAllFeatures)).toHaveLength(1)
    expect(userHasAllFeatures).toHaveBeenCalledWith('user-1', ['sales.orders.view'], scope)
  })

  it.each(routes)('$name: returns order numbers to a caller with a sales wildcard grant', async ({ index, ids }) => {
    const { ctx, userHasAllFeatures } = buildCtx(['property_management.view', 'sales.*'])
    const payload = payloadOf(ids)
    await capturedAfterList[index](payload, ctx)
    expect(payload.items.map((item) => (item as Record<string, unknown>).salesOrderNumber)).toEqual(['SO-000a', 'SO-000b'])
    expect(payload.items.map((item) => (item as Record<string, unknown>).salesOrderId)).toEqual([ORDER_A, ORDER_B])
    expect(salesChecks(userHasAllFeatures)).toHaveLength(1)
  })

  it('does not load sales orders for the leases list when numbers are hidden', async () => {
    const { ctx } = buildCtx(['property_management.view'])
    await capturedAfterList[0](payloadOf(['lease-1', 'lease-2']), ctx)
    expect(loadSalesDocuments).toHaveBeenCalledWith(expect.anything(), scope, 'order', [])
  })

  it('skips the sales access check for an empty page', async () => {
    const { ctx, userHasAllFeatures } = buildCtx(['sales.*'])
    await capturedAfterList[1]({ items: [] }, ctx)
    expect(salesChecks(userHasAllFeatures)).toHaveLength(0)
  })
})
