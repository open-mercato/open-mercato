import {
  productCreateSchema,
  productUpdateSchema,
  variantCreateSchema,
  variantUpdateSchema,
} from '../validators'

const scope = {
  organizationId: '22222222-2222-4222-8222-222222222222',
  tenantId: '33333333-3333-4333-8333-333333333333',
}

const baseProduct = { ...scope, title: 'Compliance product' }

describe('product compliance validators', () => {
  it('accepts a full compliance payload and normalizes values', () => {
    const parsed = productCreateSchema.parse({
      ...baseProduct,
      countryOfOriginCode: 'pl',
      pkwiuCode: '62.01.11.0',
      cnCode: '8517 62 00',
      hsCode: '851762',
      taxClassificationCode: 'gtu_07',
      gtuCodes: ['GTU_13', 'GTU_01', 'GTU_01'],
      ageMin: 18,
      isExciseGood: true,
      exciseCategory: 'alcohol',
      requiresPrescription: false,
      hazmatClass: '3',
      unNumber: 'un1170',
      hazmatPackingGroup: 'II',
      containsLithiumBattery: true,
      launchAt: '2026-07-01T00:00:00.000Z',
      endOfLifeAt: '2027-07-01T00:00:00.000Z',
      availableFrom: '2026-07-01T00:00:00.000Z',
      availableUntil: '2026-12-31T00:00:00.000Z',
      minOrderQty: 10,
      maxOrderQty: 100,
      orderQtyIncrement: 10,
      requiresShipping: false,
      isQuoteOnly: true,
      seoTitle: 'Best vodka',
      seoDescription: 'Long description',
      canonicalUrl: 'https://shop.example.com/p/vodka',
    })
    expect(parsed.countryOfOriginCode).toBe('PL')
    expect(parsed.gtuCodes).toEqual(['GTU_01', 'GTU_13'])
    expect(parsed.unNumber).toBe('UN1170')
    expect(parsed.launchAt).toBeInstanceOf(Date)
  })

  it('rejects unknown GTU codes', () => {
    const result = productCreateSchema.safeParse({
      ...baseProduct,
      gtuCodes: ['GTU_14'],
    })
    expect(result.success).toBe(false)
  })

  it('rejects a three-letter country code', () => {
    const result = productCreateSchema.safeParse({
      ...baseProduct,
      countryOfOriginCode: 'POL',
    })
    expect(result.success).toBe(false)
  })

  it('rejects a malformed UN number', () => {
    const result = productCreateSchema.safeParse({
      ...baseProduct,
      unNumber: 'UN12',
    })
    expect(result.success).toBe(false)
  })

  it('rejects a non-absolute canonical URL', () => {
    const result = productCreateSchema.safeParse({
      ...baseProduct,
      canonicalUrl: '/products/vodka',
    })
    expect(result.success).toBe(false)
  })

  it('rejects maxOrderQty below minOrderQty on create and update', () => {
    const createResult = productCreateSchema.safeParse({
      ...baseProduct,
      minOrderQty: 10,
      maxOrderQty: 5,
    })
    expect(createResult.success).toBe(false)
    const updateResult = productUpdateSchema.safeParse({
      id: '11111111-1111-4111-8111-111111111111',
      minOrderQty: 10,
      maxOrderQty: 5,
    })
    expect(updateResult.success).toBe(false)
  })

  it('rejects availability windows that end before they start', () => {
    const result = productCreateSchema.safeParse({
      ...baseProduct,
      availableFrom: '2026-12-31T00:00:00.000Z',
      availableUntil: '2026-01-01T00:00:00.000Z',
    })
    expect(result.success).toBe(false)
  })

  it('still allows partial updates without compliance fields', () => {
    const result = productUpdateSchema.safeParse({
      id: '11111111-1111-4111-8111-111111111111',
      title: 'Renamed',
    })
    expect(result.success).toBe(true)
  })
})

const baseVariant = { ...scope, productId: '44444444-4444-4444-8444-444444444444' }

describe('variant GTIN validators', () => {
  it('accepts a typed variant with a valid EAN-13', () => {
    const result = variantCreateSchema.safeParse({
      ...baseVariant,
      gtinType: 'ean13',
      barcode: '5901234123457',
    })
    expect(result.success).toBe(true)
  })

  it('rejects a typed variant with a checksum typo', () => {
    const result = variantCreateSchema.safeParse({
      ...baseVariant,
      gtinType: 'ean13',
      barcode: '5901234123456',
    })
    expect(result.success).toBe(false)
  })

  it('requires a barcode when a type is set on create', () => {
    const result = variantCreateSchema.safeParse({
      ...baseVariant,
      gtinType: 'ean8',
    })
    expect(result.success).toBe(false)
  })

  it('leaves untyped barcodes unvalidated', () => {
    const result = variantCreateSchema.safeParse({
      ...baseVariant,
      barcode: 'totally-free-form',
    })
    expect(result.success).toBe(true)
  })

  it('allows update payloads that set only the type (merged state checked in the command)', () => {
    const result = variantUpdateSchema.safeParse({
      id: '55555555-5555-4555-8555-555555555555',
      gtinType: 'ean13',
    })
    expect(result.success).toBe(true)
  })

  it('rejects update payloads that set a type with an invalid barcode together', () => {
    const result = variantUpdateSchema.safeParse({
      id: '55555555-5555-4555-8555-555555555555',
      gtinType: 'upc',
      barcode: '036000291453',
    })
    expect(result.success).toBe(false)
  })
})
