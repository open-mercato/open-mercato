/** @jest-environment node */

import { LockMode } from '@mikro-orm/core'
import { asValue, createContainer, InjectionMode } from 'awilix'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands/types'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  SalesDocumentAddress,
  SalesDocumentTagAssignment,
  SalesNote,
  SalesOrder,
  SalesQuote,
  SalesQuoteAdjustment,
  SalesQuoteLine,
} from '@open-mercato/core/modules/sales/data/entities'

type ConvertToOrderInput = { quoteId: string; orderId?: string; orderNumber?: string }
type ConvertToOrderResult = { orderId: string }

function readWhereId(where: unknown): unknown {
  if (where && typeof where === 'object' && 'id' in where) {
    return where.id
  }
  return undefined
}

function readLockOption(options: unknown): { lockMode?: unknown } | null {
  if (options && typeof options === 'object' && 'lockMode' in options) {
    return { lockMode: options.lockMode }
  }
  return null
}

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

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({
  loadCustomFieldValues: jest.fn(async () => ({})),
}))

jest.mock('@open-mercato/core/modules/entities/lib/helpers', () => ({
  setRecordCustomFields: jest.fn(async () => undefined),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(async () => []),
  findOneWithDecryption: jest.fn(),
}))

const mockedFindOneWithDecryption = jest.mocked(findOneWithDecryption)
const mockedFindWithDecryption = jest.mocked(findWithDecryption)

