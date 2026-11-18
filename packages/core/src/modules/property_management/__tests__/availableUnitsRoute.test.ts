/** @jest-environment node */
import type { AwilixContainer } from 'awilix'
import { DefaultCatalogPricingService } from '@open-mercato/core/modules/catalog/services/catalogPricingService'
import { Booking, Building, Floor, Lease, ProductUse, Space, Unit, UnitProductPeriod } from '../data/entities'
import { FakeEm } from './support/fakeEm'

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const scope = { tenantId: TENANT, organizationId: ORG }
const PRODUCT = '60000000-0000-4000-8000-000000000001'
const BUILDING = '60000000-0000-4000-8000-000000000010'
const FLOOR = '60000000-0000-4000-8000-000000000011'
const SPACE = '60000000-0000-4000-8000-000000000012'

const pricingContainer = {
  resolve: (name: string) => {
    if (name === 'catalogPricingService') return new DefaultCatalogPricingService(null)
    throw new Error(`[internal] unexpected ${name}`)
  },
} as unknown as AwilixContainer

const route = { em: null as FakeEm | null }

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    dict: {},
    t: (key: string) => key,
    translate: (key: string, fallback?: string) => fallback ?? key,
  }),
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => jest.requireActual('./support/fakeEm').encryptionFindMock())
jest.mock('next/server', () => ({
  NextResponse: { json: (body: unknown, init?: { status?: number }) => ({ body, status: init?.status ?? 200 }) },
}))
jest.mock('../api/routeContext', () => ({
  resolveStaffContext: jest.fn(async () => ({
    ctx: { container: pricingContainer, auth: {} },
    em: route.em,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    translate: (_key: string, fallback: string) => fallback,
    permitted: null,
  })),
  handleRouteError: jest.fn(async (err: unknown) => {
    throw err
  }),
}))

import { GET } from '../api/leases/available-units/route'

function unitName(index: number): string {
  return `Office ${String(index).padStart(3, '0')}`
}

function unitId(index: number): string {
  return `70000000-0000-4000-8000-${String(index).padStart(12, '0')}`
}

function seedStructure(em: FakeEm, unitCount: number) {
  em.seed(Building, { id: BUILDING, ...scope, name: 'Harbor Point', status: 'active', deletedAt: null } as never)
  em.seed(Floor, { id: FLOOR, ...scope, buildingId: BUILDING, name: 'Ground Floor', deletedAt: null } as never)
  em.seed(Space, { id: SPACE, ...scope, buildingId: BUILDING, floorId: FLOOR, name: 'Open plan', deletedAt: null } as never)
  em.seed(ProductUse, { id: 'product-use-1', ...scope, catalogProductId: PRODUCT, use: 'leasable', billingUnit: 'month' } as never)
  for (let index = 1; index <= unitCount; index += 1) {
    em.seed(Unit, {
      id: unitId(index),
      ...scope,
      buildingId: BUILDING,
      floorId: FLOOR,
      spaceId: SPACE,
      name: unitName(index),
      catalogProductId: PRODUCT,
      width: '4',
      depth: '3',
      deletedAt: null,
    } as never)
    em.seed(UnitProductPeriod, {
      id: `period-${index}`,
      ...scope,
      unitId: unitId(index),
      catalogProductId: PRODUCT,
      productName: 'Private office',
      use: 'leasable',
      billingUnit: 'month',
      priceAmount: '1000.0000',
      currencyCode: 'EUR',
      priceKindId: null,
      validFrom: new Date('2026-01-01T00:00:00Z'),
      validTo: null,
    } as never)
  }
}

function seedBooking(em: FakeEm, index: number, unit: string, status: string, startsAt: string, endsAt: string) {
  em.seed(Booking, { id: `booking-${index}`, ...scope, unitId: unit, status, startsAt, endsAt, deletedAt: null } as never)
}

function respondToBookingsInTerm(em: FakeEm) {
  em.respond = (sql, params) => {
    if (!sql.includes('from property_management_bookings') || !sql.includes('starts_at < ?')) return []
    const unitCount = (/unit_id in \(([^)]*)\)/.exec(sql)?.[1].match(/\?/g) ?? []).length
    const statusCount = (/status in \(([^)]*)\)/.exec(sql)?.[1].match(/\?/g) ?? []).length
    const [organizationId, tenantId] = params as string[]
    const unitIds = params.slice(2, 2 + unitCount)
    const statuses = params.slice(2 + unitCount, 2 + unitCount + statusCount)
    const startsBefore = String(params[2 + unitCount + statusCount])
    const endsAfter = String(params[3 + unitCount + statusCount])
    const units = em
      .rows(Booking)
      .filter((row) => row.organizationId === organizationId && row.tenantId === tenantId && !row.deletedAt)
      .filter((row) => unitIds.includes(row.unitId) && statuses.includes(row.status))
      .filter((row) => `${String(row.startsAt)}:00` < startsBefore && `${String(row.endsAt)}:00` > endsAfter)
      .map((row) => row.unitId)
    return Array.from(new Set(units)).map((unit_id) => ({ unit_id }))
  }
}

type Body = { endsOn: string | null; items: Array<{ id: string; name: string }> }

async function get(query: string): Promise<Body> {
  const response = (await GET(new Request(`http://localhost/api/property_management/leases/available-units?${query}`))) as unknown as { body: Body }
  return response.body
}

function unitReads(find: jest.SpyInstance): Array<{ limit?: number }> {
  return find.mock.calls.filter(([entity]) => entity === Unit).map(([, , options]) => options as { limit?: number })
}

