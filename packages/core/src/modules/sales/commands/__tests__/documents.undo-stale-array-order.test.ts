/** @jest-environment node */

/**
 * Order undo answers 409 when a shipment or payment on the order changed after the
 * logged write. The staleness check must keep array order inside JSON values
 * (`metadata`, `trackingNumbers`), so an edit that only reorders such an array
 * counts as a change. Collections that read back without a stable order (payment
 * allocations, shipment items, multi-value custom fields) must still match in any
 * order, or undo would answer a false 409.
 */

import { createContainer, asValue, InjectionMode } from 'awilix'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { E } from '#generated/entities.ids.generated'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    dict: {},
    t: (key: string, fallback?: string) => fallback ?? key,
    translate: (key: string, fallback?: string) => fallback ?? key,
  }),
}))

jest.mock('@open-mercato/shared/lib/crud/cache', () => ({
  invalidateCrudCache: jest.fn(),
}))

jest.mock('@open-mercato/core/modules/entities/lib/helpers', () => {
  const actual = jest.requireActual('@open-mercato/core/modules/entities/lib/helpers')
  return { ...actual, setRecordCustomFields: jest.fn(async () => {}) }
})

type StoredState = {
  order: Record<string, unknown>
  shipment: Record<string, unknown>
  payment: Record<string, unknown>
  customFieldRows: Array<Record<string, unknown>>
  customFieldDefs: Array<Record<string, unknown>>
}

const state: { current: StoredState | null } = { current: null }

const entityName = (entity: unknown): string =>
  typeof entity === 'function' ? entity.name : String(entity)

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(async (_em: unknown, entity: unknown) => {
    const name = typeof entity === 'function' ? entity.name : String(entity)
    if (name === 'SalesOrder') return state.current?.order ?? null
    if (name === 'SalesPayment') return state.current?.payment ?? null
    return null
  }),
  findWithDecryption: jest.fn(async () => []),
}))

const ORG_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const TENANT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const ORDER_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const SHIPMENT_ID = '11111111-1111-4111-8111-111111111111'
const PAYMENT_ID = '22222222-2222-4222-8222-222222222222'
const ORDER_LINE_A = '33333333-3333-4333-8333-333333333333'
const ORDER_LINE_B = '44444444-4444-4444-8444-444444444444'
const ITEM_A = '55555555-5555-4555-8555-555555555555'
const ITEM_B = '66666666-6666-4666-8666-666666666666'
const ALLOCATION_A = '77777777-7777-4777-8777-777777777777'
const ALLOCATION_B = '88888888-8888-4888-8888-888888888888'

const shipmentItem = (id: string, orderLineId: string, quantity: number) => ({
  id,
  orderLineId,
  orderLineName: null,
  orderLineNumber: null,
  quantity,
  metadata: { scans: ['first', 'second'] },
})

const shipmentItemEntity = (id: string, orderLineId: string, quantity: number) => ({
  id,
  orderLine: { id: orderLineId, name: null, lineNumber: null },
  quantity: String(quantity),
  metadata: { scans: ['first', 'second'] },
})

const allocation = (id: string, amount: number, note: string) => ({
  id,
  order: { id: ORDER_ID },
  invoice: null,
  amount: String(amount),
  currencyCode: 'USD',
  metadata: { note },
})

function buildStoredState(): StoredState {
  return {
    order: {
      id: ORDER_ID,
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      orderNumber: 'SO-1',
      currencyCode: 'USD',
    },
    shipment: {
      id: SHIPMENT_ID,
      order: { id: ORDER_ID },
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      trackingNumbers: ['TRACK-1', 'TRACK-2'],
      metadata: { checkpoints: ['packed', 'shipped'] },
      itemsSnapshot: [shipmentItem(ITEM_A, ORDER_LINE_A, 1), shipmentItem(ITEM_B, ORDER_LINE_B, 2)],
      items: [],
    },
    payment: {
      id: PAYMENT_ID,
      order: { id: ORDER_ID },
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      amount: '10',
      currencyCode: 'USD',
      capturedAmount: '0',
      refundedAmount: '0',
      metadata: { attempts: ['declined', 'approved'] },
      allocations: [allocation(ALLOCATION_A, 4, 'first'), allocation(ALLOCATION_B, 6, 'second')],
    },
    customFieldRows: ['gift', 'priority'].map((value) => ({
      entityId: E.sales.sales_payment,
      recordId: PAYMENT_ID,
      fieldKey: 'labels',
      valueText: value,
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
    })),
    customFieldDefs: [
      {
        entityId: E.sales.sales_payment,
        key: 'labels',
        configJson: { multi: true },
        organizationId: ORG_ID,
        tenantId: TENANT_ID,
        isActive: true,
      },
    ],
  }
}

