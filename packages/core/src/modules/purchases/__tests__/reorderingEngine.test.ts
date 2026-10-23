import { ReorderingEngine } from '../services/reorderingEngine'

describe('ReorderingEngine (Min-Max Replenishment)', () => {
  const scope = { organizationId: 'org-1', tenantId: 'tenant-1' }

  it('does not trigger replenishment when virtual stock is above minimum', async () => {
    const mockRule: any = {
      id: 'rule-1',
      productId: 'prod-1',
      warehouseId: 'wh-1',
      minQuantity: '20.0000',
      maxQuantity: '100.0000',
      quantityMultiple: '10.0000',
      preferredVendorId: 'vendor-1',
      isActive: true,
    }

    const mockEm: any = {
      find: jest
        .fn()
        // First call: find rules
        .mockResolvedValueOnce([mockRule])
        // Second call: find active inbound lines
        .mockResolvedValueOnce([]),
      persistAndFlush: jest.fn(),
    }

    const mockGenerator: any = {
      generateNumber: jest.fn(),
    }

    const engine = new ReorderingEngine(mockEm, mockGenerator)

    // Current stock is 25 (>= min of 20)
    const result = await engine.runReplenishment(scope, {
      currentStockProvider: () => 25,
    })

    expect(result.evaluatedCount).toBe(1)
    expect(result.triggeredCount).toBe(0)
    expect(result.ordersCreated).toBe(0)
    expect(result.items.length).toBe(0)
    expect(mockEm.persistAndFlush).not.toHaveBeenCalled()
  })

  it('triggers replenishment, rounds to batch multiple, and creates a draft RFQ', async () => {
    const mockRule: any = {
      id: 'rule-1',
      productId: 'prod-1',
      warehouseId: 'wh-1',
      minQuantity: '20.0000',
      maxQuantity: '100.0000',
      quantityMultiple: '12.0000', // e.g. Box of 12
      preferredVendorId: 'vendor-1',
      isActive: true,
    }

    // Inbound PO lines: 0 inbound
    const mockEm: any = {
      find: jest
        .fn()
        .mockResolvedValueOnce([mockRule])
        .mockResolvedValueOnce([]),
      findOne: jest.fn().mockResolvedValue(null), // No existing draft RFQ
      create: jest.fn().mockImplementation((_entity, data) => ({
        ...data,
        lines: { getItems: () => [] },
      })),
      persist: jest.fn().mockReturnThis(),
      flush: jest.fn().mockResolvedValue(undefined),
    }

    const mockGenerator: any = {
      generateNumber: jest.fn().mockResolvedValue('RFQ/2026/0001'),
    }

    const mockPricelistService: any = {
      resolveBestPrice: jest.fn().mockResolvedValue({
        price: '45.0000',
        vendorProductCode: 'VEND-SKU-99',
      }),
    }

    const mockEventBus: any = {
      emit: jest.fn().mockResolvedValue(undefined),
    }

    const engine = new ReorderingEngine(
      mockEm,
      mockGenerator,
      mockPricelistService,
      mockEventBus
    )

    // Current stock is 5 (< min of 20).
    // Shortfall: 100 - 5 = 95.
    // Batch multiple is 12: Math.ceil(95 / 12) * 12 = 8 * 12 = 96.
    const result = await engine.runReplenishment(scope, {
      currentStockProvider: () => 5,
    })

    expect(result.evaluatedCount).toBe(1)
    expect(result.triggeredCount).toBe(1)
    expect(result.ordersCreated).toBe(1)
    expect(result.items.length).toBe(1)
    expect(result.items[0].quantityToOrder).toBe(96)
    expect(result.items[0].orderNumber).toBe('RFQ/2026/0001')
    expect(mockEm.flush).toHaveBeenCalled()
    expect(mockEventBus.emit).toHaveBeenCalledWith(
      'purchases.reorder.executed',
      expect.objectContaining({ evaluatedCount: 1, triggeredCount: 1 })
    )
  })
})
