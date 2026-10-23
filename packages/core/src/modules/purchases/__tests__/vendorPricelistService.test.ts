import { VendorPricelistService } from '../services/vendorPricelistService'

describe('VendorPricelistService (Tier Breaks & Lead Time)', () => {
  it('selects the lowest price matching volume minimum quantity and date', async () => {
    const mockPricelist: any = {
      id: 'pl-1',
      name: 'Standard Wholesale 2026',
      currencyCode: 'PLN',
      isActive: true,
      items: {
        getItems: () => [
          {
            deletedAt: null,
            productId: 'prod-coffee-1',
            vendorProductCode: 'V-COF-01',
            minQuantity: '1.0000',
            price: '50.0000',
            leadTimeDays: 7,
            validFrom: null,
            validTo: null,
          },
          {
            deletedAt: null,
            productId: 'prod-coffee-1',
            vendorProductCode: 'V-COF-01-BULK',
            minQuantity: '50.0000',
            price: '42.0000', // Volume discount for 50+ units
            leadTimeDays: 14,
            validFrom: null,
            validTo: null,
          },
        ],
      },
    }

    const mockEm: any = {
      find: jest.fn().mockResolvedValue([mockPricelist]),
    }

    const service = new VendorPricelistService(mockEm)

    // Query for 10 units -> should get baseline 50.00 PLN
    const result10 = await service.resolveBestPrice(
      { organizationId: 'org-1', tenantId: 'tenant-1' },
      { vendorId: 'vendor-1', productId: 'prod-coffee-1', quantity: 10 }
    )

    expect(result10).not.toBeNull()
    expect(result10?.price).toBe('50.0000')
    expect(result10?.leadTimeDays).toBe(7)

    // Query for 100 units -> should get bulk discount 42.00 PLN
    const result100 = await service.resolveBestPrice(
      { organizationId: 'org-1', tenantId: 'tenant-1' },
      { vendorId: 'vendor-1', productId: 'prod-coffee-1', quantity: 100 }
    )

    expect(result100).not.toBeNull()
    expect(result100?.price).toBe('42.0000')
    expect(result100?.leadTimeDays).toBe(14)
  })
})