function buildLoggedGraph() {
  return {
    order: {
      id: ORDER_ID,
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      orderNumber: 'SO-1',
      currencyCode: 'USD',
    },
    lines: [],
    adjustments: [],
    addresses: [],
    notes: [],
    tags: [],
    shipments: [
      {
        id: SHIPMENT_ID,
        orderId: ORDER_ID,
        organizationId: ORG_ID,
        tenantId: TENANT_ID,
        shipmentNumber: null,
        shippingMethodId: null,
        statusEntryId: null,
        status: null,
        carrierName: null,
        trackingNumbers: ['TRACK-1', 'TRACK-2'],
        shippedAt: null,
        deliveredAt: null,
        weightValue: null,
        weightUnit: null,
        declaredValueNet: null,
        declaredValueGross: null,
        currencyCode: null,
        notesText: null,
        metadata: { checkpoints: ['packed', 'shipped'] },
        customFields: null,
        items: [shipmentItem(ITEM_A, ORDER_LINE_A, 1), shipmentItem(ITEM_B, ORDER_LINE_B, 2)],
        itemsSnapshot: [shipmentItem(ITEM_A, ORDER_LINE_A, 1), shipmentItem(ITEM_B, ORDER_LINE_B, 2)],
      },
    ],
    payments: [
      {
        id: PAYMENT_ID,
        orderId: ORDER_ID,
        organizationId: ORG_ID,
        tenantId: TENANT_ID,
        paymentMethodId: null,
        paymentReference: null,
        statusEntryId: null,
        status: null,
        amount: 10,
        currencyCode: 'USD',
        capturedAmount: 0,
        refundedAmount: 0,
        receivedAt: null,
        capturedAt: null,
        metadata: { attempts: ['declined', 'approved'] },
        customFields: { cf_labels: ['gift', 'priority'] },
        customFieldSetId: null,
        allocations: [
          { id: ALLOCATION_A, orderId: ORDER_ID, invoiceId: null, amount: 4, currencyCode: 'USD', metadata: { note: 'first' } },
          { id: ALLOCATION_B, orderId: ORDER_ID, invoiceId: null, amount: 6, currencyCode: 'USD', metadata: { note: 'second' } },
        ],
      },
    ],
  }
}

function makeEm() {
  const em: Record<string, unknown> = {
    fork: () => em,
    transactional: async (cb: (tx: unknown) => Promise<unknown>) => cb(em),
    clear: jest.fn(),
    find: jest.fn(async (entity: unknown) => {
      const stored = state.current
      if (!stored) return []
      switch (entityName(entity)) {
        case 'SalesShipment':
          return [{ id: stored.shipment.id }]
        case 'SalesPayment':
          return [{ id: stored.payment.id }]
        case 'CustomFieldValue':
          return stored.customFieldRows
        case 'CustomFieldDef':
          return stored.customFieldDefs
        default:
          return []
      }
    }),
    findOne: jest.fn(async (entity: unknown) =>
      entityName(entity) === 'SalesShipment' ? state.current?.shipment ?? null : null,
    ),
    count: jest.fn(async () => 0),
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({ ...data })),
    persist: jest.fn(),
    remove: jest.fn(),
    nativeDelete: jest.fn(async () => 0),
    flush: jest.fn(async () => {}),
    getReference: jest.fn((_entity: unknown, id: string) => ({ id })),
    getUnitOfWork: () => ({ unsetIdentity: jest.fn() }),
    getConnection: () => ({ execute: jest.fn(async () => [{ value: 1 }]) }),
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
  }
}

