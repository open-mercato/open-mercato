/** @jest-environment node */
const scope = { tenantId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222' }
const unitId = '33333333-3333-4333-8333-333333333333'
const buildingId = '44444444-4444-4444-8444-444444444444'
const channelId = '55555555-5555-4555-8555-555555555555'
const settingsState: { billingChannelId: string | null } = { billingChannelId: null }
const resolvePriceSnapshot = jest.fn(async () => ({ priceAmount: '25.0000', currencyCode: 'EUR', priceKindId: 'kind-1' }))

jest.mock('next/server', () => ({
  NextResponse: { json: (body: unknown, init?: { status?: number }) => ({ body, status: init?.status ?? 200 }) },
}))
jest.mock('../api/routeContext', () => ({
  resolveStaffContext: jest.fn(async () => ({
    ctx: { container: {} },
    em: {},
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    translate: (_key: string, fallback: string) => fallback,
    permitted: null,
  })),
  readRouteParam: jest.fn(async () => unitId),
  handleRouteError: jest.fn(async (err: unknown) => {
    throw err
  }),
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(async (_em: unknown, _entity: unknown, where: { id: string }) =>
    where.id === unitId ? { id: unitId, buildingId, floorId: 'floor-1' } : { id: buildingId, status: 'active' },
  ),
}))
jest.mock('../lib/bookingRecords', () => ({
  ...jest.requireActual('../lib/bookingRecords'),
  resolveBookingProduct: jest.fn(async () => ({ catalogProductId: 'product-1', billingUnit: 'hour' })),
  findOverlappingBookings: jest.fn(async () => []),
}))
jest.mock('../lib/productUse', () => ({
  ...jest.requireActual('../lib/productUse'),
  resolvePriceSnapshot,
}))
jest.mock('../lib/settings', () => ({
  loadSettings: jest.fn(async () => ({ billingChannelId: settingsState.billingChannelId })),
}))
jest.mock('../lib/openingHours', () => ({
  ...jest.requireActual('../lib/openingHours'),
  loadBuildingOpening: jest.fn(async () => null),
}))
jest.mock('../lib/availabilityResolver', () => ({
  ...jest.requireActual('../lib/availabilityResolver'),
  resolveUnitAvailability: jest.fn(async () => []),
}))

import { GET } from '../api/units/[id]/slots/route'

type SlotsResult = { status: number; body: { price: { amount: string | null; currency: string | null; billingUnit: string }; billingChannelConfigured: boolean } }

async function readSlots(): Promise<SlotsResult> {
  const response = await GET(new Request(`http://localhost/api/property_management/units/${unitId}/slots?date=2099-01-05`), {
    params: Promise.resolve({ id: unitId }),
  })
  return response as unknown as SlotsResult
}

describe('unit slots price and billing channel', () => {
  beforeEach(() => {
    resolvePriceSnapshot.mockClear()
  })

  it('shows no price and flags the missing channel while booking.create would refuse', async () => {
    settingsState.billingChannelId = null
    const result = await readSlots()
    expect(result.status).toBe(200)
    expect(result.body.billingChannelConfigured).toBe(false)
    expect(result.body.price).toEqual({ amount: null, currency: null, billingUnit: 'hour' })
    expect(resolvePriceSnapshot).not.toHaveBeenCalled()
  })

  it('prices the slot in the configured billing channel', async () => {
    settingsState.billingChannelId = channelId
    const result = await readSlots()
    expect(result.body.billingChannelConfigured).toBe(true)
    expect(result.body.price).toEqual({ amount: '25.0000', currency: 'EUR', billingUnit: 'hour' })
    expect(resolvePriceSnapshot).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      scope,
      'product-1',
      expect.objectContaining({ channelId }),
    )
  })
})
