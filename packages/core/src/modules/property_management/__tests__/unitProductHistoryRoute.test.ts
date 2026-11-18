/** @jest-environment node */
import { Unit, UnitProductPeriod } from '../data/entities'
import { FakeEm } from './support/fakeEm'

const scope = { tenantId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222' }
const UNIT = '60000000-0000-4000-8000-000000000004'
const route = { em: null as FakeEm | null, commandBus: { execute: jest.fn() } }

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
jest.mock('../lib/usageGuards', () => ({
  findActiveLeases: jest.fn(async () => []),
  findUpcomingBookings: jest.fn(async () => []),
  findUpcomingBookingList: jest.fn(async () => ({ blockers: [], total: 0 })),
}))
jest.mock('../api/routeContext', () => ({
  resolveStaffContext: jest.fn(async () => ({
    ctx: { container: { resolve: (name: string) => (name === 'commandBus' ? route.commandBus : null) }, auth: {} },
    em: route.em,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    translate: (_key: string, fallback: string) => fallback,
    permitted: null,
  })),
  readRouteParam: jest.fn(async (params: Promise<Record<string, string | undefined>>, key: string) => (await params)[key] ?? null),
  runStaffGuard: jest.fn(),
  guardedCommandInput: jest.requireActual('../api/routeContext').guardedCommandInput,
  handleRouteError: jest.fn(async (err: unknown) => {
    throw err
  }),
}))

import { GET, POST } from '../api/units/[id]/product/route'
import { runStaffGuard } from '../api/routeContext'

function seedPeriod(em: FakeEm, id: string, validFrom: string, validTo: string | null) {
  em.seed(UnitProductPeriod, {
    id,
    ...scope,
    unitId: UNIT,
    catalogProductId: '60000000-0000-4000-8000-000000000011',
    productName: 'Private office',
    use: 'leasable',
    billingUnit: 'month',
    priceAmount: null,
    currencyCode: null,
    priceKindId: null,
    validFrom: new Date(validFrom),
    validTo: validTo ? new Date(validTo) : null,
  } as never)
}

describe('unit product history GET', () => {
  it('leaves out the zero-length periods an undo collapsed', async () => {
    const em = new FakeEm()
    route.em = em
    em.seed(Unit, { id: UNIT, ...scope, buildingId: 'building-1', deletedAt: null } as never)
    seedPeriod(em, 'period-reopened', '2026-01-01T00:00:00Z', null)
    seedPeriod(em, 'period-collapsed', '2026-03-01T00:00:00Z', '2026-03-01T00:00:00Z')
    seedPeriod(em, 'period-old', '2025-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
    const response = (await GET(new Request(`http://localhost/api/property_management/units/${UNIT}/product`), {
      params: Promise.resolve({ id: UNIT }),
    })) as unknown as { body: { periods: Array<{ id: string }> } }
    expect(response.body.periods.map((period) => period.id)).toEqual(['period-reopened', 'period-old'])
  })
})

describe('unit product change POST', () => {
  const OTHER_UNIT = '60000000-0000-4000-8000-000000000099'
  const PRODUCT = '60000000-0000-4000-8000-000000000011'
  const GUARD_PRODUCT = '60000000-0000-4000-8000-000000000012'

  it('re-pins the unit and scope over a payload a mutation guard rewrote', async () => {
    const em = new FakeEm()
    route.em = em
    em.seed(Unit, { id: UNIT, ...scope, buildingId: 'building-1', deletedAt: null } as never)
    jest.mocked(runStaffGuard).mockResolvedValue({
      ok: true,
      modifiedPayload: { id: OTHER_UNIT, tenantId: 'tenant-x', organizationId: 'org-x', catalogProductId: GUARD_PRODUCT },
      runAfterSuccess: async () => undefined,
    })
    route.commandBus.execute.mockResolvedValue({ result: { unitId: UNIT, productChange: { openedPeriodId: 'period-new' } } })
    const response = (await POST(
      new Request(`http://localhost/api/property_management/units/${UNIT}/product`, {
        method: 'POST',
        body: JSON.stringify({ catalogProductId: PRODUCT }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ id: UNIT }) },
    )) as unknown as { body: { periodId: string | null } }
    expect(response.body.periodId).toBe('period-new')
    expect(route.commandBus.execute).toHaveBeenCalledWith('property_management.unit.product_change', {
      input: { id: UNIT, ...scope, catalogProductId: GUARD_PRODUCT },
      ctx: expect.anything(),
    })
  })
})
