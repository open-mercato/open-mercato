/** @jest-environment node */

import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { setRecordCustomFields } from '@open-mercato/core/modules/entities/lib/helpers'
import { E } from '#generated/entities.ids.generated'

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

const TEST_TENANT_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
const TEST_ORG_ID = 'bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb'
const TEST_ORDER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const TEST_PAYMENT_ID = 'dddddddd-dddd-4ddd-9ddd-dddddddddddd'
const EXISTING_ALLOCATION_ID = 'eeeeeeee-eeee-4eee-aeee-eeeeeeeeeeee'

function buildMockEm(overrides: Record<string, unknown> = {}) {
  return {
    findOne: jest.fn().mockResolvedValue(null),
    find: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockImplementation(
      (_entity: unknown, data: Record<string, unknown>) => ({ ...data, id: data.id ?? TEST_PAYMENT_ID })
    ),
    persist: jest.fn(),
    remove: jest.fn(),
    nativeDelete: jest.fn().mockResolvedValue(0),
    nativeUpdate: jest.fn().mockResolvedValue(1),
    flush: jest.fn().mockResolvedValue(undefined),
    getReference: jest.fn().mockImplementation((_entity: unknown, id: unknown) => ({ id })),
    transactional: jest.fn().mockImplementation(async (callback: (tx: any) => Promise<any>) => {
      const self = buildMockEm(overrides)
      return callback(self)
    }),
    ...overrides,
  }
}

function buildCommandCtx(emOverrides: Record<string, unknown> = {}) {
  const em = buildMockEm(emOverrides)
  const container = {
    resolve: jest.fn().mockImplementation((name: string) => {
      if (name === 'em') return { fork: jest.fn().mockReturnValue(em) }
      if (name === 'dataEngine') return {}
      return {}
    }),
  }
  const ctx = {
    container,
    auth: { tenantId: TEST_TENANT_ID, orgId: TEST_ORG_ID },
    selectedOrganizationId: TEST_ORG_ID,
    organizationIds: [TEST_ORG_ID],
    request: {} as Request,
    organizationScope: null,
  }
  return { em, container, ctx }
}

const mockOrder = {
  id: TEST_ORDER_ID,
  tenantId: TEST_TENANT_ID,
  organizationId: TEST_ORG_ID,
  deletedAt: null,
  currencyCode: 'USD',
  paymentMethodId: null,
  paymentMethodCode: null,
  orderNumber: 'ORD-001',
  grandTotalGrossAmount: '100',
  paidTotalAmount: '0',
  refundedTotalAmount: '0',
  outstandingAmount: '100',
  updatedAt: new Date(),
}

