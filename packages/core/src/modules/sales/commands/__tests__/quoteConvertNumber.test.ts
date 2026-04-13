/** @jest-environment node */

import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { SalesQuote, SalesOrder } from '@open-mercato/core/modules/sales/data/entities'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    dict: {},
    t: (key: string, fallback?: string) => fallback ?? key,
    translate: (key: string, fallback?: string) => fallback ?? key,
  }),
}))

jest.mock('#generated/entities.ids.generated', () => ({
  E: {
    sales: {
      sales_order: 'sales.sales_order',
      sales_order_line: 'sales.sales_order_line',
      sales_quote: 'sales.sales_quote',
      sales_quote_line: 'sales.sales_quote_line',
      sales_quote_adjustment: 'sales.sales_quote_adjustment',
    },
  },
}))

jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({
  loadCustomFieldValues: jest.fn().mockResolvedValue({}),
}))

jest.mock('@open-mercato/core/modules/entities/lib/helpers', () => ({
  setRecordCustomFields: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn().mockResolvedValue([]),
  findOneWithDecryption: jest.fn().mockResolvedValue(null),
}))

const mockedFindOneWithDecryption = findOneWithDecryption as jest.MockedFunction<typeof findOneWithDecryption>

function buildQuote(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    organizationId: '11111111-1111-4111-8111-111111111111',
    tenantId: '00000000-0000-4000-8000-000000000000',
    quoteNumber: 'QUOTE-20260310-00007',
    statusEntryId: null,
    status: 'draft',
    customerEntityId: null,
    customerContactId: null,
    customerSnapshot: null,
    billingAddressId: null,
    shippingAddressId: null,
    billingAddressSnapshot: null,
    shippingAddressSnapshot: null,
    currencyCode: 'USD',
    validFrom: null,
    validUntil: null,
    comments: null,
    taxInfo: null,
    shippingMethodId: null,
    shippingMethodCode: null,
    deliveryWindowId: null,
    deliveryWindowCode: null,
    paymentMethodId: null,
    paymentMethodCode: null,
    channelId: null,
    shippingMethodSnapshot: null,
    deliveryWindowSnapshot: null,
    paymentMethodSnapshot: null,
    metadata: null,
    customFieldSetId: null,
    subtotalNetAmount: '100',
    subtotalGrossAmount: '100',
    discountTotalAmount: '0',
    taxTotalAmount: '0',
    grandTotalNetAmount: '100',
    grandTotalGrossAmount: '100',
    lineItemCount: 1,
    totalsSnapshot: null,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

describe('sales.quotes.convert_to_order — document number generation (#919)', () => {
  let createdEntities: Array<Record<string, unknown>>
  let removedEntities: unknown[]
  let mockGenerator: { generate: jest.Mock }

  const mockEm = {
    findOne: jest.fn(),
    find: jest.fn().mockResolvedValue([]),
    create: jest.fn(),
    persist: jest.fn(),
    remove: jest.fn(),
    flush: jest.fn().mockResolvedValue(undefined),
    fork: jest.fn(),
    nativeDelete: jest.fn().mockResolvedValue(0),
    getConnection: jest.fn().mockReturnValue({
      execute: jest.fn().mockResolvedValue([]),
    }),
  }

  beforeAll(async () => {
    commandRegistry.clear?.()
    await import('../documents')
  })

  beforeEach(() => {
    jest.clearAllMocks()
    createdEntities = []
    removedEntities = []

    mockEm.fork.mockReturnValue(mockEm)
    mockEm.create.mockImplementation((_Entity: unknown, data: Record<string, unknown>) => {
      createdEntities.push(data)
      return data
    })
    mockEm.remove.mockImplementation((entity: unknown) => {
      removedEntities.push(entity)
    })

    mockGenerator = {
      generate: jest.fn().mockResolvedValue({
        number: 'ORDER-20260310-00001',
        format: 'ORDER-{yyyy}{mm}{dd}-{seq:5}',
        sequence: 1,
      }),
    }
  })

  function setupQuoteMocks(quote: ReturnType<typeof buildQuote>) {
    mockedFindOneWithDecryption.mockImplementation(async (_em, entity) => {
      if (entity === SalesQuote) return quote as any
      if (entity === SalesOrder) return null
      return null
    })
  }

  function buildCtx() {
    return {
      container: {
        resolve: (token: string) => {
          if (token === 'em') return mockEm
          if (token === 'salesDocumentNumberGenerator') return mockGenerator
          if (token === 'eventBus') return { emit: jest.fn() }
          return null
        },
      },
      auth: {
        sub: 'user-1',
        tenantId: '00000000-0000-4000-8000-000000000000',
        orgId: '11111111-1111-4111-8111-111111111111',
      },
      organizationScope: null,
      selectedOrganizationId: '11111111-1111-4111-8111-111111111111',
      organizationIds: ['11111111-1111-4111-8111-111111111111'],
    }
  }

  it('generates a new ORDER-prefixed number instead of copying the quote number', async () => {
    const handler = commandRegistry.get<any, any>('sales.quotes.convert_to_order')
    expect(handler).toBeTruthy()

    const quote = buildQuote()
    setupQuoteMocks(quote)

    const result = await handler!.execute(
      { quoteId: quote.id },
      buildCtx() as any,
    )

    expect(result).toEqual({ orderId: quote.id })

    expect(mockGenerator.generate).toHaveBeenCalledWith({
      kind: 'order',
      organizationId: quote.organizationId,
      tenantId: quote.tenantId,
    })

    const orderEntity = createdEntities.find(
      (entity) => 'orderNumber' in entity,
    )
    expect(orderEntity).toBeTruthy()
    expect(orderEntity!.orderNumber).toBe('ORDER-20260310-00001')
    expect(orderEntity!.orderNumber).not.toMatch(/^QUOTE-/)
  })

  it('does not use the quote number as the order number', async () => {
    const handler = commandRegistry.get<any, any>('sales.quotes.convert_to_order')
    expect(handler).toBeTruthy()

    const quote = buildQuote({ quoteNumber: 'QUOTE-20260101-99999' })
    setupQuoteMocks(quote)

    mockGenerator.generate.mockResolvedValue({
      number: 'ORDER-20260101-00042',
      format: 'ORDER-{yyyy}{mm}{dd}-{seq:5}',
      sequence: 42,
    })

    await handler!.execute({ quoteId: quote.id }, buildCtx() as any)

    const orderEntity = createdEntities.find(
      (entity) => 'orderNumber' in entity,
    )
    expect(orderEntity).toBeTruthy()
    expect(orderEntity!.orderNumber).toBe('ORDER-20260101-00042')
    expect(orderEntity!.orderNumber).not.toBe(quote.quoteNumber)
  })

  it('allows explicit orderNumber override from the caller', async () => {
    const handler = commandRegistry.get<any, any>('sales.quotes.convert_to_order')
    expect(handler).toBeTruthy()

    const quote = buildQuote()
    setupQuoteMocks(quote)

    await handler!.execute(
      { quoteId: quote.id, orderNumber: 'CUSTOM-001' },
      buildCtx() as any,
    )

    const orderEntity = createdEntities.find(
      (entity) => 'orderNumber' in entity,
    )
    expect(orderEntity).toBeTruthy()
    expect(orderEntity!.orderNumber).toBe('CUSTOM-001')
  })
})
