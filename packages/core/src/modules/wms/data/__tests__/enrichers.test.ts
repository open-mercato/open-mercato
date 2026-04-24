/** @jest-environment node */

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(),
}))

import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CatalogProductVariant } from '../../../catalog/data/entities'
import { SalesOrderLine } from '../../../sales/data/entities'
import { InventoryBalance, InventoryReservation, ProductInventoryProfile } from '../entities'
import { enrichers } from '../enrichers'

const findWithDecryptionMock = jest.mocked(findWithDecryption)

describe('wms sales order enrichers', () => {
  const salesOrderInventoryEnricher = enrichers.find((enricher) => enricher.id === 'wms.sales-order-inventory')

  const createContext = (enabled: boolean) => ({
    organizationId: 'org-1',
    tenantId: 'tenant-1',
    userId: 'user-1',
    em: { fork: () => ({}) },
    container: {
      resolve: (name: string) => {
        if (name === 'featureTogglesService') {
          return {
            getBoolConfig: jest.fn().mockResolvedValue({ ok: true, value: enabled }),
          }
        }
        throw new Error(`Unexpected resolve: ${name}`)
      },
    },
  })

  beforeEach(() => {
    findWithDecryptionMock.mockReset()
  })

  it('skips enrichment when the sales inventory integration toggle is disabled', async () => {
    expect(salesOrderInventoryEnricher?.enrichMany).toBeDefined()

    const records = [{ id: 'order-1' }]
    const result = await salesOrderInventoryEnricher!.enrichMany!(records, createContext(false))

    expect(result).toEqual(records)
    expect(findWithDecryptionMock).not.toHaveBeenCalled()
  })

  it('adds additive _wms sales order inventory data when the toggle is enabled', async () => {
    findWithDecryptionMock.mockImplementation(async (_em, entity) => {
      if (entity === SalesOrderLine) {
        return [
          {
            order: { id: 'order-1' },
            productVariantId: 'variant-1',
            quantity: '2',
          } as SalesOrderLine,
          {
            order: { id: 'order-1' },
            productVariantId: 'variant-2',
            quantity: '4',
          } as SalesOrderLine,
        ]
      }

      if (entity === InventoryReservation) {
        return [
          {
            id: 'reservation-1',
            sourceId: 'order-1',
            catalogVariantId: 'variant-1',
            quantity: '2',
            status: 'active',
            warehouse: { id: 'warehouse-1' },
          } as InventoryReservation,
          {
            id: 'reservation-2',
            sourceId: 'order-1',
            catalogVariantId: 'variant-2',
            quantity: '1',
            status: 'active',
            warehouse: { id: 'warehouse-1' },
          } as InventoryReservation,
          {
            id: 'reservation-released',
            sourceId: 'order-1',
            catalogVariantId: 'variant-2',
            quantity: '9',
            status: 'released',
            warehouse: { id: 'warehouse-2' },
          } as InventoryReservation,
        ]
      }

      if (entity === InventoryBalance) {
        return [
          {
            catalogVariantId: 'variant-1',
            quantityOnHand: '10',
            quantityReserved: '3',
            quantityAllocated: '1',
          } as InventoryBalance,
          {
            catalogVariantId: 'variant-2',
            quantityOnHand: '5',
            quantityReserved: '0',
            quantityAllocated: '0',
          } as InventoryBalance,
        ]
      }

      return []
    })

    const result = await salesOrderInventoryEnricher!.enrichMany!(
      [{ id: 'order-1', orderNumber: 'SO-1' }],
      createContext(true),
    )

    expect(result).toEqual([
      {
        id: 'order-1',
        orderNumber: 'SO-1',
        _wms: {
          assignedWarehouseId: 'warehouse-1',
          stockSummary: [
            { catalogVariantId: 'variant-1', available: '6', reserved: '3' },
            { catalogVariantId: 'variant-2', available: '5', reserved: '0' },
          ],
          reservationSummary: {
            status: 'partially_reserved',
            reservationIds: ['reservation-1', 'reservation-2'],
          },
        },
      },
    ])
  })

  it('adds direct WMS inventory data to catalog variants', async () => {
    const catalogVariantInventoryEnricher = enrichers.find(
      (enricher) => enricher.id === 'wms.catalog-variant-inventory',
    )

    findWithDecryptionMock.mockImplementation(async (_em, entity) => {
      if (entity === ProductInventoryProfile) {
        return [
          {
            id: 'profile-variant-1',
            catalogProductId: 'product-1',
            catalogVariantId: 'variant-1',
            defaultUom: 'pc',
            defaultStrategy: 'fifo',
            trackLot: true,
            trackSerial: false,
            trackExpiration: false,
            reorderPoint: '10',
            safetyStock: '4',
          } as ProductInventoryProfile,
        ]
      }

      if (entity === InventoryBalance) {
        return [
          {
            catalogVariantId: 'variant-1',
            quantityOnHand: '9',
            quantityReserved: '2',
            quantityAllocated: '1',
          } as InventoryBalance,
        ]
      }

      return []
    })

    const result = await catalogVariantInventoryEnricher!.enrichMany!(
      [{ id: 'variant-1', product_id: 'product-1', sku: 'SKU-1' }],
      createContext(true),
    )

    expect(result).toEqual([
      {
        id: 'variant-1',
        product_id: 'product-1',
        sku: 'SKU-1',
        _wms: {
          inventoryProfile: {
            profileId: 'profile-variant-1',
            catalogProductId: 'product-1',
            catalogVariantId: 'variant-1',
            defaultUom: 'pc',
            defaultStrategy: 'fifo',
            trackLot: true,
            trackSerial: false,
            trackExpiration: false,
            reorderPoint: '10',
            safetyStock: '4',
          },
          stockSummary: [
            {
              catalogVariantId: 'variant-1',
              onHand: '9',
              reserved: '2',
              allocated: '1',
              available: '6',
            },
          ],
          reorderStatus: {
            state: 'below_reorder_point',
            available: '6',
            reorderPoint: '10',
            safetyStock: '4',
          },
        },
      },
    ])
  })

  it('adds aggregated WMS inventory data to catalog products', async () => {
    const catalogProductInventoryEnricher = enrichers.find(
      (enricher) => enricher.id === 'wms.catalog-product-inventory',
    )

    findWithDecryptionMock.mockImplementation(async (_em, entity) => {
      if (entity === CatalogProductVariant) {
        return [
          {
            id: 'variant-1',
            product: { id: 'product-1' },
          } as CatalogProductVariant,
          {
            id: 'variant-2',
            product: { id: 'product-1' },
          } as CatalogProductVariant,
        ]
      }

      if (entity === ProductInventoryProfile) {
        return [
          {
            id: 'profile-product-1',
            catalogProductId: 'product-1',
            catalogVariantId: null,
            defaultUom: 'pc',
            defaultStrategy: 'fifo',
            trackLot: false,
            trackSerial: false,
            trackExpiration: false,
            reorderPoint: '12',
            safetyStock: '5',
          } as ProductInventoryProfile,
        ]
      }

      if (entity === InventoryBalance) {
        return [
          {
            catalogVariantId: 'variant-1',
            quantityOnHand: '3',
            quantityReserved: '1',
            quantityAllocated: '0',
          } as InventoryBalance,
          {
            catalogVariantId: 'variant-2',
            quantityOnHand: '4',
            quantityReserved: '0',
            quantityAllocated: '1',
          } as InventoryBalance,
        ]
      }

      return []
    })

    const result = await catalogProductInventoryEnricher!.enrichMany!(
      [{ id: 'product-1', title: 'Aurora Jacket' }],
      createContext(true),
    )

    expect(result).toEqual([
      {
        id: 'product-1',
        title: 'Aurora Jacket',
        _wms: {
          inventoryProfile: {
            profileId: 'profile-product-1',
            catalogProductId: 'product-1',
            catalogVariantId: null,
            defaultUom: 'pc',
            defaultStrategy: 'fifo',
            trackLot: false,
            trackSerial: false,
            trackExpiration: false,
            reorderPoint: '12',
            safetyStock: '5',
          },
          stockSummary: [
            {
              catalogVariantId: 'variant-1',
              onHand: '3',
              reserved: '1',
              allocated: '0',
              available: '2',
            },
            {
              catalogVariantId: 'variant-2',
              onHand: '4',
              reserved: '0',
              allocated: '1',
              available: '3',
            },
          ],
          reorderStatus: {
            state: 'below_safety_stock',
            available: '5',
            reorderPoint: '12',
            safetyStock: '5',
          },
        },
      },
    ])
  })
})