type LoggedGraph = ReturnType<typeof buildLoggedGraph>

async function undoOrderUpdate(
  stored: StoredState,
  adjustLogged: (graph: LoggedGraph) => void = () => {},
): Promise<{ status: number | null; em: Record<string, unknown> }> {
  state.current = stored
  const em = makeEm()
  const handler = commandRegistry.get('sales.orders.update')!
  const logged = buildLoggedGraph()
  adjustLogged(logged)
  try {
    await handler.undo?.({
      logEntry: { commandPayload: { undo: { before: logged, after: logged } } },
      ctx: makeCtx(em),
      input: {},
    } as never)
    return { status: null, em }
  } catch (error) {
    const status = (error as { status?: unknown }).status
    if (typeof status === 'number') return { status, em }
    throw error
  }
}

describe('order undo staleness check keeps array order inside JSON values', () => {
  beforeAll(async () => {
    commandRegistry.clear?.()
    await import('../documents')
  })

  afterEach(() => {
    state.current = null
  })

  it('undoes when the shipment and payment still match the logged snapshot', async () => {
    const { status, em } = await undoOrderUpdate(buildStoredState())
    expect(status).toBeNull()
    expect(em.flush).toHaveBeenCalled()
  })

  it('answers 409 when another actor only reordered an array in payment metadata', async () => {
    const stored = buildStoredState()
    stored.payment.metadata = { attempts: ['approved', 'declined'] }
    const { status, em } = await undoOrderUpdate(stored)
    expect(status).toBe(409)
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('answers 409 when another actor only reordered an array in allocation metadata', async () => {
    const stored = buildStoredState()
    stored.payment.allocations = [
      { ...allocation(ALLOCATION_A, 4, 'first'), metadata: { note: 'first', tags: ['b', 'a'] } },
      allocation(ALLOCATION_B, 6, 'second'),
    ]
    const { status } = await undoOrderUpdate(stored, (graph) => {
      graph.payments[0].allocations[0].metadata = { note: 'first', tags: ['a', 'b'] }
    })
    expect(status).toBe(409)
  })

  it('answers 409 when another actor only reordered the shipment tracking numbers', async () => {
    const stored = buildStoredState()
    stored.shipment.trackingNumbers = ['TRACK-2', 'TRACK-1']
    const { status } = await undoOrderUpdate(stored)
    expect(status).toBe(409)
  })

  it('answers 409 when another actor only reordered an array in shipment metadata', async () => {
    const stored = buildStoredState()
    stored.shipment.metadata = { checkpoints: ['shipped', 'packed'] }
    const { status } = await undoOrderUpdate(stored)
    expect(status).toBe(409)
  })

  it('answers 409 when another actor only reordered an array in shipment item metadata', async () => {
    const stored = buildStoredState()
    stored.shipment.itemsSnapshot = [
      { ...shipmentItem(ITEM_A, ORDER_LINE_A, 1), metadata: { scans: ['second', 'first'] } },
      shipmentItem(ITEM_B, ORDER_LINE_B, 2),
    ]
    const { status } = await undoOrderUpdate(stored)
    expect(status).toBe(409)
  })

  it('undoes when payment allocations read back in another order', async () => {
    const stored = buildStoredState()
    stored.payment.allocations = [allocation(ALLOCATION_B, 6, 'second'), allocation(ALLOCATION_A, 4, 'first')]
    const { status } = await undoOrderUpdate(stored)
    expect(status).toBeNull()
  })

  it('undoes when shipment items without a stored snapshot read back in another order', async () => {
    const stored = buildStoredState()
    stored.shipment.itemsSnapshot = null
    stored.shipment.items = [shipmentItemEntity(ITEM_B, ORDER_LINE_B, 2), shipmentItemEntity(ITEM_A, ORDER_LINE_A, 1)]
    const { status } = await undoOrderUpdate(stored)
    expect(status).toBeNull()
  })

  it('undoes when multi-value custom field values read back in another order', async () => {
    const stored = buildStoredState()
    stored.customFieldRows = [...stored.customFieldRows].reverse()
    const { status } = await undoOrderUpdate(stored)
    expect(status).toBeNull()
  })
})
