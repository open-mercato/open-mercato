/** @jest-environment node */

import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { LockMode } from '@mikro-orm/core'

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

jest.mock('@open-mercato/core/modules/entities/lib/helpers', () => ({
  setRecordCustomFields: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('../../lib/dictionaries', () => ({
  resolveDictionaryEntryValue: jest.fn().mockResolvedValue(null),
}))

jest.mock('../../lib/shipments/snapshots', () => ({
  coerceShipmentQuantity: (v: unknown) => (typeof v === 'number' ? v : Number(v) || 0),
  readShipmentItemsSnapshot: jest.fn().mockReturnValue([]),
  refreshShipmentItemsSnapshot: jest.fn().mockResolvedValue(undefined),
  buildShipmentItemSnapshots: jest.fn().mockReturnValue([]),
}))

const TEST_TENANT_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
const TEST_ORG_ID = 'bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb'
const TEST_ORDER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const TEST_LINE_ID = 'dddddddd-dddd-4ddd-9ddd-dddddddddddd'

function buildMockTx() {
  return {
    findOne: jest.fn().mockResolvedValue(null),
    find: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockImplementation((_entity: unknown, data: Record<string, unknown>) => ({
      ...data,
      id: data.id ?? 'new-shipment-id',
    })),
    persist: jest.fn(),
    remove: jest.fn(),
    flush: jest.fn().mockResolvedValue(undefined),
    getReference: jest.fn().mockImplementation((_entity: unknown, id: unknown) => ({ id })),
  }
}

// ---------------------------------------------------------------------------
// Regression: shipment over-fulfillment — order lines locked during validation (issue #1414)
// ---------------------------------------------------------------------------

describe('createShipmentCommand — order line locking for race condition prevention', () => {
  beforeAll(async () => {
    commandRegistry.clear?.()
    await import('../shipments')
  })

  beforeEach(() => {
    ;(findOneWithDecryption as jest.Mock).mockClear()
    ;(findWithDecryption as jest.Mock).mockClear()
  })

  it('validateShipmentItems acquires PESSIMISTIC_WRITE lock on order lines', async () => {
    const execute = commandRegistry.get('sales.shipment.create')?.execute
    expect(execute).toBeInstanceOf(Function)

    const mockOrder = {
      id: TEST_ORDER_ID,
      tenantId: TEST_TENANT_ID,
      organizationId: TEST_ORG_ID,
      deletedAt: null,
    }

    const mockLine = {
      id: TEST_LINE_ID,
      quantity: '100',
      fulfilledQuantity: '0',
    }

    const tx = buildMockTx()
    // loadOrder uses raw em.findOne — need to return the order
    tx.findOne.mockResolvedValue(mockOrder)
    const em = {
      ...buildMockTx(),
      transactional: jest.fn().mockImplementation(async (callback: (trx: any) => Promise<any>) => {
        ;(findWithDecryption as jest.Mock)
          .mockResolvedValueOnce([mockLine]) // order lines query (with lock)
          .mockResolvedValueOnce([]) // loadShippedTotals: shipments
          .mockResolvedValueOnce([]) // recomputeFulfilledQuantities: shipments
          .mockResolvedValueOnce([]) // recomputeFulfilledQuantities: shipment items
          .mockResolvedValueOnce([mockLine]) // recomputeFulfilledQuantities: order lines (with lock)
        return callback(tx)
      }),
    }

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

    await execute?.(
      {
        orderId: TEST_ORDER_ID,
        tenantId: TEST_TENANT_ID,
        organizationId: TEST_ORG_ID,
        items: [{ orderLineId: TEST_LINE_ID, quantity: 10 }],
      },
      ctx as any,
    )

    // Verify findWithDecryption was called with PESSIMISTIC_WRITE lock for order lines
    const orderLinesCall = (findWithDecryption as jest.Mock).mock.calls.find(
      (args: unknown[]) => {
        const opts = args[3] as Record<string, unknown> | undefined
        return opts?.lockMode === LockMode.PESSIMISTIC_WRITE
      }
    )
    expect(orderLinesCall).toBeDefined()
  })

  it('recomputeFulfilledQuantities uses findWithDecryption instead of raw em.find', async () => {
    const execute = commandRegistry.get('sales.shipment.create')?.execute
    expect(execute).toBeInstanceOf(Function)

    const mockOrder = {
      id: TEST_ORDER_ID,
      tenantId: TEST_TENANT_ID,
      organizationId: TEST_ORG_ID,
      deletedAt: null,
    }

    const mockLine = {
      id: TEST_LINE_ID,
      quantity: '50',
      fulfilledQuantity: '0',
    }

    const tx = buildMockTx()
    tx.findOne.mockResolvedValue(mockOrder)
    const em = {
      ...buildMockTx(),
      transactional: jest.fn().mockImplementation(async (callback: (trx: any) => Promise<any>) => {
        ;(findWithDecryption as jest.Mock)
          .mockResolvedValueOnce([mockLine]) // order lines query
          .mockResolvedValueOnce([]) // loadShippedTotals: shipments
          .mockResolvedValueOnce([]) // recomputeFulfilledQuantities: shipments
          .mockResolvedValueOnce([]) // recomputeFulfilledQuantities: shipment items
          .mockResolvedValueOnce([mockLine]) // recomputeFulfilledQuantities: order lines
        return callback(tx)
      }),
    }

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

    await execute?.(
      {
        orderId: TEST_ORDER_ID,
        tenantId: TEST_TENANT_ID,
        organizationId: TEST_ORG_ID,
        items: [{ orderLineId: TEST_LINE_ID, quantity: 5 }],
      },
      ctx as any,
    )

    // No raw em.find should have been called on the transaction EM
    expect(tx.find).not.toHaveBeenCalled()
    // findWithDecryption should have been used for all queries
    expect((findWithDecryption as jest.Mock).mock.calls.length).toBeGreaterThanOrEqual(3)
  })
})
