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
const EXISTING_ITEM_ID = 'eeeeeeee-eeee-4eee-9eee-eeeeeeeeeeee'
const EXISTING_SHIPMENT_ID = 'ffffffff-ffff-4fff-9fff-ffffffffffff'

function buildLockQuery(): any {
  const query: any = {
    select: () => query,
    where: () => query,
    forNoKeyUpdate: () => query,
    executeTakeFirst: jest.fn().mockResolvedValue({ id: TEST_ORDER_ID }),
  }
  return query
}

function buildMockTx() {
  return {
    getKysely: jest.fn().mockImplementation(() => ({
      selectFrom: () => buildLockQuery(),
    })),
    findOne: jest.fn().mockResolvedValue(null),
    find: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockImplementation((_entity: unknown, data: Record<string, unknown>) => ({
      ...data,
      id: data.id ?? 'generated-id',
    })),
    persist: jest.fn(),
    remove: jest.fn(),
    nativeDelete: jest.fn().mockResolvedValue(0),
    flush: jest.fn().mockResolvedValue(undefined),
    getReference: jest.fn().mockImplementation((_entity: unknown, id: unknown) => ({ id })),
  }
}

function buildCtx(em: unknown) {
  return {
    container: {
      resolve: jest.fn().mockImplementation((name: string) => {
        if (name === 'em') return { fork: jest.fn().mockReturnValue(em) }
        if (name === 'dataEngine') return {}
        return {}
      }),
    },
    auth: { tenantId: TEST_TENANT_ID, orgId: TEST_ORG_ID },
    selectedOrganizationId: TEST_ORG_ID,
    organizationIds: [TEST_ORG_ID],
    request: {} as Request,
    organizationScope: null,
  }
}

