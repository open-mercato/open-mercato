/** @jest-environment node */
import {
  POST as createOrder,
  PUT as updateOrder,
  openApi as orderOpenApi,
} from '@open-mercato/core/modules/sales/api/orders/route'
import { PUT as updateQuote } from '@open-mercato/core/modules/sales/api/quotes/route'
import {
  ORDER_PAYMENT_LEDGER_FIELDS,
  ORDER_PAYMENT_LEDGER_WARNING_CODE,
} from '@open-mercato/core/modules/sales/data/validators'

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
const validOrderLine = {
  currencyCode: 'USD',
  quantity: 1,
  name: 'Compatibility test line',
  unitPriceNet: 100,
  unitPriceGross: 100,
}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
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

function makeRequest(body: unknown, method = 'PUT') {
  return new Request('http://localhost/api/sales/documents', {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function setupEntityMocks() {
  mockEm.fork.mockReturnValue(mockEm)
  mockEm.findOne.mockResolvedValue(null)
  mockDataEngine.updateOrmEntity.mockImplementation(async ({
    apply,
  }: {
    apply: (entity: Record<string, unknown>) => Promise<void> | void
  }) => {
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

async function setupRequestScopeMocks() {
  const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
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
}

describe('sales document update routes', () => {
  beforeEach(async () => {
    jest.clearAllMocks()
    setupEntityMocks()
    await setupRequestScopeMocks()
    mockCommandBus.execute.mockImplementation(async (
      commandId: string,
      payload: { input?: Record<string, unknown> },
    ) => {
      const id =
        payload?.input?.id ??
        '00000000-0000-4000-8000-000000000000'
      const entityKey = commandId.includes('quote') ? 'quote' : 'order'
      return {
        result: { [entityKey]: { id } },
        logEntry: {
          id: 'log-1',
          undoToken: 'undo-1',
          commandId,
          resourceId: id,
          resourceKind: commandId.includes('quote') ? 'sales.quote' : 'sales.order',
          createdAt: new Date().toISOString(),
        },
      }
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

describe('sales order create route payment-ledger compatibility', () => {
  beforeEach(async () => {
    jest.clearAllMocks()
    setupEntityMocks()
    await setupRequestScopeMocks()
    mockCommandBus.execute.mockImplementation(async (
      commandId: string,
      payload: { input?: Record<string, unknown> },
    ) => {
      const fields = ORDER_PAYMENT_LEDGER_FIELDS.filter((field) =>
        Object.prototype.hasOwnProperty.call(payload.input ?? {}, field),
      )
      return {
        result: {
          orderId: '44444444-4444-4444-8444-444444444444',
          ...(fields.length
            ? { warnings: [{ code: ORDER_PAYMENT_LEDGER_WARNING_CODE, fields }] }
            : {}),
        },
        logEntry: {
          id: 'log-create',
          undoToken: 'undo-create',
          commandId,
          resourceId: '44444444-4444-4444-8444-444444444444',
          resourceKind: 'sales.order',
          createdAt: new Date().toISOString(),
        },
      }
    })
  })

  it('returns warnings for accepted deprecated totals', async () => {
    const response = await createOrder(makeRequest({
      currencyCode: 'USD',
      lines: [validOrderLine],
      outstandingAmount: 0,
      paidTotalAmount: 100,
    }, 'POST'))

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      id: '44444444-4444-4444-8444-444444444444',
      warnings: [
        {
          code: ORDER_PAYMENT_LEDGER_WARNING_CODE,
          fields: ['paidTotalAmount', 'outstandingAmount'],
        },
      ],
    })
    expect(mockCommandBus.execute).toHaveBeenCalledWith(
      'sales.orders.create',
      expect.objectContaining({
        input: expect.objectContaining({
          paidTotalAmount: 100,
          outstandingAmount: 0,
        }),
      }),
    )
  })

  it('keeps the historical id-only response for clean creates', async () => {
    const response = await createOrder(makeRequest({ currencyCode: 'USD', lines: [validOrderLine] }, 'POST'))

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toEqual({
      id: '44444444-4444-4444-8444-444444444444',
    })
  })

  it('documents the accepted fields, migration path, and optional warning response', () => {
    const post = orderOpenApi.methods?.POST
    expect(post).toBeDefined()
    expect(post?.description).toContain('deprecated compatibility inputs')
    expect(post?.description).toContain('POST /api/sales/payments')

    const requestResult = post?.requestBody?.schema.safeParse({
      organizationId: '11111111-1111-4111-8111-111111111111',
      tenantId: '00000000-0000-4000-8000-000000000000',
      currencyCode: 'USD',
      lines: [validOrderLine],
      paidTotalAmount: 0,
      refundedTotalAmount: 0,
      outstandingAmount: 0,
    })
    expect(requestResult?.success).toBe(true)

    const responseSchema = post?.responses?.find((response) => response.status === 201)?.schema
    expect(responseSchema?.safeParse({
      id: '44444444-4444-4444-8444-444444444444',
      warnings: [
        {
          code: ORDER_PAYMENT_LEDGER_WARNING_CODE,
          fields: ORDER_PAYMENT_LEDGER_FIELDS,
        },
      ],
    }).success).toBe(true)
  })
})
