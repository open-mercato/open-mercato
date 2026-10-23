import { PurchaseOrderService } from '../services/purchaseOrderService'
import { PurchaseCalculationService } from '../services/purchaseCalculationService'
import { PurchaseDocumentNumberGenerator } from '../services/purchaseDocumentNumberGenerator'

describe('PurchaseOrderService (State Transitions & Double Validation)', () => {
  const calculationService = new PurchaseCalculationService()

  it('triggers to_approve status when order gross exceeds approval threshold', async () => {
    const mockOrder: any = {
      id: 'order-1',
      orderNumber: 'RFQ/2026/0001',
      status: 'draft_rfq',
      totalGross: '15000.0000',
      approvalStatus: 'not_required',
      vendorId: 'vendor-1',
      lines: { getItems: () => [] },
      updatedAt: new Date(),
    }

    const mockSettings: any = {
      approvalThresholdAmount: '10000.0000',
      doubleValidationEnabled: true,
    }

    const mockEm: any = {
      findOneOrFail: jest.fn().mockResolvedValue(mockOrder),
      findOne: jest.fn().mockResolvedValue(mockSettings),
      flush: jest.fn().mockResolvedValue(undefined),
    }

    const mockGenerator: any = {
      generateNumber: jest.fn().mockResolvedValue('PO/2026/0001'),
    }

    const service = new PurchaseOrderService(mockEm, calculationService, mockGenerator)

    const confirmed = await service.confirmOrder('order-1', {
      organizationId: 'org-1',
      tenantId: 'tenant-1',
    })

    expect(confirmed.status).toBe('to_approve')
    expect(confirmed.approvalStatus).toBe('pending')
  })

  it('confirms directly to purchase_order when order gross is below threshold', async () => {
    const mockOrder: any = {
      id: 'order-2',
      orderNumber: 'RFQ/2026/0002',
      status: 'draft_rfq',
      totalGross: '5000.0000',
      approvalStatus: 'not_required',
      vendorId: 'vendor-1',
      lines: { getItems: () => [] },
      updatedAt: new Date(),
    }

    const mockSettings: any = {
      approvalThresholdAmount: '10000.0000',
      doubleValidationEnabled: true,
    }

    const mockEm: any = {
      findOneOrFail: jest.fn().mockResolvedValue(mockOrder),
      findOne: jest.fn().mockResolvedValue(mockSettings),
      flush: jest.fn().mockResolvedValue(undefined),
    }

    const mockGenerator: any = {
      generateNumber: jest.fn().mockResolvedValue('PO/2026/0002'),
    }

    const service = new PurchaseOrderService(mockEm, calculationService, mockGenerator)

    const confirmed = await service.confirmOrder('order-2', {
      organizationId: 'org-1',
      tenantId: 'tenant-1',
    })

    expect(confirmed.status).toBe('purchase_order')
    expect(confirmed.approvalStatus).toBe('approved')
    expect(confirmed.orderNumber).toBe('PO/2026/0002')
  })

  it('allows manager to approve orders paused in to_approve status', async () => {
    const mockOrder: any = {
      id: 'order-3',
      orderNumber: 'RFQ/2026/0003',
      status: 'to_approve',
      totalGross: '25000.0000',
      approvalStatus: 'pending',
      vendorId: 'vendor-1',
      lines: { getItems: () => [] },
      updatedAt: new Date(),
    }

    const mockEm: any = {
      findOneOrFail: jest.fn().mockResolvedValue(mockOrder),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation((_entity, data) => data),
      persist: jest.fn().mockImplementation(() => ({ flush: jest.fn().mockResolvedValue(undefined) })),
      flush: jest.fn().mockResolvedValue(undefined),
    }

    const mockGenerator: any = {
      generateNumber: jest.fn().mockResolvedValue('PO/2026/0003'),
    }

    const service = new PurchaseOrderService(mockEm, calculationService, mockGenerator)

    const approved = await service.approveOrder('order-3', {
      organizationId: 'org-1',
      tenantId: 'tenant-1',
    })

    expect(approved.status).toBe('purchase_order')
    expect(approved.approvalStatus).toBe('approved')
    expect(approved.orderNumber).toBe('PO/2026/0003')
  })
})