describe('sales.quotes.convert_to_order', () => {
  beforeAll(async () => {
    commandRegistry.clear?.()
    await import('../documents')
  })

  test('serializes concurrent conversions on the same quote with a pessimistic lock', async () => {
    const handler = commandRegistry.get<ConvertToOrderInput, ConvertToOrderResult>(
      'sales.quotes.convert_to_order',
    )
    expect(handler).toBeTruthy()

    const quote = {
      id: '11111111-1111-4111-8111-111111111111',
      organizationId: '22222222-2222-4222-8222-222222222222',
      tenantId: '33333333-3333-4333-8333-333333333333',
      createdAt: new Date('2026-04-12T08:00:00.000Z'),
      quoteNumber: 'SQ-1',
      statusEntryId: null,
      status: 'confirmed',
      customerEntityId: null,
      customerContactId: null,
      customerSnapshot: null,
      billingAddressId: null,
      shippingAddressId: null,
      billingAddressSnapshot: null,
      shippingAddressSnapshot: null,
      currencyCode: 'USD',
      taxInfo: null,
      shippingMethodId: null,
      shippingMethodCode: null,
      deliveryWindowId: null,
      deliveryWindowCode: null,
      paymentMethodId: null,
      paymentMethodCode: null,
      channelId: null,
      validFrom: null,
      validUntil: null,
      comments: null,
      shippingMethodSnapshot: null,
      deliveryWindowSnapshot: null,
      paymentMethodSnapshot: null,
      metadata: null,
      customFieldSetId: null,
      subtotalNetAmount: '10',
      subtotalGrossAmount: '10',
      discountTotalAmount: '0',
      taxTotalAmount: '0',
      grandTotalNetAmount: '10',
      grandTotalGrossAmount: '10',
      totalsSnapshot: null,
      lineItemCount: 1,
      deletedAt: null,
    }

    const quoteLine = {
      id: '44444444-4444-4444-8444-444444444444',
      lineNumber: 1,
      kind: 'product',
      statusEntryId: null,
      status: null,
      productId: null,
      productVariantId: null,
      catalogSnapshot: null,
      name: 'Item',
      description: null,
      comment: null,
      quantity: '1',
      quantityUnit: null,
      normalizedQuantity: '1',
      normalizedUnit: null,
      uomSnapshot: null,
      currencyCode: 'USD',
      unitPriceNet: '10',
      unitPriceGross: '10',
      discountAmount: '0',
      discountPercent: '0',
      taxRate: '0',
      taxAmount: '0',
      totalNetAmount: '10',
      totalGrossAmount: '10',
      configuration: null,
      promotionCode: null,
      promotionSnapshot: null,
      metadata: null,
      customFieldSetId: null,
    }

    const lockOptions: unknown[] = []
    const createdOrderIds: string[] = []
    let quoteExists = true
    let active = Promise.resolve()

    const em = {
      fork: jest.fn(),
      transactional: jest.fn(async (callback: (trx: any) => Promise<unknown>) => {
        const previous = active
        let release: (() => void) | null = null
        active = new Promise<void>((resolve) => {
          release = resolve
        })
        await previous
        try {
          return await callback(em)
        } finally {
          release?.()
        }
      }),
      findOne: jest.fn(async () => null),
      find: jest.fn(async () => []),
      create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({ ...data })),
      persist: jest.fn((entity: Record<string, unknown>) => {
        if (typeof entity.orderNumber === 'string' && typeof entity.id === 'string') {
          createdOrderIds.push(entity.id)
        }
      }),
      nativeDelete: jest.fn(async () => 0),
      remove: jest.fn((entity: Record<string, unknown>) => {
        if (entity.id === quote.id) quoteExists = false
      }),
      flush: jest.fn(async () => undefined),
    }
    em.fork.mockReturnValue(em)

    mockedFindOneWithDecryption.mockImplementation(async (_em, entity, where, options) => {
      const id = readWhereId(where)
      if (entity === SalesQuote) {
        lockOptions.push(readLockOption(options))
        if (id === quote.id && quoteExists) return quote
        return null
      }
      if (entity === SalesOrder) {
        if (typeof id === 'string' && createdOrderIds.includes(id)) {
          return { id, deletedAt: null }
        }
        return null
      }
      return null
    })

    mockedFindWithDecryption.mockImplementation(async (_em, entity) => {
      if (entity === SalesQuoteLine) return quoteExists ? [quoteLine] : []
      if (entity === SalesQuoteAdjustment) return []
      if (entity === SalesDocumentAddress) return []
      if (entity === SalesNote) return []
      if (entity === SalesDocumentTagAssignment) return []
      return []
    })

    const container = createContainer({ injectionMode: InjectionMode.PROXY })
    container.register({
      em: asValue(em),
      salesDocumentNumberGenerator: asValue({
        generate: jest.fn(async () => ({ number: `SO-${createdOrderIds.length + 1}` })),
      }),
    })

    const ctx: CommandRuntimeContext = {
      container,
      auth: null,
      organizationScope: null,
      selectedOrganizationId: quote.organizationId,
      organizationIds: [quote.organizationId],
    }

    const first = handler!.execute(
      {
        quoteId: quote.id,
        orderId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      },
      ctx,
    )
    const second = handler!.execute(
      {
        quoteId: quote.id,
        orderId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      },
      ctx,
    )

    const results = await Promise.allSettled([first, second])
    const fulfilled = results.filter((entry): entry is PromiseFulfilledResult<{ orderId: string }> => entry.status === 'fulfilled')
    const rejected = results.filter((entry): entry is PromiseRejectedResult => entry.status === 'rejected')

    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(fulfilled[0].value.orderId).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    expect(rejected[0].reason).toBeInstanceOf(CrudHttpError)
    expect((rejected[0].reason as CrudHttpError).status).toBe(404)
    expect(createdOrderIds).toEqual(['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'])
    expect(lockOptions).toContainEqual({ lockMode: LockMode.PESSIMISTIC_WRITE })
  })

  test('reuses ctx.transactionalEm and does not open its own transaction (issue #2114)', async () => {
    const handler = commandRegistry.get<ConvertToOrderInput, ConvertToOrderResult>(
      'sales.quotes.convert_to_order',
    )
    expect(handler).toBeTruthy()

    const quote = {
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      organizationId: '22222222-2222-4222-8222-222222222222',
      tenantId: '33333333-3333-4333-8333-333333333333',
      createdAt: new Date('2026-04-12T08:00:00.000Z'),
      quoteNumber: 'SQ-TX',
      statusEntryId: null,
      status: 'confirmed',
      currencyCode: 'USD',
      subtotalNetAmount: '10',
      subtotalGrossAmount: '10',
      discountTotalAmount: '0',
      taxTotalAmount: '0',
      grandTotalNetAmount: '10',
      grandTotalGrossAmount: '10',
      lineItemCount: 0,
      validFrom: null,
      validUntil: null,
      deletedAt: null,
    }

    // The EM passed in via ctx.transactionalEm is the one that must perform every
    // write; it deliberately has NO `transactional` method so a nested
    // transaction would throw, proving the conversion runs in-line.
    const lockOptions: unknown[] = []
    const providedEm = {
      findOne: jest.fn(async () => null),
      find: jest.fn(async () => []),
      create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({ ...data })),
      persist: jest.fn(),
      nativeDelete: jest.fn(async () => 0),
      remove: jest.fn(),
      flush: jest.fn(async () => undefined),
    }
    // A container EM whose fork must never be called when a transactional EM is supplied.
    const containerEm = { fork: jest.fn() }

    mockedFindOneWithDecryption.mockImplementation(async (em, entity, _where, options) => {
      expect(em).toBe(providedEm)
      if (entity === SalesQuote) {
        lockOptions.push(readLockOption(options))
        return quote
      }
      if (entity === SalesOrder) return null
      return null
    })
    mockedFindWithDecryption.mockImplementation(async (em) => {
      expect(em).toBe(providedEm)
      return []
    })

    const container = createContainer({ injectionMode: InjectionMode.PROXY })
    container.register({
      em: asValue(containerEm),
      salesDocumentNumberGenerator: asValue({
        generate: jest.fn(async () => ({ number: 'SO-TX-1' })),
      }),
    })

    const ctx: CommandRuntimeContext = {
      container,
      auth: null,
      organizationScope: null,
      selectedOrganizationId: quote.organizationId,
      organizationIds: [quote.organizationId],
      transactionalEm: providedEm as unknown as CommandRuntimeContext['transactionalEm'],
    }

    const result = await handler!.execute(
      { quoteId: quote.id, orderId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' },
      ctx,
    )

    expect(result.orderId).toBe('dddddddd-dddd-4ddd-8ddd-dddddddddddd')
    expect(containerEm.fork).not.toHaveBeenCalled()
    expect(providedEm.persist).toHaveBeenCalled()
    expect(providedEm.remove).toHaveBeenCalledWith(quote)
    expect(providedEm.flush).toHaveBeenCalled()
    expect(lockOptions).toContainEqual({ lockMode: LockMode.PESSIMISTIC_WRITE })
  })
})