describe('available units GET', () => {
  it('leaves out a unit with a pending or confirmed booking inside the term', async () => {
    const em = new FakeEm()
    route.em = em
    seedStructure(em, 4)
    respondToBookingsInTerm(em)
    seedBooking(em, 1, unitId(1), 'confirmed', '2030-03-10T09:00', '2030-03-10T10:00')
    seedBooking(em, 2, unitId(2), 'pending', '2030-08-01T09:00', '2030-08-01T10:00')
    seedBooking(em, 3, unitId(3), 'cancelled', '2030-03-10T09:00', '2030-03-10T10:00')
    seedBooking(em, 4, unitId(4), 'confirmed', '2031-03-01T09:00', '2031-03-01T10:00')
    const body = await get('startsOn=2030-02-01&termMonths=12')
    expect(body.items.map((item) => item.name)).toEqual([unitName(3), unitName(4)])
    const bookingQuery = em.executed.find((entry) => entry.sql.includes('starts_at < ?'))
    expect(bookingQuery?.sql).toContain('deleted_at is null')
    expect(bookingQuery?.params.slice(0, 2)).toEqual([ORG, TENANT])
  })

  it('ignores bookings when no term is given', async () => {
    const em = new FakeEm()
    route.em = em
    seedStructure(em, 2)
    respondToBookingsInTerm(em)
    seedBooking(em, 1, unitId(1), 'confirmed', '2030-03-10T09:00', '2030-03-10T10:00')
    const body = await get('limit=10')
    expect(body.items.map((item) => item.name)).toEqual([unitName(1), unitName(2)])
    expect(em.executed.some((entry) => entry.sql.includes('starts_at < ?'))).toBe(false)
  })

  it('reads one bounded page of units when the first units are free', async () => {
    const em = new FakeEm()
    route.em = em
    seedStructure(em, 80)
    const find = jest.spyOn(em, 'find')
    const body = await get('startsOn=2030-02-01&termMonths=12&limit=3')
    expect(body.items.map((item) => item.name)).toEqual([unitName(1), unitName(2), unitName(3)])
    const reads = unitReads(find)
    expect(reads).toHaveLength(1)
    expect(reads[0].limit).toBe(25)
  })

  it('pages past occupied units by name until enough free units are found', async () => {
    const em = new FakeEm()
    route.em = em
    seedStructure(em, 80)
    respondToBookingsInTerm(em)
    for (let index = 1; index <= 30; index += 1) {
      em.seed(Lease, {
        id: `lease-${index}`,
        ...scope,
        reference: `L-2030-${index}`,
        unitId: unitId(index),
        status: 'active',
        startsOn: '2030-01-01',
        endsOn: '2030-12-31',
        termMonths: 12,
        deletedAt: null,
      } as never)
    }
    const find = jest.spyOn(em, 'find')
    const body = await get('startsOn=2030-02-01&termMonths=12&limit=2')
    expect(body.items.map((item) => item.name)).toEqual([unitName(31), unitName(32)])
    const reads = unitReads(find)
    expect(reads).toHaveLength(2)
    expect(reads.every((options) => options.limit === 25)).toBe(true)
  })

  it('stops at the end of the unit list', async () => {
    const em = new FakeEm()
    route.em = em
    seedStructure(em, 25)
    const find = jest.spyOn(em, 'find')
    const body = await get('limit=100')
    expect(body.items).toHaveLength(25)
    expect(unitReads(find).map((options) => options.limit)).toEqual([100])
  })

  it('reads only units of leasable products, filtered in the unit query', async () => {
    const em = new FakeEm()
    route.em = em
    seedStructure(em, 3)
    const bookable = '60000000-0000-4000-8000-000000000002'
    em.seed(ProductUse, { id: 'product-use-2', ...scope, catalogProductId: bookable, use: 'bookable', billingUnit: 'hour' } as never)
    Object.assign(em.rows(Unit).find((row) => row.id === unitId(2)) as Record<string, unknown>, { catalogProductId: bookable })
    const find = jest.spyOn(em, 'find')
    const body = await get('limit=10')
    expect(body.items.map((item) => item.name)).toEqual([unitName(1), unitName(3)])
    const unitWheres = find.mock.calls.filter(([entity]) => entity === Unit).map(([, where]) => where as Record<string, unknown>)
    expect(unitWheres[0].catalogProductId).toEqual({ $in: [PRODUCT] })
  })

  it('returns no units without a leasable product, without reading units', async () => {
    const em = new FakeEm()
    route.em = em
    seedStructure(em, 3)
    Object.assign(em.rows(ProductUse)[0] as Record<string, unknown>, { use: 'bookable', billingUnit: 'hour' })
    const find = jest.spyOn(em, 'find')
    const body = await get('limit=10')
    expect(body.items).toEqual([])
    expect(unitReads(find)).toHaveLength(0)
  })

  it('stops paging after a bounded number of unit pages', async () => {
    const em = new FakeEm()
    route.em = em
    seedStructure(em, 600)
    respondToBookingsInTerm(em)
    for (let index = 1; index <= 600; index += 1) {
      em.seed(Lease, {
        id: `lease-${index}`,
        ...scope,
        reference: `L-2030-${index}`,
        unitId: unitId(index),
        status: 'active',
        startsOn: '2030-01-01',
        endsOn: '2030-12-31',
        termMonths: 12,
        deletedAt: null,
      } as never)
    }
    const find = jest.spyOn(em, 'find')
    const body = await get('startsOn=2030-02-01&termMonths=12&limit=1')
    expect(body.items).toEqual([])
    expect(unitReads(find)).toHaveLength(20)
  })

  it('refuses a search term longer than 200 characters', async () => {
    const em = new FakeEm()
    route.em = em
    seedStructure(em, 1)
    await expect(get(`search=${'a'.repeat(201)}`)).rejects.toThrow()
  })
})
