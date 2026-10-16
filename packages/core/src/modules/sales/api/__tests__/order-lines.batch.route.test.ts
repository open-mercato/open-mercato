import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { bridgeLegacyGuard } from '@open-mercato/shared/lib/crud/mutation-guard-registry'
import { POST } from '../order-lines/batch/route'

const mockCommandBus = { execute: jest.fn() }

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (token: string) => (token === 'commandBus' ? mockCommandBus : null),
  })),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    translate: (key: string, fallback?: string) => fallback ?? key,
  })),
}))

jest.mock('@open-mercato/shared/lib/crud/mutation-guard-registry', () => ({
  bridgeLegacyGuard: jest.fn(() => null),
  runMutationGuards: jest.fn(),
}))

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const HOME_ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'
const SELECTED_ORGANIZATION_ID = '33333333-3333-4333-8333-333333333333'
const ORDER_ID = '44444444-4444-4444-8444-444444444444'
const LINE_ID = '55555555-5555-4555-8555-555555555555'

function makeRequest(organizationId?: string, selection = '__all__') {
  return new Request('http://localhost/api/sales/order-lines/batch', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: `om_selected_org=${selection}`,
    },
    body: JSON.stringify({
      orderId: ORDER_ID,
      lines: [{ name: 'Batch line', currencyCode: 'USD', quantity: 1, unitPriceNet: 1, unitPriceGross: 1 }],
      ...(organizationId ? { organizationId } : {}),
    }),
  })
}

describe('batch order-line organization context', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.mocked(getAuthFromRequest).mockResolvedValue({
      sub: 'user-1',
      tenantId: TENANT_ID,
      orgId: HOME_ORGANIZATION_ID,
    })
    jest.mocked(resolveOrganizationScopeForRequest).mockResolvedValue({
      selectedId: null,
      filterIds: null,
      allowedIds: null,
      tenantId: TENANT_ID,
    })
    mockCommandBus.execute.mockResolvedValue({ result: { orderId: ORDER_ID, lineIds: [LINE_ID] } })
  })

  it.each([HOME_ORGANIZATION_ID, null])(
    'rejects All organizations when the home organization is %s',
    async (organizationId) => {
      jest.mocked(getAuthFromRequest).mockResolvedValue({
        sub: 'user-1', tenantId: TENANT_ID, orgId: organizationId,
      })

      const response = await POST(makeRequest())

      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ error: 'Organization context is required' })
      expect(bridgeLegacyGuard).not.toHaveBeenCalled()
      expect(mockCommandBus.execute).not.toHaveBeenCalled()
    },
  )

  it('rejects a payload organization override when All organizations is selected', async () => {
    const response = await POST(makeRequest(HOME_ORGANIZATION_ID))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Organization context is required' })
    expect(mockCommandBus.execute).not.toHaveBeenCalled()
  })

  it.each([HOME_ORGANIZATION_ID, SELECTED_ORGANIZATION_ID])(
    'writes under the resolved selected organization %s',
    async (organizationId) => {
      jest.mocked(resolveOrganizationScopeForRequest).mockResolvedValue({
        selectedId: organizationId,
        filterIds: [organizationId],
        allowedIds: null,
        tenantId: TENANT_ID,
      })

      const response = await POST(makeRequest(undefined, organizationId))

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ orderId: ORDER_ID, lineIds: [LINE_ID] })
      expect(mockCommandBus.execute).toHaveBeenCalledWith(
        'sales.orders.lines.upsert_many',
        expect.objectContaining({
          input: {
            body: expect.objectContaining({ organizationId, tenantId: TENANT_ID, orderId: ORDER_ID }),
          },
          ctx: expect.objectContaining({ selectedOrganizationId: organizationId }),
        }),
      )
    },
  )
})