describe('sales.quotes.convert_to_order — shipping and surcharge totals', () => {
  beforeAll(async () => {
    await import('../documents')
  })

  type FeeRow = { kind: string; amountNet: string; amountGross: string }

  const shippingRow: FeeRow = { kind: 'shipping', amountNet: '15.0000', amountGross: '18.4500' }
  const surchargeRow: FeeRow = { kind: 'surcharge', amountNet: '5.0000', amountGross: '6.1500' }
  const discountRow: FeeRow = { kind: 'discount', amountNet: '10.0000', amountGross: '10.0000' }

  async function convertQuote(totalsSnapshot: unknown, rows: FeeRow[]): Promise<Record<string, unknown>> {
    const handler = commandRegistry.get<ConvertToOrderInput, ConvertToOrderResult>(
      'sales.quotes.convert_to_order',
    )
    expect(handler).toBeTruthy()

    const quote = {
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      organizationId: '22222222-2222-4222-8222-222222222222',
      tenantId: '33333333-3333-4333-8333-333333333333',
      createdAt: new Date('2026-04-12T08:00:00.000Z'),
      quoteNumber: 'SQ-FEES',
      statusEntryId: null,
      status: 'confirmed',
      currencyCode: 'USD',
      subtotalNetAmount: '110',
      subtotalGrossAmount: '137.6',
      discountTotalAmount: '10',
      taxTotalAmount: '23',
      grandTotalNetAmount: '110',
      grandTotalGrossAmount: '137.6',
      totalsSnapshot,
      lineItemCount: 1,
      validFrom: null,
      validUntil: null,
      deletedAt: null,
    }
    const quoteAdjustments = rows.map((row, index) => ({
      id: `ffffffff-ffff-4fff-8fff-00000000000${index}`,
      scope: 'order',
      kind: row.kind,
      code: null,
      label: null,
      calculatorKey: null,
      promotionId: null,
      rate: '0',
      amountNet: row.amountNet,
      amountGross: row.amountGross,
      currencyCode: 'USD',
      metadata: null,
      position: index,
      quoteLine: null,
    }))

    const em = {
      findOne: jest.fn(async () => null),
      find: jest.fn(async () => []),
      create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({ ...data })),
      persist: jest.fn(),
      nativeDelete: jest.fn(async () => 0),
      remove: jest.fn(),
      flush: jest.fn(async () => undefined),
    }
    mockedFindOneWithDecryption.mockImplementation(async (_em, entity) => (entity === SalesQuote ? quote : null))
    mockedFindWithDecryption.mockImplementation(async (_em, entity) =>
      entity === SalesQuoteAdjustment ? quoteAdjustments : [],
    )

    const container = createContainer({ injectionMode: InjectionMode.PROXY })
    container.register({
      em: asValue({ fork: jest.fn() }),
      salesDocumentNumberGenerator: asValue({ generate: jest.fn(async () => ({ number: 'SO-FEES-1' })) }),
    })
    const ctx: CommandRuntimeContext = {
      container,
      auth: null,
      organizationScope: null,
      selectedOrganizationId: quote.organizationId,
      organizationIds: [quote.organizationId],
      transactionalEm: em as unknown as CommandRuntimeContext['transactionalEm'],
    }

    await handler!.execute({ quoteId: quote.id }, ctx)

    const orderCall = em.create.mock.calls.find(([entity]) => entity === SalesOrder)
    expect(orderCall).toBeTruthy()
    return orderCall![1]
  }

  test('copies the quote shipping and surcharge buckets onto the order instead of zeroing them', async () => {
    const order = await convertQuote(
      {
        subtotalNetAmount: 110,
        subtotalGrossAmount: 137.6,
        discountTotalAmount: 10,
        taxTotalAmount: 23,
        shippingNetAmount: 15,
        shippingGrossAmount: 18.45,
        surchargeTotalAmount: 5,
        grandTotalNetAmount: 110,
        grandTotalGrossAmount: 137.6,
      },
      [shippingRow, surchargeRow, discountRow],
    )

    expect(order.shippingNetAmount).toBe('15')
    expect(order.shippingGrossAmount).toBe('18.45')
    expect(order.surchargeTotalAmount).toBe('5')
    expect(order.subtotalNetAmount).toBe('110')
    expect(order.subtotalGrossAmount).toBe('137.6')
    expect(order.discountTotalAmount).toBe('10')
    expect(order.taxTotalAmount).toBe('23')
    expect(order.grandTotalNetAmount).toBe('110')
    expect(order.grandTotalGrossAmount).toBe('137.6')
    expect(order.outstandingAmount).toBe('137.6')
  })

  test('takes the buckets from the totals snapshot when the adjustment rows disagree with it', async () => {
    const order = await convertQuote(
      { shippingNetAmount: 7, shippingGrossAmount: 8.61, surchargeTotalAmount: 2 },
      [shippingRow, surchargeRow],
    )

    expect(order.shippingNetAmount).toBe('7')
    expect(order.shippingGrossAmount).toBe('8.61')
    expect(order.surchargeTotalAmount).toBe('2')
  })

  test('derives the buckets from the copied adjustments when the quote has no totals snapshot', async () => {
    const order = await convertQuote(null, [shippingRow, surchargeRow, discountRow])

    expect(order.shippingNetAmount).toBe('15')
    expect(order.shippingGrossAmount).toBe('18.45')
    expect(order.surchargeTotalAmount).toBe('5')
  })

  test('keeps zero buckets for a quote without shipping or surcharge', async () => {
    const order = await convertQuote(
      { shippingNetAmount: 0, shippingGrossAmount: 0, surchargeTotalAmount: 0 },
      [discountRow],
    )

    expect(order.shippingNetAmount).toBe('0')
    expect(order.shippingGrossAmount).toBe('0')
    expect(order.surchargeTotalAmount).toBe('0')
  })
})
