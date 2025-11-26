/** @jest-environment node */
import { PUT as updateOrder } from '@open-mercato/core/modules/sales/api/orders/route'
import { PUT as updateQuote } from '@open-mercato/core/modules/sales/api/quotes/route'

const mockCommandBus = { execute: jest.fn() }
const mockDataEngine = {
  updateOrmEntity: jest.fn(),
  markOrmEntityChange: jest.fn(),
  flushOrmEntityChanges: jest.fn(),
}
const mockEm = {
  findOne: jest.fn(),
  fork: jest.fn(),
}

jest.mock('@/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(),
}))

jest.mock('@/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (token: string) => {
      if (token === 'commandBus') return mockCommandBus
      if (token === 'dataEngine') return mockDataEngine
      if (token === 'em') return mockEm
      if (token === 'accessLogService') return null
      return null
    },
  })),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(),
}))

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/sales/documents', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function setupEntityMocks() {
  mockEm.fork.mockReturnValue(mockEm)
  mockEm.findOne.mockResolvedValue(null)
  mockDataEngine.updateOrmEntity.mockImplementation(async ({ apply }: any) => {
    const entity = {
      id: 'doc-1',
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      comments: null,
      customerEntityId: null,
      customerContactId: null,
      customerSnapshot: null,
      billingAddressId: null,
      shippingAddressId: null,
      billingAddressSnapshot: null,
      shippingAddressSnapshot: null,
      shippingMethodId: null,
      shippingMethodCode: null,
      shippingMethodSnapshot: null,
      paymentMethodId: null,
      paymentMethodCode: null,
      paymentMethodSnapshot: null,
      currencyCode: 'USD',
      channelId: null,
      statusEntryId: null,
      status: null,
      placedAt: null,
      expectedDeliveryAt: null,
      metadata: null,
    }
    await apply(entity)
    return entity
  })
  mockDataEngine.markOrmEntityChange.mockResolvedValue(undefined)
  mockDataEngine.flushOrmEntityChanges.mockResolvedValue(undefined)
}

describe('sales document update routes', () => {
  beforeEach(async () => {
    jest.clearAllMocks()
    setupEntityMocks()
    const { getAuthFromRequest } = await import('@/lib/auth/server')
    const { resolveOrganizationScopeForRequest } = await import('@open-mercato/core/modules/directory/utils/organizationScope')
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({
      sub: 'user-1',
      tenantId: '00000000-0000-4000-8000-000000000000',
      orgId: '11111111-1111-4111-8111-111111111111',
    })
    ;(resolveOrganizationScopeForRequest as jest.Mock).mockResolvedValue({
      selectedId: '11111111-1111-4111-8111-111111111111',
      filterIds: ['11111111-1111-4111-8111-111111111111'],
      allowedIds: ['11111111-1111-4111-8111-111111111111'],
    })
    mockCommandBus.execute.mockResolvedValue({
      result: { ok: true },
      logEntry: {
        id: 'log-1',
        undoToken: 'undo-1',
        commandId: 'sales.documents.update',
        resourceId: '22222222-2222-4222-8222-222222222222',
        resourceKind: 'sales.document',
        createdAt: new Date().toISOString(),
      },
    })
  })

  it('uses command bus for order updates and returns operation metadata', async () => {
    const res = await updateOrder(makeRequest({ id: '22222222-2222-4222-8222-222222222222', comment: 'Updated order' }))

    expect(res.status).toBe(200)
    expect(mockCommandBus.execute).toHaveBeenCalledWith(
      'sales.orders.update',
      expect.objectContaining({
        input: expect.objectContaining({ id: '22222222-2222-4222-8222-222222222222', comment: 'Updated order' }),
      })
    )
    expect(res.headers.get('x-om-operation')).toBeTruthy()
  })

  it('uses command bus for quote updates and returns operation metadata', async () => {
    const res = await updateQuote(makeRequest({ id: '33333333-3333-4333-8333-333333333333', comment: 'Updated quote' }))

    expect(res.status).toBe(200)
    expect(mockCommandBus.execute).toHaveBeenCalledWith(
      'sales.quotes.update',
      expect.objectContaining({
        input: expect.objectContaining({ id: '33333333-3333-4333-8333-333333333333', comment: 'Updated quote' }),
      })
    )
    expect(res.headers.get('x-om-operation')).toBeTruthy()
  })
})