describe('shipment items expose custom fields (issue #8068)', () => {
  beforeAll(async () => {
    commandRegistry.clear?.()
    await import('../shipments')
  })

  beforeEach(() => {
    ;(findOneWithDecryption as jest.Mock).mockReset().mockResolvedValue(null)
    ;(findWithDecryption as jest.Mock).mockReset().mockResolvedValue([])
    ;(setRecordCustomFields as jest.Mock).mockClear()
  })

  it('create writes customFields for a shipment item keyed by the item\'s own record id', async () => {
    const execute = commandRegistry.get('sales.shipments.create')?.execute
    expect(execute).toBeInstanceOf(Function)

    const mockOrder = {
      id: TEST_ORDER_ID,
      tenantId: TEST_TENANT_ID,
      organizationId: TEST_ORG_ID,
      deletedAt: null,
    }
    const mockLine = { id: TEST_LINE_ID, quantity: '100', fulfilledQuantity: '0' }

    const tx = buildMockTx()
    ;(findOneWithDecryption as jest.Mock).mockResolvedValue(mockOrder)
    const em = {
      ...buildMockTx(),
      transactional: jest.fn().mockImplementation(async (callback: (trx: any) => Promise<any>) => {
        ;(findWithDecryption as jest.Mock)
          .mockResolvedValueOnce([mockLine]) // order lines query (with lock)
          .mockResolvedValueOnce([]) // loadShippedTotals: shipments
          .mockResolvedValueOnce([]) // recomputeFulfilledQuantities: shipments
          .mockResolvedValueOnce([]) // recomputeFulfilledQuantities: shipment items
          .mockResolvedValueOnce([mockLine]) // recomputeFulfilledQuantities: order lines
        return callback(tx)
      }),
    }

    const ctx = buildCtx(em)

    await execute?.(
      {
        orderId: TEST_ORDER_ID,
        tenantId: TEST_TENANT_ID,
        organizationId: TEST_ORG_ID,
        items: [{ orderLineId: TEST_LINE_ID, quantity: 10, customFields: { priority: 'high' } }],
      },
      ctx as any,
    )

    const itemCall = (setRecordCustomFields as jest.Mock).mock.calls.find(
      (args: unknown[]) => (args[1] as Record<string, unknown>)?.entityId === E.sales.sales_shipment_item,
    )
    expect(itemCall).toBeDefined()
    expect((itemCall?.[1] as Record<string, unknown>)?.values).toEqual({ priority: 'high' })
    expect(typeof (itemCall?.[1] as Record<string, unknown>)?.recordId).toBe('string')
  })

  it('create does not write customFields for an item that omits them', async () => {
    const execute = commandRegistry.get('sales.shipments.create')?.execute
    const mockOrder = { id: TEST_ORDER_ID, tenantId: TEST_TENANT_ID, organizationId: TEST_ORG_ID, deletedAt: null }
    const mockLine = { id: TEST_LINE_ID, quantity: '100', fulfilledQuantity: '0' }

    const tx = buildMockTx()
    ;(findOneWithDecryption as jest.Mock).mockResolvedValue(mockOrder)
    const em = {
      ...buildMockTx(),
      transactional: jest.fn().mockImplementation(async (callback: (trx: any) => Promise<any>) => {
        ;(findWithDecryption as jest.Mock)
          .mockResolvedValueOnce([mockLine])
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([mockLine])
        return callback(tx)
      }),
    }
    const ctx = buildCtx(em)

    await execute?.(
      {
        orderId: TEST_ORDER_ID,
        tenantId: TEST_TENANT_ID,
        organizationId: TEST_ORG_ID,
        items: [{ orderLineId: TEST_LINE_ID, quantity: 10 }],
      },
      ctx as any,
    )

    const itemCall = (setRecordCustomFields as jest.Mock).mock.calls.find(
      (args: unknown[]) => (args[1] as Record<string, unknown>)?.entityId === E.sales.sales_shipment_item,
    )
    expect(itemCall).toBeUndefined()
  })

  it('update purges stale item custom field rows before replacing items', async () => {
    const execute = commandRegistry.get('sales.shipments.update')?.execute
    expect(execute).toBeInstanceOf(Function)

    const mockOrder = {
      id: TEST_ORDER_ID,
      tenantId: TEST_TENANT_ID,
      organizationId: TEST_ORG_ID,
      paidTotalAmount: '0',
      refundedTotalAmount: '0',
      grandTotalGrossAmount: '100',
    }
    const mockShipment = {
      id: EXISTING_SHIPMENT_ID,
      tenantId: TEST_TENANT_ID,
      organizationId: TEST_ORG_ID,
      order: mockOrder,
    }
    const mockLine = { id: TEST_LINE_ID, quantity: '100', fulfilledQuantity: '0' }
    const existingItem = { id: EXISTING_ITEM_ID, orderLine: TEST_LINE_ID, quantity: '5' }

    const tx = buildMockTx()
    ;(findOneWithDecryption as jest.Mock).mockResolvedValue(mockShipment)
    const em = {
      ...buildMockTx(),
      transactional: jest.fn().mockImplementation(async (callback: (trx: any) => Promise<any>) => {
        ;(findWithDecryption as jest.Mock)
          .mockResolvedValueOnce([mockLine]) // validateShipmentItems: order lines
          .mockResolvedValueOnce([]) // loadShippedTotals: shipments (excluding this one)
          .mockResolvedValueOnce([existingItem]) // existing items for this shipment
          .mockResolvedValueOnce([]) // recomputeFulfilledQuantities: shipments
          .mockResolvedValueOnce([]) // recomputeFulfilledQuantities: shipment items
          .mockResolvedValueOnce([mockLine]) // recomputeFulfilledQuantities: order lines
        return callback(tx)
      }),
    }
    const ctx = buildCtx(em)

    await execute?.(
      {
        id: EXISTING_SHIPMENT_ID,
        tenantId: TEST_TENANT_ID,
        organizationId: TEST_ORG_ID,
        items: [{ orderLineId: TEST_LINE_ID, quantity: 5, customFields: { priority: 'low' } }],
      },
      ctx as any,
    )

    expect(tx.nativeDelete).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        entityId: E.sales.sales_shipment_item,
        recordId: { $in: [EXISTING_ITEM_ID] },
        $or: [{ tenantId: TEST_TENANT_ID }, { tenantId: null }],
      }),
    )
    const itemCall = (setRecordCustomFields as jest.Mock).mock.calls.find(
      (args: unknown[]) => (args[1] as Record<string, unknown>)?.entityId === E.sales.sales_shipment_item,
    )
    expect(itemCall).toBeDefined()
    expect((itemCall?.[1] as Record<string, unknown>)?.values).toEqual({ priority: 'low' })
  })

  it('delete purges item custom field rows before removing the shipment (issue #10904 review)', async () => {
    const execute = commandRegistry.get('sales.shipments.delete')?.execute
    expect(execute).toBeInstanceOf(Function)

    const mockOrder = { id: TEST_ORDER_ID, tenantId: TEST_TENANT_ID, organizationId: TEST_ORG_ID }
    const mockShipment = {
      id: EXISTING_SHIPMENT_ID,
      tenantId: TEST_TENANT_ID,
      organizationId: TEST_ORG_ID,
      order: mockOrder,
    }
    const mockLine = { id: TEST_LINE_ID, quantity: '100', fulfilledQuantity: '0' }
    const existingItem = { id: EXISTING_ITEM_ID, orderLine: TEST_LINE_ID, quantity: '5' }

    const tx = buildMockTx()
    ;(findOneWithDecryption as jest.Mock).mockResolvedValue(mockShipment)
    const em = {
      ...buildMockTx(),
      transactional: jest.fn().mockImplementation(async (callback: (trx: any) => Promise<any>) => {
        ;(findWithDecryption as jest.Mock)
          .mockResolvedValueOnce([existingItem]) // items on the shipment being deleted
          .mockResolvedValueOnce([]) // recomputeFulfilledQuantities: shipments
          .mockResolvedValueOnce([mockLine]) // recomputeFulfilledQuantities: order lines
        return callback(tx)
      }),
    }
    const ctx = buildCtx(em)

    await execute?.(
      {
        id: EXISTING_SHIPMENT_ID,
        orderId: TEST_ORDER_ID,
        tenantId: TEST_TENANT_ID,
        organizationId: TEST_ORG_ID,
      },
      ctx as any,
    )

    expect(tx.nativeDelete).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        entityId: E.sales.sales_shipment_item,
        recordId: { $in: [EXISTING_ITEM_ID] },
        $or: [{ tenantId: TEST_TENANT_ID }, { tenantId: null }],
      }),
    )
  })
})
