import {
  normalizeProductDimensions,
  normalizeProductWeight,
  createProductUnitConversionDraft,
  BASE_INITIAL_VALUES,
  productFormSchema,
  createInitialProductFormValues,
  createVariantDraft,
  buildOptionValuesKey,
  haveSameOptionValues,
  updateDimensionValue,
  updateWeightValue,
  normalizePriceKindSummary,
  formatTaxRateLabel,
  buildOptionSchemaDefinition,
  convertSchemaToProductOptions,
  buildVariantCombinations,
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

describe('createInitialProductFormValues', () => {
  it('returns shape matching BASE_INITIAL_VALUES keys', () => {
    const values = createInitialProductFormValues()
    for (const key of Object.keys(BASE_INITIAL_VALUES)) {
      expect(values).toHaveProperty(key)
    }
  })

  it('generates a non-empty mediaDraftId', () => {
    const values = createInitialProductFormValues()
    expect(typeof values.mediaDraftId).toBe('string')
    expect(values.mediaDraftId.length).toBeGreaterThan(0)
  })

  it('includes one default variant', () => {
    const values = createInitialProductFormValues()
    expect(values.variants).toHaveLength(1)
    expect(values.variants[0].isDefault).toBe(true)
  })

  it('generates a unique mediaDraftId per call', () => {
    const first = createInitialProductFormValues()
    const second = createInitialProductFormValues()
    expect(first.mediaDraftId).not.toBe(second.mediaDraftId)
  })
})

describe('createVariantDraft', () => {
  it('returns defaults with null tax rate when productTaxRateId is null', () => {
    const draft = createVariantDraft(null)
    expect(draft.taxRateId).toBeNull()
    expect(draft.title).toBe('Default variant')
    expect(draft.sku).toBe('')
    expect(draft.isDefault).toBe(false)
    expect(draft.manageInventory).toBe(false)
    expect(draft.allowBackorder).toBe(false)
    expect(draft.hasInventoryKit).toBe(false)
    expect(draft.optionValues).toEqual({})
    expect(draft.prices).toEqual({})
  })

  it('inherits productTaxRateId', () => {
    const draft = createVariantDraft('tax-rate-123')
    expect(draft.taxRateId).toBe('tax-rate-123')
  })

  it('applies overrides', () => {
    const draft = createVariantDraft(null, { sku: 'MY-SKU', isDefault: true })
    expect(draft.sku).toBe('MY-SKU')
    expect(draft.isDefault).toBe(true)
  })

  it('generates unique ids across calls', () => {
    const first = createVariantDraft(null)
    const second = createVariantDraft(null)
    expect(first.id).not.toBe(second.id)
    expect(typeof first.id).toBe('string')
    expect(first.id.length).toBeGreaterThan(0)
  })
})

describe('buildOptionValuesKey', () => {
  it('returns empty string for undefined', () => {
    expect(buildOptionValuesKey(undefined)).toBe('')
  })

  it('returns empty string for empty object', () => {
    expect(buildOptionValuesKey({})).toBe('')
  })

  it('builds key for single entry', () => {
    expect(buildOptionValuesKey({ color: 'red' })).toBe('color:red')
  })

  it('sorts keys alphabetically', () => {
    expect(buildOptionValuesKey({ size: 'L', color: 'blue' })).toBe('color:blue|size:L')
  })

  it('coerces undefined values to empty string', () => {
    const values = { color: undefined } as unknown as Record<string, string>
    expect(buildOptionValuesKey(values)).toBe('color:')
  })
})

describe('haveSameOptionValues', () => {
  it('returns true for identical values', () => {
    expect(haveSameOptionValues({ color: 'red' }, { color: 'red' })).toBe(true)
  })

  it('returns true for undefined vs empty object', () => {
    expect(haveSameOptionValues(undefined, {})).toBe(true)
  })

  it('returns false for different values', () => {
    expect(haveSameOptionValues({ color: 'red' }, { color: 'blue' })).toBe(false)
  })

  it('returns false for different keys', () => {
    expect(haveSameOptionValues({ color: 'red' }, { size: 'L' })).toBe(false)
  })

  it('treats missing key as empty string', () => {
    expect(haveSameOptionValues({ color: '' }, {})).toBe(true)
  })

  it('returns false when extra key has a value', () => {
    expect(haveSameOptionValues({}, { color: 'red' })).toBe(false)
  })
})

describe('updateDimensionValue', () => {
  it('updates a numeric field on null current', () => {
    const result = updateDimensionValue(null, 'width', '10')
    expect(result).toEqual({ width: 10 })
  })

  it('updates the unit field', () => {
    const result = updateDimensionValue({ width: 5 }, 'unit', 'cm')
    expect(result).toEqual({ width: 5, unit: 'cm' })
  })

  it('clears a numeric field with invalid input', () => {
    const result = updateDimensionValue({ width: 5, height: 10 }, 'width', 'abc')
    expect(result).toEqual({ height: 10 })
  })

  it('returns null when clearing the last remaining numeric field', () => {
    const result = updateDimensionValue({ width: 5 }, 'width', 'abc')
    expect(result).toBeNull()
  })

  it('updates an existing numeric field', () => {
    const result = updateDimensionValue({ width: 5, height: 10 }, 'width', '20')
    expect(result).toEqual({ width: 20, height: 10 })
  })
})

describe('updateWeightValue', () => {
  it('updates value on null current', () => {
    const result = updateWeightValue(null, 'value', '2.5')
    expect(result).toEqual({ value: 2.5 })
  })

  it('updates the unit field', () => {
    const result = updateWeightValue({ value: 3 }, 'unit', 'kg')
    expect(result).toEqual({ value: 3, unit: 'kg' })
  })

  it('clears value with invalid input', () => {
    const result = updateWeightValue({ value: 3, unit: 'kg' }, 'value', 'abc')
    expect(result).toEqual({ unit: 'kg' })
  })

  it('returns null when clearing the last remaining field', () => {
    const result = updateWeightValue({ value: 3 }, 'value', 'abc')
    expect(result).toBeNull()
  })
})

describe('normalizePriceKindSummary', () => {
  it('returns null for null input', () => {
    expect(normalizePriceKindSummary(null)).toBeNull()
  })

  it('returns null for undefined input', () => {
    expect(normalizePriceKindSummary(undefined)).toBeNull()
  })

  it('returns null when required fields are missing', () => {
    expect(normalizePriceKindSummary({ id: '1', code: 'std' })).toBeNull()
  })

  it('normalizes camelCase payload', () => {
    const result = normalizePriceKindSummary({
      id: 'pk-1',
      code: 'standard',
      title: 'Standard',
      currencyCode: 'USD',
      displayMode: 'including-tax',
    })
    expect(result).toEqual({
      id: 'pk-1',
      code: 'standard',
      title: 'Standard',
      currencyCode: 'USD',
      displayMode: 'including-tax',
    })
  })

  it('normalizes snake_case payload', () => {
    const result = normalizePriceKindSummary({
      id: 'pk-2',
      code: 'net',
      title: 'Net Price',
      currency_code: 'EUR',
      display_mode: 'excluding-tax',
    })
    expect(result).toEqual({
      id: 'pk-2',
      code: 'net',
      title: 'Net Price',
      currencyCode: 'EUR',
      displayMode: 'excluding-tax',
    })
  })

  it('defaults displayMode to excluding-tax', () => {
    const result = normalizePriceKindSummary({
      id: 'pk-3',
      code: 'basic',
      title: 'Basic',
    })
    expect(result!.displayMode).toBe('excluding-tax')
  })

  it('coerces numeric id to string', () => {
    const result = normalizePriceKindSummary({
      id: 42 as unknown as string,
      code: 'std',
      title: 'Standard',
    })
    expect(result).not.toBeNull()
    expect(result!.id).toBe('42')
  })
})

describe('formatTaxRateLabel', () => {
  it('returns name only when no rate or code', () => {
    expect(formatTaxRateLabel({ id: '1', name: 'VAT', code: null, rate: null, isDefault: false })).toBe('VAT')
  })

  it('appends rate percentage', () => {
    expect(formatTaxRateLabel({ id: '1', name: 'VAT', code: null, rate: 20, isDefault: false })).toBe('VAT \u2022 20%')
  })

  it('appends uppercased code', () => {
    expect(formatTaxRateLabel({ id: '1', name: 'VAT', code: 'vat', rate: null, isDefault: false })).toBe('VAT \u2022 VAT')
  })

  it('appends both rate and code', () => {
    expect(formatTaxRateLabel({ id: '1', name: 'Standard', code: 'std', rate: 19, isDefault: false })).toBe('Standard \u2022 19% \u00b7 STD')
  })

  it('handles zero rate', () => {
    expect(formatTaxRateLabel({ id: '1', name: 'Zero', code: null, rate: 0, isDefault: false })).toBe('Zero \u2022 0%')
  })
})

describe('buildOptionSchemaDefinition', () => {
  it('returns null for undefined options', () => {
    expect(buildOptionSchemaDefinition(undefined, 'Test')).toBeNull()
  })

  it('returns null for empty options array', () => {
    expect(buildOptionSchemaDefinition([], 'Test')).toBeNull()
  })

  it('builds a valid schema from options', () => {
    const options = [
      { id: 'opt-1', title: 'Color', values: [{ id: 'v-1', label: 'Red' }, { id: 'v-2', label: 'Blue' }] },
    ]
    const result = buildOptionSchemaDefinition(options, 'My Schema')
    expect(result).not.toBeNull()
    expect(result!.version).toBe(1)
    expect(result!.name).toBe('My Schema')
    expect(result!.options).toHaveLength(1)
    expect(result!.options[0].label).toBe('Color')
    expect(result!.options[0].inputType).toBe('select')
    expect(result!.options[0].choices).toHaveLength(2)
    expect(result!.options[0].choices![0].label).toBe('Red')
    expect(result!.options[0].choices![1].label).toBe('Blue')
  })

  it('uses default name when name is empty', () => {
    const options = [
      { id: 'opt-1', title: 'Size', values: [{ id: 'v-1', label: 'S' }] },
    ]
    const result = buildOptionSchemaDefinition(options, '')
    expect(result!.name).toBe('Product options')
  })

  it('uses id as fallback label when title is empty', () => {
    const options = [
      { id: 'opt-1', title: '', values: [{ id: 'v-1', label: 'Red' }] },
    ]
    const result = buildOptionSchemaDefinition(options, 'Schema')
    expect(result).not.toBeNull()
    expect(result!.options).toHaveLength(1)
    expect(result!.options[0].label).toBeTruthy()
  })
})

describe('convertSchemaToProductOptions', () => {
  it('returns empty array for null', () => {
    expect(convertSchemaToProductOptions(null)).toEqual([])
  })

  it('returns empty array for undefined', () => {
    expect(convertSchemaToProductOptions(undefined)).toEqual([])
  })

  it('converts a valid schema to product options', () => {
    const schema = {
      version: 1,
      name: 'Test',
      options: [
        { code: 'color', label: 'Color', inputType: 'select' as const, choices: [{ code: 'red', label: 'Red' }] },
      ],
    }
    const result = convertSchemaToProductOptions(schema)
    expect(result).toHaveLength(1)
    expect(result[0].title).toBe('Color')
    expect(result[0].id).toEqual(expect.any(String))
    expect(result[0].values).toHaveLength(1)
    expect(result[0].values[0].label).toBe('Red')
    expect(result[0].values[0].id).toEqual(expect.any(String))
  })

  it('falls back to code when label is missing', () => {
    const schema = {
      version: 1,
      name: 'Test',
      options: [
        { code: 'material', inputType: 'select' as const, choices: [{ code: 'wood' }] },
      ],
    }
    const result = convertSchemaToProductOptions(schema as any)
    expect(result).toHaveLength(1)
    expect(result[0].title).toBe('material')
    expect(result[0].values[0].label).toBe('wood')
  })
})

describe('buildVariantCombinations', () => {
  it('returns empty array for empty options', () => {
    expect(buildVariantCombinations([])).toEqual([])
  })

  it('returns empty array when first option has no values', () => {
    expect(buildVariantCombinations([{ id: 'o1', title: 'Color', values: [] }])).toEqual([])
  })

  it('builds combinations for a single dimension', () => {
    const options = [
      { id: 'o1', title: 'Color', values: [{ id: 'v1', label: 'Red' }, { id: 'v2', label: 'Blue' }] },
    ]
    const result = buildVariantCombinations(options)
    expect(result).toHaveLength(2)
    expect(result[0]).toHaveProperty('color', 'Red')
    expect(result[1]).toHaveProperty('color', 'Blue')
  })

  it('builds cartesian product for two dimensions', () => {
    const options = [
      { id: 'o1', title: 'Color', values: [{ id: 'v1', label: 'Red' }, { id: 'v2', label: 'Blue' }] },
      { id: 'o2', title: 'Size', values: [{ id: 'v3', label: 'S' }, { id: 'v4', label: 'M' }] },
    ]
    const result = buildVariantCombinations(options)
    expect(result).toHaveLength(4)
    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ color: 'Red', size: 'S' }),
        expect.objectContaining({ color: 'Red', size: 'M' }),
        expect.objectContaining({ color: 'Blue', size: 'S' }),
        expect.objectContaining({ color: 'Blue', size: 'M' }),
      ]),
    )
  })

  it('returns empty when a subsequent dimension has no values', () => {
    const options = [
      { id: 'o1', title: 'Color', values: [{ id: 'v1', label: 'Red' }] },
      { id: 'o2', title: 'Size', values: [] },
    ]
    const result = buildVariantCombinations(options)
    expect(result).toEqual([])
  })
})
