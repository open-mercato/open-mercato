import {
  normalizeProductDimensions,
  normalizeProductWeight,
  createProductUnitConversionDraft,
  BASE_INITIAL_VALUES,
  productFormSchema,
} from '../productForm'

describe('product form measurement normalizers', () => {
  it('normalizes dimensions from object payloads', () => {
    expect(normalizeProductDimensions({ width: '10', height: 5, depth: 1.5, unit: ' cm ' })).toEqual({
      width: 10,
      height: 5,
      depth: 1.5,
      unit: 'cm',
    })
  })

  it('normalizes dimensions from JSON string payloads', () => {
    expect(normalizeProductDimensions('{"width":"9.5","height":4,"unit":"mm"}')).toEqual({
      width: 9.5,
      height: 4,
      unit: 'mm',
    })
  })

  it('normalizes weight from JSON string payloads', () => {
    expect(normalizeProductWeight('{"value":"1.25","unit":"kg"}')).toEqual({
      value: 1.25,
      unit: 'kg',
    })
  })

  it('returns null for invalid JSON string payloads', () => {
    expect(normalizeProductDimensions('not-json')).toBeNull()
    expect(normalizeProductWeight('not-json')).toBeNull()
  })
})

describe('createProductUnitConversionDraft', () => {
  it('returns correct defaults', () => {
    const draft = createProductUnitConversionDraft()
    expect(draft).toEqual({
      id: null,
      unitCode: '',
      toBaseFactor: '',
      sortOrder: '',
      isActive: true,
    })
  })

  it('applies overrides', () => {
    const draft = createProductUnitConversionDraft({ unitCode: 'kg', toBaseFactor: '1000' })
    expect(draft.unitCode).toBe('kg')
    expect(draft.toBaseFactor).toBe('1000')
    expect(draft.isActive).toBe(true)
  })
})

describe('BASE_INITIAL_VALUES UoM defaults', () => {
  it('has correct UoM field defaults', () => {
    expect(BASE_INITIAL_VALUES.defaultUnit).toBeNull()
    expect(BASE_INITIAL_VALUES.defaultSalesUnit).toBeNull()
    expect(BASE_INITIAL_VALUES.defaultSalesUnitQuantity).toBe('1')
    expect(BASE_INITIAL_VALUES.uomRoundingScale).toBe('4')
    expect(BASE_INITIAL_VALUES.uomRoundingMode).toBe('half_up')
    expect(BASE_INITIAL_VALUES.unitPriceEnabled).toBe(false)
    expect(BASE_INITIAL_VALUES.unitPriceReferenceUnit).toBeNull()
    expect(BASE_INITIAL_VALUES.unitPriceBaseQuantity).toBe('')
    expect(BASE_INITIAL_VALUES.unitConversions).toEqual([])
  })
})

describe('productFormSchema cross-field validations', () => {
  it('rejects unitPriceEnabled without unitPriceReferenceUnit', () => {
    const result = productFormSchema.safeParse({
      title: 'Test product',
      unitPriceEnabled: true,
      unitPriceReferenceUnit: null,
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const paths = result.error.issues.map((issue) => issue.path.join('.'))
      expect(paths).toContain('unitPriceReferenceUnit')
    }
  })

  it('accepts unitPriceEnabled with unitPriceReferenceUnit set', () => {
    const result = productFormSchema.safeParse({
      title: 'Test product',
      unitPriceEnabled: true,
      unitPriceReferenceUnit: 'kg',
    })
    expect(result.success).toBe(true)
  })

  it('rejects defaultSalesUnit without defaultUnit', () => {
    const result = productFormSchema.safeParse({
      title: 'Test product',
      defaultSalesUnit: 'pkg',
      defaultUnit: null,
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const paths = result.error.issues.map((issue) => issue.path.join('.'))
      expect(paths).toContain('defaultUnit')
    }
  })

  it('accepts defaultSalesUnit when defaultUnit is set', () => {
    const result = productFormSchema.safeParse({
      title: 'Test product',
      defaultSalesUnit: 'pkg',
      defaultUnit: 'pc',
    })
    expect(result.success).toBe(true)
  })
})
