import { PurchaseReceiptService } from '../services/purchaseReceiptService'

describe('PurchaseReceiptService (PZ Validation & Backorder Splitting)', () => {
  it('validates partial receipt, updates quantityReceived, and spawns a backorder', async () => {
    const mockOrderLine: any = {
      id: 'ol-1',
      quantityOrdered: '100.0000',
      quantityReceived: '0.0000',
      updatedAt: new Date(),
    }

    const mockReceiptLine: any = {
      id: 'rl-1',
      orderLineId: 'ol-1',
      productId: 'prod-1',
      productDescription: 'Specialty Coffee Beans 1kg',
      quantityExpected: '100.0000',
      quantityDone: '0.0000',
      updatedAt: new Date(),
    }

    const mockReceipt: any = {
      id: 'receipt-1',
      receiptNumber: 'PZ/2026/0001',
      status: 'ready',
      warehouseId: 'wh-1',
      isBackorder: false,
      lines: { getItems: () => [mockReceiptLine] },
      purchaseOrder: {
        id: 'order-1',
        orderNumber: 'PO/2026/0001',
        deliveryStatus: 'pending',
        lines: { getItems: () => [mockOrderLine] },
        updatedAt: new Date(),
      },
    }

    const createdEntities: any[] = []
    const mockEm: any = {
      findOneOrFail: jest.fn().mockResolvedValue(mockReceipt),
      create: jest.fn().mockImplementation((_entity, data) => {
        createdEntities.push(data)
        return data
      }),
      persist: jest.fn().mockImplementation((entities) => {
        return mockEm
      }),
      flush: jest.fn().mockResolvedValue(undefined),
    }

    const mockGenerator: any = {
      generateNumber: jest.fn().mockResolvedValue('PZ/2026/0002'),
    }

    const service = new PurchaseReceiptService(mockEm, mockGenerator)

    // Receive only 70 out of 100 units with createBackorder = true
    const { receipt, backorder } = await service.validateReceipt(
      'receipt-1',
      { organizationId: 'org-1', tenantId: 'tenant-1' },
      {
        lines: [{ orderLineId: 'ol-1', quantityDone: 70 }],
        createBackorder: true,
      }
    )

    // Current receipt must be done with 70 received
    expect(receipt.status).toBe('done')
    expect(mockReceiptLine.quantityDone).toBe('70')

    // Order line quantityReceived must be updated to 70
    expect(mockOrderLine.quantityReceived).toBe('70.0000')

    // Parent order delivery status must be partially_received
    expect(mockReceipt.purchaseOrder.deliveryStatus).toBe('partially_received')

    // Backorder must be spawned for the remaining 30 units
    expect(backorder).not.toBeNull()
    expect(backorder?.receiptNumber).toBe('PZ/2026/0002')
    expect(backorder?.isBackorder).toBe(true)
    expect(backorder?.backorderOfId).toBe('receipt-1')
  })
})
