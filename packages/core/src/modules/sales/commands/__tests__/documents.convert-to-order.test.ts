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

describe('sales.quote.convert_to_order', () => {
  beforeAll(async () => {
    commandRegistry.clear?.()
    await import('../documents')
  })

  test('serializes concurrent conversions on the same quote with a pessimistic lock', async () => {
    const handler = commandRegistry.get<ConvertToOrderInput, ConvertToOrderResult>(
      'sales.quote.convert_to_order',
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
})