describe('payment allocations expose custom fields (issue #8068)', () => {
  beforeAll(async () => {
    commandRegistry.clear?.()
    await import('../payments')
  })

  beforeEach(() => {
    ;(findOneWithDecryption as jest.Mock).mockReset().mockResolvedValue(mockOrder)
    ;(findWithDecryption as jest.Mock).mockReset().mockResolvedValue([])
    ;(setRecordCustomFields as jest.Mock).mockClear()
  })

  it('create writes customFields for a payment allocation keyed by its own record id', async () => {
    const execute = commandRegistry.get('sales.payments.create')?.execute
    expect(execute).toBeInstanceOf(Function)

    const { ctx } = buildCommandCtx()

    await execute?.(
      {
        orderId: TEST_ORDER_ID,
        tenantId: TEST_TENANT_ID,
        organizationId: TEST_ORG_ID,
        amount: 100,
        currencyCode: 'USD',
        allocations: [
          { orderId: TEST_ORDER_ID, amount: 100, currencyCode: 'USD', customFields: { ref: 'abc' } },
        ],
      },
      ctx as any,
    )

    const allocationCall = (setRecordCustomFields as jest.Mock).mock.calls.find(
      (args: unknown[]) => (args[1] as Record<string, unknown>)?.entityId === E.sales.sales_payment_allocation,
    )
    expect(allocationCall).toBeDefined()
    expect((allocationCall?.[1] as Record<string, unknown>)?.values).toEqual({ ref: 'abc' })
    expect(typeof (allocationCall?.[1] as Record<string, unknown>)?.recordId).toBe('string')
  })

  it('create does not write customFields for an allocation that omits them', async () => {
    const execute = commandRegistry.get('sales.payments.create')?.execute
    const { ctx } = buildCommandCtx()

    await execute?.(
      {
        orderId: TEST_ORDER_ID,
        tenantId: TEST_TENANT_ID,
        organizationId: TEST_ORG_ID,
        amount: 100,
        currencyCode: 'USD',
        allocations: [{ orderId: TEST_ORDER_ID, amount: 100, currencyCode: 'USD' }],
      },
      ctx as any,
    )

    const allocationCall = (setRecordCustomFields as jest.Mock).mock.calls.find(
      (args: unknown[]) => (args[1] as Record<string, unknown>)?.entityId === E.sales.sales_payment_allocation,
    )
    expect(allocationCall).toBeUndefined()
  })

  it('update purges stale allocation custom field rows before replacing allocations', async () => {
    const execute = commandRegistry.get('sales.payments.update')?.execute
    expect(execute).toBeInstanceOf(Function)

    const mockPayment = {
      id: TEST_PAYMENT_ID,
      tenantId: TEST_TENANT_ID,
      organizationId: TEST_ORG_ID,
      order: mockOrder,
      paymentMethod: null,
      paymentReference: null,
      statusEntryId: null,
      status: null,
      amount: '100',
      currencyCode: 'USD',
      capturedAmount: '0',
      refundedAmount: '0',
      receivedAt: null,
      capturedAt: null,
      metadata: null,
      customFieldSetId: null,
      updatedAt: new Date(),
    }
    const existingAllocation = { id: EXISTING_ALLOCATION_ID, order: TEST_ORDER_ID, invoice: null }

    ;(findOneWithDecryption as jest.Mock)
      .mockResolvedValueOnce(mockPayment) // scopeSeed lookup
      .mockResolvedValueOnce(mockPayment) // payment lookup (with populate: ['order'])
      .mockResolvedValue(mockOrder) // any further order lookups (locking, allocation refs)
    ;(findWithDecryption as jest.Mock).mockImplementation((_em: unknown, _entity: unknown, filter: Record<string, unknown>) => {
      if (filter?.payment !== undefined) return Promise.resolve([existingAllocation])
      return Promise.resolve([])
    })

    let capturedTx: any
    const { ctx } = buildCommandCtx({
      transactional: jest.fn().mockImplementation(async (callback: (tx: any) => Promise<unknown>) => {
        capturedTx = buildMockEm()
        return callback(capturedTx)
      }),
    })

    await execute?.(
      {
        id: TEST_PAYMENT_ID,
        tenantId: TEST_TENANT_ID,
        organizationId: TEST_ORG_ID,
        allocations: [
          { orderId: TEST_ORDER_ID, amount: 100, currencyCode: 'USD', customFields: { ref: 'xyz' } },
        ],
      },
      ctx as any,
    )

    expect(capturedTx.nativeDelete).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        entityId: E.sales.sales_payment_allocation,
        recordId: { $in: [EXISTING_ALLOCATION_ID] },
        $or: [{ tenantId: TEST_TENANT_ID }, { tenantId: null }],
      }),
    )
    const allocationCall = (setRecordCustomFields as jest.Mock).mock.calls.find(
      (args: unknown[]) => (args[1] as Record<string, unknown>)?.entityId === E.sales.sales_payment_allocation,
    )
    expect(allocationCall).toBeDefined()
    expect((allocationCall?.[1] as Record<string, unknown>)?.values).toEqual({ ref: 'xyz' })
  })

  it('create-undo purges allocation custom field rows before removing allocations (issue #10904 review)', async () => {
    const undo = commandRegistry.get('sales.payments.create')?.undo
    expect(undo).toBeInstanceOf(Function)

    const existingAllocation = { id: EXISTING_ALLOCATION_ID, order: TEST_ORDER_ID, invoice: null }
    const existingPayment = {
      id: TEST_PAYMENT_ID,
      tenantId: TEST_TENANT_ID,
      organizationId: TEST_ORG_ID,
      order: { id: TEST_ORDER_ID },
    }

    ;(findOneWithDecryption as jest.Mock)
      .mockResolvedValueOnce(existingPayment) // payment lookup inside undo
      .mockResolvedValue(mockOrder) // further order lookups (locking)
    ;(findWithDecryption as jest.Mock).mockImplementation((_em: unknown, _entity: unknown, filter: Record<string, unknown>) => {
      if (filter?.payment !== undefined) return Promise.resolve([existingAllocation])
      return Promise.resolve([])
    })

    let capturedTx: any
    const { ctx } = buildCommandCtx({
      transactional: jest.fn().mockImplementation(async (callback: (tx: any) => Promise<unknown>) => {
        capturedTx = buildMockEm()
        return callback(capturedTx)
      }),
    })

    const after = {
      id: TEST_PAYMENT_ID,
      orderId: TEST_ORDER_ID,
      organizationId: TEST_ORG_ID,
      tenantId: TEST_TENANT_ID,
      paymentMethodId: null,
      paymentReference: null,
      statusEntryId: null,
      status: null,
      amount: 100,
      currencyCode: 'USD',
      capturedAmount: 0,
      refundedAmount: 0,
      receivedAt: null,
      capturedAt: null,
      metadata: null,
      allocations: [],
    }
    const logEntry = {
      payload: { undo: { after, orderPaymentMethodIdBefore: null, orderPaymentMethodCodeBefore: null } },
    }

    await undo?.({ logEntry: logEntry as any, ctx: ctx as any })

    expect(capturedTx.nativeDelete).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        entityId: E.sales.sales_payment_allocation,
        recordId: { $in: [EXISTING_ALLOCATION_ID] },
        $or: [{ tenantId: TEST_TENANT_ID }, { tenantId: null }],
      }),
    )
  })

  it('delete purges allocation custom field rows before removing the payment (issue #10904 review)', async () => {
    const execute = commandRegistry.get('sales.payments.delete')?.execute
    expect(execute).toBeInstanceOf(Function)

    const mockPayment = {
      id: TEST_PAYMENT_ID,
      tenantId: TEST_TENANT_ID,
      organizationId: TEST_ORG_ID,
      order: mockOrder,
      updatedAt: new Date(),
    }
    const existingAllocation = { id: EXISTING_ALLOCATION_ID, order: TEST_ORDER_ID, invoice: null }

    ;(findOneWithDecryption as jest.Mock)
      .mockResolvedValueOnce(mockPayment) // payment lookup (populate: ['order'])
      .mockResolvedValue(mockOrder) // further order lookups (locking)
    ;(findWithDecryption as jest.Mock).mockImplementation((_em: unknown, _entity: unknown, filter: Record<string, unknown>) => {
      if (filter?.payment !== undefined) return Promise.resolve([existingAllocation])
      return Promise.resolve([])
    })

    let capturedTx: any
    const { ctx } = buildCommandCtx({
      transactional: jest.fn().mockImplementation(async (callback: (tx: any) => Promise<unknown>) => {
        capturedTx = buildMockEm()
        return callback(capturedTx)
      }),
    })

    await execute?.(
      { id: TEST_PAYMENT_ID, organizationId: TEST_ORG_ID, tenantId: TEST_TENANT_ID },
      ctx as any,
    )

    expect(capturedTx.nativeDelete).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        entityId: E.sales.sales_payment_allocation,
        recordId: { $in: [EXISTING_ALLOCATION_ID] },
        $or: [{ tenantId: TEST_TENANT_ID }, { tenantId: null }],
      }),
    )
  })
})
