const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const PRICE_KIND_ID = '22222222-2222-4222-8222-222222222222'

const reportErrorMock = jest.fn()
const listTenantPriceKindsMock = jest.fn()

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: (...args: unknown[]) => reportErrorMock(...args) }),
}))
jest.mock('@open-mercato/shared/lib/auth/server', () => ({ getAuthFromRequest: jest.fn() }))
jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: jest.fn() }))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))
jest.mock('../../../../lib/priceKindScope', () => ({
  listTenantPriceKinds: (...args: unknown[]) => listTenantPriceKindsMock(...args),
}))

import { GET, metadata } from '../route'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'

const mockAuth = getAuthFromRequest as jest.MockedFunction<typeof getAuthFromRequest>
const mockContainer = createRequestContainer as jest.MockedFunction<typeof createRequestContainer>
const em = { marker: 'em' }

function request(query = '') {
  return new Request(`http://localhost/api/customer_groups/customer-groups/price-kinds${query}`)
}

beforeEach(() => {
  jest.clearAllMocks()
  mockAuth.mockResolvedValue({ sub: 'user-1', tenantId: TENANT_ID, orgId: null } as never)
  mockContainer.mockResolvedValue({ resolve: () => em } as never)
  listTenantPriceKindsMock.mockResolvedValue([{ id: PRICE_KIND_ID, code: 'regular', title: 'Regular' }])
})

describe('GET /api/customer_groups/customer-groups/price-kinds', () => {
  it('is readable with customer_groups.terms.view, without catalog.settings.manage (#7077)', () => {
    expect(metadata.GET.requireFeatures).toEqual(['customer_groups.terms.view'])
  })

  it('lists the caller tenant price kinds with search and page size', async () => {
    const response = await GET(request('?search=reg&pageSize=20'))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      items: [{ id: PRICE_KIND_ID, code: 'regular', title: 'Regular' }],
    })
    expect(listTenantPriceKindsMock).toHaveBeenCalledWith(em, TENANT_ID, { search: 'reg', ids: [], limit: 20 })
  })

  it('resolves labels by comma-separated ids', async () => {
    const response = await GET(request(`?ids=${PRICE_KIND_ID}&pageSize=1`))
    expect(response.status).toBe(200)
    expect(listTenantPriceKindsMock).toHaveBeenCalledWith(em, TENANT_ID, {
      search: undefined,
      ids: [PRICE_KIND_ID],
      limit: 1,
    })
  })

  it('rejects malformed ids and oversized pages', async () => {
    expect((await GET(request('?ids=not-a-uuid'))).status).toBe(400)
    expect((await GET(request('?pageSize=500'))).status).toBe(400)
    expect(listTenantPriceKindsMock).not.toHaveBeenCalled()
  })

  it('requires an authenticated tenant context', async () => {
    mockAuth.mockResolvedValueOnce(null as never)
    expect((await GET(request())).status).toBe(401)
    mockAuth.mockResolvedValueOnce({ sub: 'user-1', tenantId: null } as never)
    expect((await GET(request())).status).toBe(400)
    expect(listTenantPriceKindsMock).not.toHaveBeenCalled()
  })

  it('reports unexpected failures', async () => {
    listTenantPriceKindsMock.mockRejectedValueOnce(new Error('boom'))
    expect((await GET(request())).status).toBe(500)
    expect(reportErrorMock).toHaveBeenCalled()
  })
})
