import { ThreeWayMatchService } from '../services/threeWayMatchService'

describe('ThreeWayMatchService (3-Way Matching Engine)', () => {
  const scope = { organizationId: 'org-1', tenantId: 'tenant-1' }

  it('successfully verifies a 3-way match on_received when quantities and prices match', async () => {
    const mockPoLine: any = {
      id: 'pol-1',
      productId: 'prod-1',
      productDescription: 'Organic Matcha 500g',
      quantityOrdered: '50.0000',
      quantityReceived: '50.0000',
      quantityBilled: '0.0000',
      unitPriceNet: '120.0000',
      updatedAt: new Date(),
    }

    const mockOrder: any = {
      id: 'po-1',
      orderNumber: 'PO/2026/0001',
      controlPolicy: 'on_received',
      invoiceStatus: 'no',
      lines: { getItems: () => [mockPoLine] },
      updatedAt: new Date(),
    }

    const mockBillLine: any = {
      id: 'bl-1',
      orderLineId: 'pol-1',
      productId: 'prod-1',
      productDescription: 'Organic Matcha 500g',
      quantity: '50.0000',
      unitPriceNet: '120.0000',
      subtotalNet: '6000.0000',
    }

    const mockBill: any = {
      id: 'bill-1',
      vendorBillNumber: 'INV/VEND/2026/099',
      status: 'draft',
      matchingStatus: 'pending',
      exceptionNotes: null,
      purchaseOrder: mockOrder,
      lines: { getItems: () => [mockBillLine] },
      updatedAt: new Date(),
    }

    const mockEm: any = {
      findOneOrFail: jest.fn().mockResolvedValue(mockBill),
      flush: jest.fn().mockResolvedValue(undefined),
    }

    const mockEventBus: any = {
      emit: jest.fn().mockResolvedValue(undefined),
    }

    const service = new ThreeWayMatchService(mockEm, mockEventBus)
    const result = await service.verifyMatch('bill-1', scope)

    expect(result.verified).toBe(true)
    expect(result.matchingStatus).toBe('verified')
    expect(mockBill.status).toBe('posted')
    expect(mockBill.matchingStatus).toBe('verified')
    expect(mockBill.exceptionNotes).toBeNull()
    expect(mockPoLine.quantityBilled).toBe('50.0000')
    expect(mockOrder.invoiceStatus).toBe('invoiced')
    expect(mockEm.flush).toHaveBeenCalled()
    expect(mockEventBus.emit).toHaveBeenCalledWith(
      'purchases.bill.matched',
      expect.objectContaining({ status: 'verified', billId: 'bill-1' })
    )
  })

  it('detects unit price mismatch and flags an exception without posting the bill', async () => {
    const mockPoLine: any = {
      id: 'pol-1',
      productId: 'prod-1',
      productDescription: 'Organic Matcha 500g',
      quantityOrdered: '50.0000',
      quantityReceived: '50.0000',
      quantityBilled: '0.0000',
      unitPriceNet: '120.0000', // PO was agreed at 120
      updatedAt: new Date(),
    }

    const mockOrder: any = {
      id: 'po-1',
      controlPolicy: 'on_received',
      invoiceStatus: 'no',
      lines: { getItems: () => [mockPoLine] },
      updatedAt: new Date(),
    }

    const mockBillLine: any = {
      id: 'bl-1',
      orderLineId: 'pol-1',
      productDescription: 'Organic Matcha 500g',
      quantity: '50.0000',
      unitPriceNet: '135.0000', // Vendor billed at 135!
      subtotalNet: '6750.0000',
    }

    const mockBill: any = {
      id: 'bill-2',
      status: 'draft',
      matchingStatus: 'pending',
      purchaseOrder: mockOrder,
      lines: { getItems: () => [mockBillLine] },
      updatedAt: new Date(),
    }

    const mockEm: any = {
      findOneOrFail: jest.fn().mockResolvedValue(mockBill),
      flush: jest.fn().mockResolvedValue(undefined),
    }

    const service = new ThreeWayMatchService(mockEm)
    const result = await service.verifyMatch('bill-2', scope)

    expect(result.verified).toBe(false)
    expect(result.matchingStatus).toBe('exception')
    expect(result.exceptions.length).toBeGreaterThan(0)
    expect(result.exceptions[0]).toContain('Price mismatch')
    expect(mockBill.status).toBe('draft') // Still draft!
    expect(mockBill.matchingStatus).toBe('exception')
    expect(mockBill.exceptionNotes).toContain('120.0000')
    expect(mockPoLine.quantityBilled).toBe('0.0000') // Not updated
  })

  it('detects quantity mismatch when billed quantity exceeds received quantity under on_received policy', async () => {
    const mockPoLine: any = {
      id: 'pol-1',
      productId: 'prod-1',
      productDescription: 'Filter Coffee 1kg',
      quantityOrdered: '100.0000',
      quantityReceived: '40.0000', // Warehouse only received 40 so far
      quantityBilled: '0.0000',
      unitPriceNet: '50.0000',
      updatedAt: new Date(),
    }

    const mockOrder: any = {
      id: 'po-1',
      controlPolicy: 'on_received', // Policy requires PZ receipt before billing!
      invoiceStatus: 'no',
      lines: { getItems: () => [mockPoLine] },
      updatedAt: new Date(),
    }

    const mockBillLine: any = {
      id: 'bl-1',
      orderLineId: 'pol-1',
      productDescription: 'Filter Coffee 1kg',
      quantity: '100.0000', // Vendor billed full 100 before delivery
      unitPriceNet: '50.0000',
    }

    const mockBill: any = {
      id: 'bill-3',
      status: 'draft',
      matchingStatus: 'pending',
      purchaseOrder: mockOrder,
      lines: { getItems: () => [mockBillLine] },
      updatedAt: new Date(),
    }

    const mockEm: any = {
      findOneOrFail: jest.fn().mockResolvedValue(mockBill),
      flush: jest.fn().mockResolvedValue(undefined),
    }

    const service = new ThreeWayMatchService(mockEm)
    const result = await service.verifyMatch('bill-3', scope)

    expect(result.verified).toBe(false)
    expect(result.matchingStatus).toBe('exception')
    expect(result.exceptions[0]).toContain('Quantity mismatch')
    expect(result.exceptions[0]).toContain('exceeds available received quantity')
    expect(mockBill.matchingStatus).toBe('exception')
  })
})
