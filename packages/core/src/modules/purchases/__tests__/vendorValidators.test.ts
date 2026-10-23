import { purchaseVendorCreateSchema, purchaseVendorUpdateSchema } from '../data/validators'

describe('PurchaseVendor validators', () => {
  it('validates valid vendor creation input', () => {
    const input = {
      name: 'Nordic Wholesale Supplier Ltd',
      code: 'VEND-NORDIC',
      email: 'orders@nordic.example.com',
      phone: '+48 22 100 2000',
      currencyCode: 'PLN',
      paymentTerms: 'Net 30',
      taxId: 'PL5250001234',
      address: 'ul. Magazynowa 15, Warszawa',
      notes: 'Reliable supplier',
      isActive: true,
    }

    const parsed = purchaseVendorCreateSchema.safeParse(input)
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.name).toBe('Nordic Wholesale Supplier Ltd')
      expect(parsed.data.currencyCode).toBe('PLN')
    }
  })

  it('rejects empty vendor name', () => {
    const parsed = purchaseVendorCreateSchema.safeParse({
      name: '',
    })
    expect(parsed.success).toBe(false)
  })

  it('defaults currencyCode to PLN and isActive to true', () => {
    const parsed = purchaseVendorCreateSchema.safeParse({
      name: 'Acme Components',
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.currencyCode).toBe('PLN')
      expect(parsed.data.isActive).toBe(true)
    }
  })

  it('validates partial update input', () => {
    const parsed = purchaseVendorUpdateSchema.safeParse({
      paymentTerms: 'Net 60',
      currencyCode: 'EUR',
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.paymentTerms).toBe('Net 60')
      expect(parsed.data.currencyCode).toBe('EUR')
    }
  })
})
