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
const finds: Array<{ entity: unknown; where: Record<string, unknown> }> = []

function matchesIds(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  const idFilter = where.id as { $in?: string[] } | undefined
  if (idFilter?.$in && !idFilter.$in.includes(String(row.id))) return false
  if (where.deletedAt === null && row.deletedAt) return false
  return true
}

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(async (_em: unknown, entity: unknown, where: Record<string, unknown>) => {
    finds.push({ entity, where })
    return (rows.get(entity) ?? []).filter((row) => matchesIds(row, where))
  }),
}))
jest.mock('../lib/salesLookups', () => ({ loadSalesDocuments: jest.fn(async () => new Map()) }))
jest.mock('../lib/availabilityResolver', () => ({
  ...jest.requireActual('../lib/availabilityResolver'),
  resolveUnitsAvailability: jest.fn(async () => new Map()),
}))
jest.mock('../lib/settings', () => ({ loadSettings: jest.fn(async () => ({ cancelledOrderStatusEntryId: null })) }))
jest.mock('@open-mercato/queue', () => ({ createModuleQueue: jest.fn(() => ({ enqueue: jest.fn() })) }))

import '../api/leases/route'
import '../api/bookings/route'
import { summarizeBookings } from '../lib/bookingView'
import { summarizeLeases } from '../lib/leaseView'

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const scope = { tenantId: TENANT, organizationId: ORG }
const PERSON = 'person-1'
const COMPANY = 'company-1'
const now = new Date('2026-11-17T10:00:00Z')

function seed() {
  rows.clear()
  finds.length = 0
  rows.set(Building, [{ id: 'building-1', ...scope, name: 'Harbor Point' }])
  rows.set(Unit, [{ id: 'unit-1', ...scope, buildingId: 'building-1', floorId: 'floor-1', name: 'Studio 2B' }])
  rows.set(Floor, [{ id: 'floor-1', ...scope, name: 'Ground' }])
  rows.set(CustomerEntity, [
    { id: PERSON, ...scope, kind: 'person', displayName: 'Marcus Webb', deletedAt: null },
    { id: COMPANY, ...scope, kind: 'company', displayName: 'Solstice Analytics', deletedAt: null },
  ])
  rows.set(LeaseVersion, [])
  rows.set(LeaseProposal, [])
  rows.set(Lease, [
    {
      id: 'lease-1',
      ...scope,
      reference: 'L-1',
      status: 'active',
      buildingId: 'building-1',
      unitId: 'unit-1',
      customerCompanyId: COMPANY,
      primaryContactPersonId: PERSON,
      startsOn: '2026-01-01',
      termMonths: 12,
      endsOn: '2026-12-31',
      salesOrderId: null,
      pendingChange: null,
      billingAttention: false,
      createdAt: now,
      updatedAt: now,
    },
  ])
  rows.set(Booking, [
    {
      id: 'booking-1',
      ...scope,
      status: 'confirmed',
      buildingId: 'building-1',
      unitId: 'unit-1',
      bookedByPersonId: PERSON,
      customerCompanyId: COMPANY,
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
      salesOrderId: null,
      createdAt: now,
      updatedAt: now,
    },
  ])
}

