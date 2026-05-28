/** @jest-environment node */

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(),
  findOneWithDecryption: jest.fn(),
}))

jest.mock('../salesOrderWarehouseAssignment', () => ({
  loadExplicitWarehouseIdForOrder: jest.fn(),
}))

import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { InventoryBalance, InventoryReservation } from '../../data/entities'
import { loadExplicitWarehouseIdForOrder } from '../salesOrderWarehouseAssignment'
import { reserveInventoryForConfirmedOrder } from '../salesOrderInventoryAutomation'

const findWithDecryptionMock = jest.mocked(findWithDecryption)
const loadExplicitWarehouseIdForOrderMock = jest.mocked(loadExplicitWarehouseIdForOrder)

describe('reserveInventoryForConfirmedOrder', () => {
  const execute = jest.fn(async () => ({ result: {} }))

  beforeEach(() => {
    findWithDecryptionMock.mockReset()
    loadExplicitWarehouseIdForOrderMock.mockReset()
    execute.mockClear()
  })

  it('reserves only from the explicitly assigned warehouse when set', async () => {
    loadExplicitWarehouseIdForOrderMock.mockResolvedValue('warehouse-assigned')
    findWithDecryptionMock.mockImplementation(async (_em, entity) => {
      if (entity === InventoryReservation) {
        return []
      }
      if (entity === InventoryBalance) {
        return [
          {
            catalogVariantId: 'variant-1',
            quantityOnHand: '10',
            quantityReserved: '0',
            quantityAllocated: '0',
            warehouse: { id: 'warehouse-assigned' },
          },
          {
            catalogVariantId: 'variant-1',
            quantityOnHand: '20',
            quantityReserved: '0',
            quantityAllocated: '0',
            warehouse: { id: 'warehouse-other' },
          },
        ]
      }
      return []
    })

    const queryEngine = {
      query: jest
        .fn()
        .mockResolvedValueOnce({
          items: [{ id: 'order-1', order_number: 'SO-1' }],
        })
        .mockResolvedValueOnce({
          items: [
            {
              id: 'line-1',
              kind: 'product',
              product_variant_id: 'variant-1',
              quantity: '2',
              line_number: 1,
            },
          ],
        }),
    }

    const em = { fork: () => ({}) }
    const featureTogglesService = {
      getBoolConfig: jest.fn().mockResolvedValue({ ok: true, value: true }),
    }

    await reserveInventoryForConfirmedOrder(
      {
        orderId: 'order-1',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      },
      {
        resolve: (name: string) => {
          if (name === 'em') return em
          if (name === 'commandBus') return { execute }
          if (name === 'queryEngine') return queryEngine
          if (name === 'featureTogglesService') return featureTogglesService
          throw new Error(`Unexpected resolve: ${name}`)
        },
      },
    )

    expect(execute).toHaveBeenCalledWith(
      'wms.inventory.reserve',
      expect.objectContaining({
        input: expect.objectContaining({
          warehouseId: 'warehouse-assigned',
          catalogVariantId: 'variant-1',
        }),
      }),
    )
  })
})
