/** @jest-environment node */

import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { SalesOrder, SalesPayment, SalesPaymentMethod, SalesRecurringPeriod } from '../../data/entities'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    dict: {},
    t: (key: string) => key,
    translate: (key: string) => key,
  }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn().mockResolvedValue(null),
  findWithDecryption: jest.fn().mockResolvedValue([]),
}))

jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({
  loadCustomFieldValues: jest.fn().mockResolvedValue({}),
}))

jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({
  emitCrudSideEffects: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@open-mercato/shared/lib/crud/cache', () => ({
  invalidateCrudCache: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@open-mercato/core/modules/entities/lib/helpers', () => ({
  setRecordCustomFields: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('../../../notifications/lib/notificationService', () => ({
  resolveNotificationService: jest.fn().mockReturnValue({
    createForFeature: jest.fn().mockResolvedValue(undefined),
  }),
}))

jest.mock('../../notifications', () => ({
  notificationTypes: [],
}))

jest.mock('../../lib/dictionaries', () => ({
  resolveDictionaryEntryValue: jest.fn().mockResolvedValue(null),
}))

const TENANT_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
const ORG_ID = 'bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb'
const ORDER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const PAYMENT_ID = 'dddddddd-dddd-4ddd-9ddd-dddddddddddd'
const METHOD_ID = 'eeeeeeee-eeee-4eee-aeee-eeeeeeeeeeee'
const LOCKED_METHOD_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff'

type Fixture = {
  order: Record<string, unknown>
  periods: Array<{ id: string }>
}

function buildOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: ORDER_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    deletedAt: null,
    currencyCode: 'USD',
    paymentMethodId: null,
    paymentMethodCode: null,
    orderNumber: 'ORD-001',
    grandTotalGrossAmount: '100',
    paidTotalAmount: '0',
    refundedTotalAmount: '0',
    outstandingAmount: '100',
    ...overrides,
  }
}

function mockLookups(fixture: Fixture) {
  ;(findOneWithDecryption as jest.Mock).mockImplementation(async (_em: unknown, entity: unknown, filter: Record<string, unknown>) => {
    if (entity === SalesOrder && filter?.id === ORDER_ID) return fixture.order
    if (entity === SalesPaymentMethod) {
      return { id: filter.id, code: 'card', tenantId: TENANT_ID, organizationId: ORG_ID }
    }
    if (entity === SalesPayment) return { id: PAYMENT_ID, order: { id: ORDER_ID }, tenantId: TENANT_ID, organizationId: ORG_ID }
    return null
  })
  ;(findWithDecryption as jest.Mock).mockImplementation(async (_em: unknown, entity: unknown) => {
    if (entity === SalesRecurringPeriod) return fixture.periods
    return []
  })
}

function buildMockEm(): Record<string, jest.Mock> {
  const em: Record<string, jest.Mock> = {
    findOne: jest.fn().mockResolvedValue(null),
    find: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
    create: jest.fn().mockImplementation((_entity: unknown, data: Record<string, unknown>) => ({ ...data, id: data.id ?? PAYMENT_ID })),
    persist: jest.fn(),
    remove: jest.fn(),
    flush: jest.fn().mockResolvedValue(undefined),
    getReference: jest.fn().mockImplementation((_entity: unknown, id: unknown) => ({ id })),
    transactional: jest.fn(),
    fork: jest.fn(),
  }
  em.transactional.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback(em))
  em.fork.mockReturnValue(em)
  return em
}

function buildCtx() {
  const em = buildMockEm()
  return {
    container: {
      resolve: jest.fn().mockImplementation((name: string) => (name === 'em' ? em : {})),
    },
    auth: { tenantId: TENANT_ID, orgId: ORG_ID },
    selectedOrganizationId: ORG_ID,
    organizationIds: [ORG_ID],
    request: {} as Request,
    organizationScope: null,
  }
}

function createInput() {
  return {
    orderId: ORDER_ID,
    paymentMethodId: METHOD_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    amount: 50,
    currencyCode: 'USD',
  }
}