function buildCtx(granted: string[]): CrudCtx {
  const userHasAllFeatures = jest.fn(async (_userId: string, required: string[]) =>
    required.every((feature) => granted.some((grant) => matchFeature(feature, grant))),
  )
  return {
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
}

function crmReads(): string[][] {
  return finds
    .filter((entry) => entry.entity === CustomerEntity)
    .map((entry) => [...((entry.where.id as { $in: string[] }).$in)].sort())
}

const grants = [
  { label: 'both features', granted: ['customers.people.view', 'customers.companies.view'], access: { people: true, companies: true } },
  { label: 'the customers wildcard', granted: ['customers.*'], access: { people: true, companies: true } },
  { label: 'people only', granted: ['customers.people.view'], access: { people: true, companies: false } },
  { label: 'companies only', granted: ['customers.companies.view'], access: { people: false, companies: true } },
  { label: 'no customers feature', granted: ['property_management.view'], access: { people: false, companies: false } },
]

function expectedReads(access: { people: boolean; companies: boolean }): string[][] {
  const ids = [...(access.people ? [PERSON] : []), ...(access.companies ? [COMPANY] : [])].sort()
  return ids.length ? [ids] : []
}

describe('CRM names on the bookings and leases lists', () => {
  beforeEach(seed)

  it.each(grants)('bookings list with $label', async ({ granted, access }) => {
    const payload: { items: Array<Record<string, unknown>>; crmAccess?: unknown } = { items: [{ id: 'booking-1' }] }
    await capturedAfterList[1](payload, buildCtx(granted))
    const [item] = payload.items
    expect(payload.crmAccess).toEqual(access)
    expect(item.bookedByPersonId).toBe(PERSON)
    expect(item.customerCompanyId).toBe(COMPANY)
    expect('bookedByName' in item).toBe(access.people)
    expect('companyName' in item).toBe(access.companies)
    if (access.people) expect(item.bookedByName).toBe('Marcus Webb')
    if (access.companies) expect(item.companyName).toBe('Solstice Analytics')
    expect(crmReads()).toEqual(expectedReads(access))
  })

  it.each(grants)('leases list with $label', async ({ granted, access }) => {
    const payload: { items: Array<Record<string, unknown>>; crmAccess?: unknown } = { items: [{ id: 'lease-1' }] }
    await capturedAfterList[0](payload, buildCtx(granted))
    const [item] = payload.items
    expect(payload.crmAccess).toEqual(access)
    expect(item.primaryContactPersonId).toBe(PERSON)
    expect(item.customerCompanyId).toBe(COMPANY)
    expect('contactName' in item).toBe(access.people)
    expect('companyName' in item).toBe(access.companies)
    if (access.people) expect(item.contactName).toBe('Marcus Webb')
    if (access.companies) expect(item.companyName).toBe('Solstice Analytics')
    expect(crmReads()).toEqual(expectedReads(access))
  })

  it.each([0, 1])('reports crmAccess on an empty page (route %i)', async (index) => {
    const payload: { items: unknown[]; crmAccess?: unknown } = { items: [] }
    await capturedAfterList[index](payload, buildCtx(['customers.people.view']))
    expect(payload.crmAccess).toEqual({ people: true, companies: false })
    expect(crmReads()).toEqual([])
  })
})

describe('summaries skip deleted CRM records', () => {
  beforeEach(seed)

  it('marks a holding booking cancellable until its end passes on the deployment clock', async () => {
    const access = { people: false, companies: false }
    const bookings = (rows.get(Booking) ?? []) as never
    const [before] = await summarizeBookings({} as never, scope, bookings, { crmAccess: access, now: '2026-11-20T09:59' })
    const [atEnd] = await summarizeBookings({} as never, scope, bookings, { crmAccess: access, now: '2026-11-20T10:00' })
    expect(before.cancellable).toBe(true)
    expect(atEnd.cancellable).toBe(false)
    for (const row of rows.get(Booking) ?? []) row.status = 'completed'
    const [completed] = await summarizeBookings({} as never, scope, bookings, { crmAccess: access, now: '2026-11-20T09:00' })
    expect(completed.cancellable).toBe(false)
  })

  it('names nobody for a deleted person or company even with full access', async () => {
    for (const row of rows.get(CustomerEntity) ?? []) row.deletedAt = now
    const access = { people: true, companies: true }
    const [booking] = await summarizeBookings({} as never, scope, (rows.get(Booking) ?? []) as never, { crmAccess: access })
    const [lease] = await summarizeLeases({} as never, scope, (rows.get(Lease) ?? []) as never, { crmAccess: access })
    expect(booking).toMatchObject({ bookedByName: null, companyName: null })
    expect(lease).toMatchObject({ contactName: null, companyName: null })
    expect(finds.filter((entry) => entry.entity === CustomerEntity).every((entry) => entry.where.deletedAt === null)).toBe(true)
  })
})
