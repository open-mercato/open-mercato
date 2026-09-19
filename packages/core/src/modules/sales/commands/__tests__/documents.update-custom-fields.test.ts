/** @jest-environment node */

/**
 * PUT `/api/sales/orders` (and quotes) accepted `customFields` and wrote them
 * to EAV via `applyDocumentUpdate` → `setRecordCustomFields`, but
 * `sales.orders.update` / `sales.quotes.update` never called
 * `emitCrudSideEffects` with the document indexer. The list GET serves
 * `customValues` from the query-index projection (cf_* on the indexed doc),
 * so the next read kept the pre-update values while scalar columns (e.g.
 * `comment`) appeared updated — #6217.
 */

import { asValue, createContainer, InjectionMode } from 'awilix'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { SalesOrder, SalesQuote } from '../../data/entities'
import { documentUpdateSchema, type DocumentUpdateInput } from '../documents'

jest.mock('#generated/entities.ids.generated', () => ({
  E: {
    sales: {
      sales_order: 'sales.sales_order',
      sales_order_line: 'sales.sales_order_line',
      sales_order_adjustment: 'sales.sales_order_adjustment',
      sales_quote: 'sales.sales_quote',
      sales_quote_line: 'sales.sales_quote_line',
      sales_quote_adjustment: 'sales.sales_quote_adjustment',
      sales_note: 'sales.sales_note',
    },
  },
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    dict: {},
    t: (key: string) => key,
    translate: (key: string) => key,
  }),
}))

jest.mock('@open-mercato/shared/lib/crud/cache', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/crud/cache')
  return {
    ...actual,
    invalidateCrudCache: jest.fn(),
  }
})

jest.mock('@open-mercato/core/modules/entities/lib/helpers', () => ({
  setRecordCustomFields: jest.fn(async () => undefined),
}))

jest.mock('@open-mercato/shared/lib/commands/helpers', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/commands/helpers')
  return {
    ...actual,
    emitCrudSideEffects: jest.fn(async () => undefined),
  }
})

const { setRecordCustomFields } = jest.requireMock(
  '@open-mercato/core/modules/entities/lib/helpers',
) as { setRecordCustomFields: jest.Mock }

const { emitCrudSideEffects } = jest.requireMock('@open-mercato/shared/lib/commands/helpers') as {
  emitCrudSideEffects: jest.Mock
}

const ORDER_ID = '11111111-1111-4111-8111-111111111111'
const QUOTE_ID = '44444444-4444-4444-8444-444444444444'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const TENANT_ID = '33333333-3333-4333-8333-333333333333'

function makeOrder() {
  return {
    id: ORDER_ID,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    orderNumber: 'O-1',
    status: null,
    statusEntryId: null,
    customerEntityId: null,
    customerContactId: null,
    customerSnapshot: null,
    billingAddressId: null,
    shippingAddressId: null,
    billingAddressSnapshot: null,
    shippingAddressSnapshot: null,
    currencyCode: 'USD',
    comments: null,
    internalNotes: null,
    channelId: null,
    placedAt: null,
    expectedDeliveryAt: null,
    shippingMethodId: null,
    shippingMethodCode: null,
    shippingMethodSnapshot: null,
    paymentMethodId: null,
    paymentMethodCode: null,
    paymentMethodSnapshot: null,
    metadata: null,
    externalReference: null,
    customerReference: null,
    exchangeRate: '1.0',
    paymentStatus: null,
    paymentStatusEntryId: null,
    fulfillmentStatus: null,
    fulfillmentStatusEntryId: null,
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  }
}

function makeQuote() {
  return {
    id: QUOTE_ID,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    quoteNumber: 'Q-1',
    status: 'draft',
    statusEntryId: null,
    customerEntityId: null,
    customerContactId: null,
    customerSnapshot: null,
    billingAddressId: null,
    shippingAddressId: null,
    billingAddressSnapshot: null,
    shippingAddressSnapshot: null,
    currencyCode: 'USD',
    comments: null,
    channelId: null,
    placedAt: null,
    shippingMethodId: null,
    shippingMethodCode: null,
    shippingMethodSnapshot: null,
    paymentMethodId: null,
    paymentMethodCode: null,
    paymentMethodSnapshot: null,
    metadata: null,
    externalReference: null,
    customerReference: null,
    acceptanceToken: null,
    sentAt: null,
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  }
}

function makeEm(document: Record<string, unknown>, entityClass: unknown = SalesOrder) {
  const em: Record<string, unknown> = {
    findOne: jest.fn(async (requested: unknown) =>
      requested === entityClass ? document : null,
    ),
    find: jest.fn(async () => []),
    create: jest.fn((_entityClass: unknown, data: unknown) => data),
    persist: jest.fn(),
    remove: jest.fn(),
    nativeDelete: jest.fn(async () => 0),
    getReference: jest.fn((_entityClass: unknown, id: string) => ({ id })),
    flush: jest.fn(async () => {}),
    begin: jest.fn(async () => {}),
    commit: jest.fn(async () => {}),
    rollback: jest.fn(async () => {}),
    isInTransaction: jest.fn(() => false),
    fork: () => em,
  }
  return em
}