function paymentSnapshot() {
  return {
    id: PAYMENT_ID,
    orderId: ORDER_ID,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    paymentMethodId: METHOD_ID,
    paymentReference: null,
    statusEntryId: null,
    status: null,
    amount: 50,
    currencyCode: 'USD',
    capturedAmount: 0,
    refundedAmount: 0,
    receivedAt: null,
    capturedAt: null,
    metadata: null,
    customFields: null,
    allocations: [],
  }
}

describe('sales.payments.create — payment method on an invoiced recurring order (R5)', () => {
  beforeAll(async () => {
    await import('../payments')
  })

  beforeEach(() => {
    ;(findOneWithDecryption as jest.Mock).mockReset()
    ;(findWithDecryption as jest.Mock).mockReset()
  })

  const command = () => commandRegistry.get('sales.payments.create')!

  it('records the payment without giving a locked order a payment method', async () => {
    const fixture: Fixture = { order: buildOrder(), periods: [{ id: 'period-1' }] }
    mockLookups(fixture)

    await command().execute(createInput(), buildCtx() as never)

    expect(fixture.order.paymentMethodId).toBeNull()
    expect(fixture.order.paymentMethodCode).toBeNull()
  })

  it('still adopts the payment method on an order without issued periods', async () => {
    const fixture: Fixture = { order: buildOrder(), periods: [] }
    mockLookups(fixture)

    await command().execute(createInput(), buildCtx() as never)

    expect(fixture.order.paymentMethodId).toBe(METHOD_ID)
    expect(fixture.order.paymentMethodCode).toBe('card')
  })

  it('undo keeps the payment method of an order that was invoiced after the payment', async () => {
    const fixture: Fixture = {
      order: buildOrder({ paymentMethodId: LOCKED_METHOD_ID, paymentMethodCode: 'locked' }),
      periods: [{ id: 'period-1' }],
    }
    mockLookups(fixture)
    const logEntry = {
      payload: { undo: { after: paymentSnapshot(), orderPaymentMethodIdBefore: null, orderPaymentMethodCodeBefore: null } },
    }

    await command().undo!({ logEntry: logEntry as never, ctx: buildCtx() as never })

    expect(fixture.order.paymentMethodId).toBe(LOCKED_METHOD_ID)
    expect(fixture.order.paymentMethodCode).toBe('locked')
  })

  it('undo still restores the previous payment method on an order without issued periods', async () => {
    const fixture: Fixture = {
      order: buildOrder({ paymentMethodId: METHOD_ID, paymentMethodCode: 'card' }),
      periods: [],
    }
    mockLookups(fixture)
    const logEntry = {
      payload: { undo: { after: paymentSnapshot(), orderPaymentMethodIdBefore: null, orderPaymentMethodCodeBefore: null } },
    }

    await command().undo!({ logEntry: logEntry as never, ctx: buildCtx() as never })

    expect(fixture.order.paymentMethodId).toBeNull()
    expect(fixture.order.paymentMethodCode).toBeNull()
  })

  it('redo does not give a locked order a payment method', async () => {
    const fixture: Fixture = { order: buildOrder(), periods: [{ id: 'period-1' }] }
    mockLookups(fixture)
    const logEntry = { resourceId: PAYMENT_ID, snapshotAfter: paymentSnapshot(), payload: { undo: { after: paymentSnapshot() } } }

    await command().redo!({ logEntry: logEntry as never, ctx: buildCtx() as never })

    expect(fixture.order.paymentMethodId).toBeNull()
  })

  it('redo still adopts the payment method on an order without issued periods', async () => {
    const fixture: Fixture = { order: buildOrder(), periods: [] }
    mockLookups(fixture)
    const logEntry = { resourceId: PAYMENT_ID, snapshotAfter: paymentSnapshot(), payload: { undo: { after: paymentSnapshot() } } }

    await command().redo!({ logEntry: logEntry as never, ctx: buildCtx() as never })

    expect(fixture.order.paymentMethodId).toBe(METHOD_ID)
  })
})
