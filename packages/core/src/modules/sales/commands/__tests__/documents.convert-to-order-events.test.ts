/** @jest-environment node */

import { asValue, createContainer, InjectionMode } from 'awilix'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands/types'
import {
  beginTransactionLifetime,
  completeTransactionLifetime,
} from '@open-mercato/shared/lib/commands/transaction-lifetime'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { SalesOrder, SalesQuote } from '@open-mercato/core/modules/sales/data/entities'

type ConvertToOrderInput = { quoteId: string; orderId?: string; orderNumber?: string }
type ConvertToOrderResult = { orderId: string }

type MarkedChange = {
  action: string
  identifiers: { id: string; organizationId: string | null; tenantId: string | null }
  events?: { module: string; entity: string; persistent?: boolean }
  indexer?: { entityType: string }
  actorUserId?: string | null
}

const mockCreateForFeature = jest.fn(async () => [])

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

jest.mock('@open-mercato/core/modules/notifications/lib/notificationService', () => ({
  resolveNotificationService: () => ({ createForFeature: mockCreateForFeature }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(async () => []),
  findOneWithDecryption: jest.fn(),
}))

const mockedFindOneWithDecryption = jest.mocked(findOneWithDecryption)
const mockedFindWithDecryption = jest.mocked(findWithDecryption)

const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'
const TENANT_ID = '33333333-3333-4333-8333-333333333333'
const QUOTE_ID = '11111111-1111-4111-8111-111111111111'
const ORDER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

function buildQuote() {
  return {
    id: QUOTE_ID,
    organizationId: ORGANIZATION_ID,
    tenantId: TENANT_ID,
    createdAt: new Date('2026-04-12T08:00:00.000Z'),
    quoteNumber: 'SQ-6491',
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
}

function readWhereId(where: unknown): unknown {
  if (where && typeof where === 'object' && 'id' in where) return where.id
  return undefined
}

function setup(options: { existingOrder?: boolean; callerTransaction?: boolean } = {}) {
  const quote = buildQuote()
  const timeline: string[] = []
  const marked: MarkedChange[] = []
  const em = {
    fork: jest.fn(),
    transactional: jest.fn(async (callback: (trx: unknown) => Promise<unknown>) => {
      timeline.push('transaction:begin')
      const result = await callback(em)
      timeline.push('transaction:commit')
      return result
    }),
    findOne: jest.fn(async () => null),
    find: jest.fn(async () => []),
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({ ...data })),
    persist: jest.fn(),
    nativeDelete: jest.fn(async () => 0),
    remove: jest.fn(),
    flush: jest.fn(async () => undefined),
  }
  em.fork.mockReturnValue(em)

  mockedFindOneWithDecryption.mockImplementation(async (_em, entity, where) => {
    if (entity === SalesQuote) return readWhereId(where) === quote.id ? quote : null
    if (entity === SalesOrder) return options.existingOrder ? { id: readWhereId(where), deletedAt: null } : null
    return null
  })
  mockedFindWithDecryption.mockImplementation(async () => [])

  const dataEngine = {
    markOrmEntityChange: jest.fn((change: MarkedChange) => {
      timeline.push('side-effect:marked')
      marked.push(change)
    }),
    flushOrmEntityChanges: jest.fn(async () => {
      timeline.push('side-effect:flushed')
    }),
  }

  const container = createContainer({ injectionMode: InjectionMode.PROXY })
  container.register({
    em: asValue(em),
    dataEngine: asValue(dataEngine),
    eventBus: asValue({ emit: jest.fn() }),
    salesDocumentNumberGenerator: asValue({
      generate: jest.fn(async () => ({ number: 'ORDER-6491' })),
    }),
  })

  const ctx: CommandRuntimeContext = {
    container,
    auth: { sub: 'user-6491', tenantId: TENANT_ID, orgId: ORGANIZATION_ID } as CommandRuntimeContext['auth'],
    organizationScope: null,
    selectedOrganizationId: ORGANIZATION_ID,
    organizationIds: [ORGANIZATION_ID],
    ...(options.callerTransaction
      ? { transactionalEm: em as unknown as CommandRuntimeContext['transactionalEm'] }
      : {}),
  }

  return { ctx, em, marked, timeline, dataEngine }
}

function orderCreatedChanges(marked: MarkedChange[]) {
  return marked.filter(
    (change) =>
      change.events &&
      `${change.events.module}.${change.events.entity}.${change.action}` === 'sales.order.created',
  )
}

describe('sales.quotes.convert_to_order — sales.order.created side effect (#6491)', () => {
  beforeAll(async () => {
    commandRegistry.clear?.()
    await import('../documents')
  })

  beforeEach(() => {
    mockCreateForFeature.mockClear()
  })

  function getHandler() {
    const handler = commandRegistry.get<ConvertToOrderInput, ConvertToOrderResult>(
      'sales.quotes.convert_to_order',
    )
    expect(handler).toBeTruthy()
    return handler!
  }

  test('marks exactly one persistent sales.order.created change for the converted order, after commit', async () => {
    const { ctx, marked, timeline } = setup()

    const result = await getHandler().execute({ quoteId: QUOTE_ID, orderId: ORDER_ID }, ctx)

    expect(result.orderId).toBe(ORDER_ID)
    const created = orderCreatedChanges(marked)
    expect(created).toHaveLength(1)
    expect(created[0].identifiers).toEqual({
      id: ORDER_ID,
      organizationId: ORGANIZATION_ID,
      tenantId: TENANT_ID,
    })
    expect(created[0].events?.persistent).toBe(true)
    expect(created[0].indexer).toEqual({ entityType: 'sales.sales_order' })
    expect(created[0].actorUserId).toBe('user-6491')
    expect(timeline.indexOf('side-effect:marked')).toBeGreaterThan(
      timeline.indexOf('transaction:commit'),
    )
  })

  test('creates the sales.order.created notification for the converted order', async () => {
    const { ctx } = setup()

    await getHandler().execute({ quoteId: QUOTE_ID, orderId: ORDER_ID }, ctx)

    expect(mockCreateForFeature).toHaveBeenCalledTimes(1)
    expect(mockCreateForFeature).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'sales.order.created',
        sourceEntityId: ORDER_ID,
        requiredFeature: 'sales.orders.manage',
      }),
      { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID },
    )
  })

  test('marks the change once when joining the caller transaction (quote acceptance)', async () => {
    const { ctx, em, marked } = setup({ callerTransaction: true })

    await getHandler().execute({ quoteId: QUOTE_ID, orderId: ORDER_ID }, ctx)

    expect(em.transactional).not.toHaveBeenCalled()
    expect(orderCreatedChanges(marked)).toHaveLength(1)
  })

  test('defers the mark, flush and notification until the caller transaction commits (quote acceptance)', async () => {
    const { ctx, em, marked, timeline, dataEngine } = setup({ callerTransaction: true })
    const transactionEm = em as unknown as Parameters<typeof beginTransactionLifetime>[0]
    const lifetime = beginTransactionLifetime(transactionEm)

    await getHandler().execute({ quoteId: QUOTE_ID, orderId: ORDER_ID }, ctx)

    expect(marked).toHaveLength(0)
    expect(dataEngine.flushOrmEntityChanges).not.toHaveBeenCalled()
    expect(mockCreateForFeature).not.toHaveBeenCalled()

    timeline.push('caller:commit')
    await completeTransactionLifetime(transactionEm, lifetime, 'committed')

    expect(orderCreatedChanges(marked)).toHaveLength(1)
    expect(orderCreatedChanges(marked)[0].identifiers.id).toBe(ORDER_ID)
    expect(dataEngine.flushOrmEntityChanges).toHaveBeenCalledTimes(1)
    expect(mockCreateForFeature).toHaveBeenCalledTimes(1)
    expect(timeline.indexOf('side-effect:marked')).toBeGreaterThan(timeline.indexOf('caller:commit'))
    expect(timeline.indexOf('side-effect:flushed')).toBeGreaterThan(timeline.indexOf('side-effect:marked'))
  })

  test('emits nothing when the caller transaction rolls back (quote acceptance)', async () => {
    const { ctx, em, marked, dataEngine } = setup({ callerTransaction: true })
    const transactionEm = em as unknown as Parameters<typeof beginTransactionLifetime>[0]
    const lifetime = beginTransactionLifetime(transactionEm)

    await getHandler().execute({ quoteId: QUOTE_ID, orderId: ORDER_ID }, ctx)
    await completeTransactionLifetime(transactionEm, lifetime, 'rolled_back')

    expect(marked).toHaveLength(0)
    expect(dataEngine.flushOrmEntityChanges).not.toHaveBeenCalled()
    expect(mockCreateForFeature).not.toHaveBeenCalled()
  })

  test('marks nothing when the conversion fails', async () => {
    const { ctx, marked } = setup({ existingOrder: true })

    await expect(
      getHandler().execute({ quoteId: QUOTE_ID, orderId: ORDER_ID }, ctx),
    ).rejects.toBeInstanceOf(CrudHttpError)

    expect(marked).toHaveLength(0)
    expect(mockCreateForFeature).not.toHaveBeenCalled()
  })
})
