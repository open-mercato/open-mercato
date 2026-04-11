/** @jest-environment node */

import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'

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

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

// Real UUID v4 values required by Zod schema validators
const TEST_TENANT_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
const TEST_ORG_ID = 'bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb'
const TEST_ORDER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const TEST_PAYMENT_ID = 'dddddddd-dddd-4ddd-9ddd-dddddddddddd'
const TEST_METHOD_ID = 'eeeeeeee-eeee-4eee-aeee-eeeeeeeeeeee'

function buildMockEm(overrides: Record<string, unknown> = {}) {
  return {
    findOne: jest.fn().mockResolvedValue(null),
    find: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockImplementation(
      (_entity: unknown, data: Record<string, unknown>) => ({ ...data, id: data.id ?? TEST_PAYMENT_ID })
    ),
    persist: jest.fn(),
    remove: jest.fn(),
    flush: jest.fn().mockResolvedValue(undefined),
    getReference: jest.fn().mockImplementation((_entity: unknown, id: unknown) => ({ id })),
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

function buildPaymentSnapshot(overrides?: Record<string, unknown>) {
  return {
    id: TEST_PAYMENT_ID,
    orderId: TEST_ORDER_ID,
    organizationId: TEST_ORG_ID,
    tenantId: TEST_TENANT_ID,
    paymentMethodId: TEST_METHOD_ID,
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
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Existing: buildLog contract tests
// ---------------------------------------------------------------------------

describe('createPaymentCommand buildLog — orderPaymentMethodIdBefore in undo payload', () => {
  beforeAll(async () => {
    commandRegistry.clear?.()
    await import('../payments')
  })

  const getCreateBuildLog = () =>
    commandRegistry.get('sales.payments.create')?.buildLog as NonNullable<
      ReturnType<typeof commandRegistry.get>
    >['buildLog']

  it('stores orderPaymentMethodIdBefore=null in undo payload when order had no method before', async () => {
    const buildLog = getCreateBuildLog()
    expect(buildLog).toBeInstanceOf(Function)

    const after = buildPaymentSnapshot()
    const log = (await buildLog?.({
      result: { paymentId: 'payment-1', orderPaymentMethodIdBefore: null, orderPaymentMethodCodeBefore: null },
      snapshots: { after },
    } as any)) as any

    expect(log.payload?.undo?.orderPaymentMethodIdBefore).toBeNull()
    expect(log.payload?.undo?.orderPaymentMethodCodeBefore).toBeNull()
  })

  it('stores orderPaymentMethodIdBefore in undo payload when order already had a method', async () => {
    const buildLog = getCreateBuildLog()
    expect(buildLog).toBeInstanceOf(Function)

    const after = buildPaymentSnapshot()
    const log = (await buildLog?.({
      result: {
        paymentId: 'payment-1',
        orderPaymentMethodIdBefore: 'existing-method-id',
        orderPaymentMethodCodeBefore: 'existing-code',
      },
      snapshots: { after },
    } as any)) as any

    expect(log.payload?.undo?.orderPaymentMethodIdBefore).toBe('existing-method-id')
    expect(log.payload?.undo?.orderPaymentMethodCodeBefore).toBe('existing-code')
  })

  it('returns null log when no after snapshot is available', async () => {
    const buildLog = getCreateBuildLog()
    expect(buildLog).toBeInstanceOf(Function)

    const log = await buildLog?.({
      result: { paymentId: 'payment-1', orderPaymentMethodIdBefore: null, orderPaymentMethodCodeBefore: null },
      snapshots: {},
    } as any)

    expect(log).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Fix 1: loadPaymentSnapshot forwards scope to findOneWithDecryption
// ---------------------------------------------------------------------------

describe('loadPaymentSnapshot — scope forwarding to findOneWithDecryption', () => {
  beforeEach(() => {
    ;(findOneWithDecryption as jest.Mock).mockClear()
    ;(findOneWithDecryption as jest.Mock).mockResolvedValue(null)
  })

  it('passes the provided scope as the 5th argument', async () => {
    const { loadPaymentSnapshot } = await import('../payments')
    const mockEm = {} as any
    const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }

    await loadPaymentSnapshot(mockEm, 'payment-1', scope)

    expect(findOneWithDecryption).toHaveBeenCalledWith(
      mockEm,
      expect.anything(),
      { id: 'payment-1' },
      expect.anything(),
      scope,
    )
  })

  it('forwards undefined scope when called without a scope argument', async () => {
    const { loadPaymentSnapshot } = await import('../payments')
    const mockEm = {} as any

    await loadPaymentSnapshot(mockEm, 'payment-1')

    expect(findOneWithDecryption).toHaveBeenCalledWith(
      mockEm,
      expect.anything(),
      { id: 'payment-1' },
      expect.anything(),
      undefined,
    )
  })
})

// ---------------------------------------------------------------------------
// Fix 3: createPaymentCommand.execute — tenant-scoped entity lookups
// ---------------------------------------------------------------------------

describe('createPaymentCommand.execute — tenant-scoped entity lookups', () => {
  beforeEach(() => {
    ;(findOneWithDecryption as jest.Mock).mockClear()
    ;(findOneWithDecryption as jest.Mock).mockResolvedValue(null)
  })

  it('includes tenantId and organizationId when querying SalesOrder', async () => {
    const execute = commandRegistry.get('sales.payments.create')?.execute
    expect(execute).toBeInstanceOf(Function)

    const { ctx } = buildCommandCtx()
    // findOneWithDecryption returns null → assertFound throws CrudHttpError(404)

    await expect(
      execute?.(
        { orderId: TEST_ORDER_ID, tenantId: TEST_TENANT_ID, organizationId: TEST_ORG_ID, amount: 100, currencyCode: 'USD' },
        ctx as any,
      )
    ).rejects.toBeDefined()

    const orderCall = (findOneWithDecryption as jest.Mock).mock.calls.find(
      ([_em, _entity, filter]: [unknown, unknown, Record<string, unknown>]) => filter?.id === TEST_ORDER_ID
    )
    expect(orderCall).toBeDefined()
    expect(orderCall[2]).toMatchObject({ id: TEST_ORDER_ID })
    expect(orderCall[4]).toMatchObject({ tenantId: TEST_TENANT_ID, organizationId: TEST_ORG_ID })
  })

  it('includes tenantId and organizationId when querying SalesPaymentMethod', async () => {
    const execute = commandRegistry.get('sales.payments.create')?.execute
    expect(execute).toBeInstanceOf(Function)

    const mockOrder = {
      id: TEST_ORDER_ID,
      tenantId: TEST_TENANT_ID,
      organizationId: TEST_ORG_ID,
      deletedAt: null,
      currencyCode: 'USD',
      paymentMethodId: null,
      paymentMethodCode: null,
      orderNumber: 'ORD-001',
      grandTotalGrossAmount: '0',
    }

    // First call returns the order; subsequent calls return null (method lookup → assertFound throws)
    ;(findOneWithDecryption as jest.Mock).mockResolvedValueOnce(mockOrder).mockResolvedValue(null)

    const { ctx } = buildCommandCtx()

    await expect(
      execute?.(
        {
          orderId: TEST_ORDER_ID,
          paymentMethodId: TEST_METHOD_ID,
          tenantId: TEST_TENANT_ID,
          organizationId: TEST_ORG_ID,
          amount: 100,
          currencyCode: 'USD',
        },
        ctx as any,
      )
    ).rejects.toBeDefined()

    const methodCall = (findOneWithDecryption as jest.Mock).mock.calls.find(
      ([_em, _entity, filter]: [unknown, unknown, Record<string, unknown>]) => filter?.id === TEST_METHOD_ID
    )
    expect(methodCall).toBeDefined()
    expect(methodCall[2]).toMatchObject({ id: TEST_METHOD_ID })
    expect(methodCall[4]).toMatchObject({ tenantId: TEST_TENANT_ID, organizationId: TEST_ORG_ID })
  })
})

// ---------------------------------------------------------------------------
// Fix 2: updatePaymentCommand.execute — flush before allocation sync
// ---------------------------------------------------------------------------

describe('updatePaymentCommand.execute — flush ordering (scalar mutations before allocation query)', () => {
  it('flushes scalar mutations before querying existing allocations', async () => {
    const execute = commandRegistry.get('sales.payments.update')?.execute
    expect(execute).toBeInstanceOf(Function)

    const callOrder: string[] = []

    const mockPayment = {
      id: TEST_PAYMENT_ID,
      tenantId: TEST_TENANT_ID,
      organizationId: TEST_ORG_ID,
      order: {
        id: TEST_ORDER_ID,
        tenantId: TEST_TENANT_ID,
        organizationId: TEST_ORG_ID,
        grandTotalGrossAmount: '100',
        paidTotalAmount: '0',
        refundedTotalAmount: '0',
        outstandingAmount: '100',
      },
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

    // Both scopeSeed and payment lookups in updatePaymentCommand.execute use findOneWithDecryption
    ;(findOneWithDecryption as jest.Mock)
      .mockResolvedValueOnce(mockPayment)  // scopeSeed lookup
      .mockResolvedValueOnce(mockPayment)  // payment lookup (with populate: ['order'])

    // Track allocation queries via findWithDecryption instead of em.find
    ;(findWithDecryption as jest.Mock).mockImplementation((_em: unknown, _entity: unknown, filter: Record<string, unknown>) => {
      if (filter?.payment !== undefined) callOrder.push('find:allocations')
      return Promise.resolve([])
    })

    const { em, ctx } = buildCommandCtx({
      flush: jest.fn().mockImplementation(() => {
        callOrder.push('flush')
        return Promise.resolve()
      }),
    })

    await execute?.(
      {
        id: TEST_PAYMENT_ID,
        tenantId: TEST_TENANT_ID,
        organizationId: TEST_ORG_ID,
        allocations: [],
      },
      ctx as any,
    )

    const firstFlushIdx = callOrder.indexOf('flush')
    const firstAllocFindIdx = callOrder.indexOf('find:allocations')

    expect(firstFlushIdx).toBeGreaterThanOrEqual(0)
    expect(firstAllocFindIdx).toBeGreaterThanOrEqual(0)
    expect(firstFlushIdx).toBeLessThan(firstAllocFindIdx)
  })
})

// ---------------------------------------------------------------------------
// Fix 4: createPaymentCommand.undo — tenant-scoped SalesOrder lookup
// ---------------------------------------------------------------------------

describe('createPaymentCommand.undo — tenant-scoped SalesOrder lookup', () => {
  beforeEach(() => {
    ;(findOneWithDecryption as jest.Mock).mockClear()
    ;(findOneWithDecryption as jest.Mock).mockResolvedValue(null)
    ;(findWithDecryption as jest.Mock).mockClear()
    ;(findWithDecryption as jest.Mock).mockResolvedValue([])
  })

  it('uses tenantId and organizationId from the snapshot when fetching the order', async () => {
    const undo = commandRegistry.get('sales.payments.create')?.undo
    expect(undo).toBeInstanceOf(Function)

    const after = buildPaymentSnapshot()

    // Payment lookup returns existing payment; subsequent calls (SalesOrder) return null
    ;(findOneWithDecryption as jest.Mock)
      .mockResolvedValueOnce({ id: TEST_PAYMENT_ID, order: { id: TEST_ORDER_ID } })
      .mockResolvedValue(null)

    const { ctx } = buildCommandCtx()

    const logEntry = {
      payload: {
        undo: { after, orderPaymentMethodIdBefore: null, orderPaymentMethodCodeBefore: null },
      },
    }

    await undo?.({ logEntry: logEntry as any, ctx: ctx as any })

    // The order lookup inside the undo loop must carry tenantId and organizationId as scope
    const scopedOrderCall = (findOneWithDecryption as jest.Mock).mock.calls.find(
      ([_em, _entity, filter]: [unknown, unknown, Record<string, unknown>]) =>
        filter?.id === TEST_ORDER_ID
    )
    expect(scopedOrderCall).toBeDefined()
    expect(scopedOrderCall[2]).toMatchObject({ id: TEST_ORDER_ID })
    expect(scopedOrderCall[4]).toMatchObject({
      tenantId: TEST_TENANT_ID,
      organizationId: TEST_ORG_ID,
    })
  })
})