function makeCtx(em: unknown) {
  const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
  container.register({
    em: asValue(em),
    dataEngine: asValue({ markOrmEntityChange: jest.fn() }),
  })
  return {
    container,
    auth: { tenantId: TENANT_ID, orgId: ORG_ID, sub: 'user-1' },
    selectedOrganizationId: ORG_ID,
    organizationScope: null,
    organizationIds: null,
  } as never
}

function getHandler(commandId = 'sales.orders.update') {
  const handler = commandRegistry.get<DocumentUpdateInput, { order?: SalesOrder; quote?: SalesQuote }>(
    commandId,
  )
  expect(handler).toBeTruthy()
  return handler!
}

function customFieldWritesFor(entityId: string) {
  return setRecordCustomFields.mock.calls
    .map((call) => call[1] as Record<string, unknown>)
    .filter((opts) => opts.entityId === entityId)
}

describe('documentUpdateSchema — customFields', () => {
  it('accepts customFields as the sole update payload', () => {
    const result = documentUpdateSchema.safeParse({
      id: ORDER_ID,
      customFields: { so_number: 'B' },
    })

    expect(result.success).toBe(true)
    expect(result.data).toMatchObject({ customFields: { so_number: 'B' } })
  })
})

describe('sales document update commands — customFields (#6217)', () => {
  beforeEach(() => {
    setRecordCustomFields.mockClear()
    emitCrudSideEffects.mockClear()
  })

  it('persists customFields supplied to sales.orders.update', async () => {
    const order = makeOrder()
    const em = makeEm(order)

    await getHandler().execute(
      { id: ORDER_ID, customFields: { so_number: 'B' } } as never,
      makeCtx(em),
    )

    const writes = customFieldWritesFor('sales.sales_order')
    expect(writes).toHaveLength(1)
    expect(writes[0]).toEqual({
      entityId: 'sales.sales_order',
      recordId: ORDER_ID,
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      values: { so_number: 'B' },
    })
  })

  it('persists customFields supplied to sales.quotes.update', async () => {
    const quote = makeQuote()
    const em = makeEm(quote, SalesQuote)

    await getHandler('sales.quotes.update').execute(
      { id: QUOTE_ID, customFields: { source: 'import' } } as never,
      makeCtx(em),
    )

    const writes = customFieldWritesFor('sales.sales_quote')
    expect(writes).toHaveLength(1)
    expect(writes[0]).toMatchObject({
      recordId: QUOTE_ID,
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      values: { source: 'import' },
    })
  })

  it('refreshes the query index after an order customFields update', async () => {
    const order = makeOrder()
    const em = makeEm(order)
    const sequence: string[] = []
    setRecordCustomFields.mockImplementationOnce(async () => {
      sequence.push('custom-fields')
    })
    emitCrudSideEffects.mockImplementation(async (opts: { action?: string; indexer?: { entityType?: string } }) => {
      if (opts.action === 'updated' && opts.indexer?.entityType === 'sales.sales_order') {
        sequence.push('side-effects')
      }
    })

    await getHandler().execute(
      { id: ORDER_ID, customFields: { so_number: 'B' } } as never,
      makeCtx(em),
    )

    expect(sequence).toEqual(['custom-fields', 'side-effects'])
    expect(emitCrudSideEffects).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'updated',
        indexer: { entityType: 'sales.sales_order' },
        identifiers: {
          id: ORDER_ID,
          organizationId: ORG_ID,
          tenantId: TENANT_ID,
        },
      }),
    )
  })

  it('refreshes the query index after a quote customFields update', async () => {
    const quote = makeQuote()
    const em = makeEm(quote, SalesQuote)

    await getHandler('sales.quotes.update').execute(
      { id: QUOTE_ID, customFields: { source: 'import' } } as never,
      makeCtx(em),
    )

    expect(emitCrudSideEffects).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'updated',
        indexer: { entityType: 'sales.sales_quote' },
        identifiers: {
          id: QUOTE_ID,
          organizationId: ORG_ID,
          tenantId: TENANT_ID,
        },
      }),
    )
  })

  it('still refreshes the query index on a scalar-only order update', async () => {
    const order = makeOrder()
    const em = makeEm(order)

    await getHandler().execute({ id: ORDER_ID, comment: 'updated' } as never, makeCtx(em))

    expect(customFieldWritesFor('sales.sales_order')).toHaveLength(0)
    expect(emitCrudSideEffects).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'updated',
        indexer: { entityType: 'sales.sales_order' },
      }),
    )
  })

  it('clears custom fields when values are null', async () => {
    const order = makeOrder()
    const em = makeEm(order)

    await getHandler().execute(
      { id: ORDER_ID, customFields: { so_number: null } } as never,
      makeCtx(em),
    )

    expect(customFieldWritesFor('sales.sales_order')[0]).toMatchObject({
      values: { so_number: null },
    })
  })
})
