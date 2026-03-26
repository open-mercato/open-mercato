import {
  VARIANT_BASE_VALUES,
  createVariantInitialValues,
  normalizeOptionSchema,
  buildVariantMetadata,
  mapPriceItemToDraft,
  findInvalidVariantPriceKinds,
} from '../variantForm'
import type { VariantFormValues } from '../variantForm'
import type { PriceKindSummary } from '../productForm'

describe('VARIANT_BASE_VALUES', () => {
  it('has correct string defaults', () => {
    expect(VARIANT_BASE_VALUES.name).toBe('')
    expect(VARIANT_BASE_VALUES.sku).toBe('')
    expect(VARIANT_BASE_VALUES.barcode).toBe('')
    expect(VARIANT_BASE_VALUES.mediaDraftId).toBe('')
    expect(VARIANT_BASE_VALUES.defaultMediaUrl).toBe('')
  })

  it('has correct boolean defaults', () => {
    expect(VARIANT_BASE_VALUES.isDefault).toBe(false)
    expect(VARIANT_BASE_VALUES.isActive).toBe(true)
  })

  it('has correct object defaults', () => {
    expect(VARIANT_BASE_VALUES.optionValues).toEqual({})
    expect(VARIANT_BASE_VALUES.metadata).toEqual({})
    expect(VARIANT_BASE_VALUES.prices).toEqual({})
  })

  it('has correct array defaults', () => {
    expect(VARIANT_BASE_VALUES.mediaItems).toEqual([])
  })

  it('has correct null defaults', () => {
    expect(VARIANT_BASE_VALUES.defaultMediaId).toBeNull()
    expect(VARIANT_BASE_VALUES.taxRateId).toBeNull()
    expect(VARIANT_BASE_VALUES.customFieldsetCode).toBeNull()
  })
})

describe('createVariantInitialValues', () => {
  it('returns an object matching VariantFormValues shape', () => {
    const values = createVariantInitialValues()
    expect(values.name).toBe('')
    expect(values.sku).toBe('')
    expect(values.barcode).toBe('')
    expect(values.isDefault).toBe(false)
    expect(values.isActive).toBe(true)
    expect(values.optionValues).toEqual({})
    expect(values.metadata).toEqual({})
    expect(values.mediaItems).toEqual([])
    expect(values.defaultMediaId).toBeNull()
    expect(values.defaultMediaUrl).toBe('')
    expect(values.prices).toEqual({})
    expect(values.taxRateId).toBeNull()
    expect(values.customFieldsetCode).toBeNull()
  })

  it('generates a non-empty mediaDraftId', () => {
    const values = createVariantInitialValues()
    expect(typeof values.mediaDraftId).toBe('string')
    expect(values.mediaDraftId.length).toBeGreaterThan(0)
  })

  it('generates a unique mediaDraftId on each call', () => {
    const first = createVariantInitialValues()
    const second = createVariantInitialValues()
    expect(first.mediaDraftId).not.toBe(second.mediaDraftId)
  })
})

describe('normalizeOptionSchema', () => {
  it('returns empty array for non-array input', () => {
    expect(normalizeOptionSchema('string')).toEqual([])
    expect(normalizeOptionSchema(42)).toEqual([])
    expect(normalizeOptionSchema({})).toEqual([])
    expect(normalizeOptionSchema(true)).toEqual([])
  })

  it('returns empty array for null', () => {
    expect(normalizeOptionSchema(null)).toEqual([])
  })

  it('returns empty array for undefined', () => {
    expect(normalizeOptionSchema(undefined)).toEqual([])
  })

  it('skips null entries in the array', () => {
    const result = normalizeOptionSchema([null, null])
    expect(result).toEqual([])
  })

  it('skips non-object entries in the array', () => {
    const result = normalizeOptionSchema([42, 'text', true, null, undefined])
    expect(result).toEqual([])
  })

  it('normalizes valid entries with all fields', () => {
    const raw = [
      {
        id: 'opt-1',
        code: 'color',
        label: 'Color',
        values: [{ id: 'v1', label: 'Red' }],
      },
    ]
    const result = normalizeOptionSchema(raw)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('opt-1')
    expect(result[0].code).toBe('color')
    expect(result[0].label).toBe('Color')
    expect(result[0].values).toEqual([{ id: 'v1', label: 'Red' }])
  })

  it('generates fallback id when id is missing', () => {
    const raw = [{ code: 'size', label: 'Size', values: [] }]
    const result = normalizeOptionSchema(raw)
    expect(result).toHaveLength(1)
    expect(typeof result[0].id).toBe('string')
    expect(result[0].id.length).toBeGreaterThan(0)
  })

  it('generates fallback code when code is missing', () => {
    const raw = [{ id: 'opt-1', label: 'Color', values: [] }]
    const result = normalizeOptionSchema(raw)
    expect(result).toHaveLength(1)
    expect(typeof result[0].code).toBe('string')
    expect(result[0].code.length).toBeGreaterThan(0)
  })

  it('falls back label to code when label is missing', () => {
    const raw = [{ id: 'opt-1', code: 'material', values: [] }]
    const result = normalizeOptionSchema(raw)
    expect(result).toHaveLength(1)
    expect(result[0].label).toBe('material')
  })

  it('normalizes values within an option definition', () => {
    const raw = [
      {
        id: 'opt-1',
        code: 'size',
        label: 'Size',
        values: [
          { id: 'v1', label: 'Small' },
          { id: 'v2', label: 'Large' },
        ],
      },
    ]
    const result = normalizeOptionSchema(raw)
    expect(result[0].values).toEqual([
      { id: 'v1', label: 'Small' },
      { id: 'v2', label: 'Large' },
    ])
  })

  it('generates fallback id for values missing id', () => {
    const raw = [
      {
        id: 'opt-1',
        code: 'size',
        label: 'Size',
        values: [{ label: 'Medium' }],
      },
    ]
    const result = normalizeOptionSchema(raw)
    expect(result[0].values).toHaveLength(1)
    expect(typeof result[0].values[0].id).toBe('string')
    expect(result[0].values[0].id.length).toBeGreaterThan(0)
    expect(result[0].values[0].label).toBe('Medium')
  })

  it('falls back value label to value id', () => {
    const raw = [
      {
        id: 'opt-1',
        code: 'size',
        label: 'Size',
        values: [{ id: 'val-1' }],
      },
    ]
    const result = normalizeOptionSchema(raw)
    expect(result[0].values).toHaveLength(1)
    expect(result[0].values[0].label).toBe('val-1')
  })

  it('returns empty values array when values is not an array', () => {
    const raw = [{ id: 'opt-1', code: 'size', label: 'Size', values: 'not-array' }]
    const result = normalizeOptionSchema(raw)
    expect(result[0].values).toEqual([])
  })
})

describe('buildVariantMetadata', () => {
  it('returns a shallow copy of metadata', () => {
    const metadata = { key: 'value', nested: { a: 1 } }
    const values = { ...VARIANT_BASE_VALUES, metadata } as VariantFormValues
    const result = buildVariantMetadata(values)
    expect(result).toEqual({ key: 'value', nested: { a: 1 } })
    expect(result).not.toBe(metadata)
  })

  it('returns empty object when metadata is null', () => {
    const values = { ...VARIANT_BASE_VALUES, metadata: null } as VariantFormValues
    const result = buildVariantMetadata(values)
    expect(result).toEqual({})
  })

  it('returns empty object when metadata is undefined', () => {
    const values = { ...VARIANT_BASE_VALUES, metadata: undefined } as VariantFormValues
    const result = buildVariantMetadata(values)
    expect(result).toEqual({})
  })

  it('preserves all keys in a shallow copy', () => {
    const metadata = { alpha: 'a', beta: 2, gamma: true }
    const values = { ...VARIANT_BASE_VALUES, metadata } as VariantFormValues
    const result = buildVariantMetadata(values)
    expect(result).toEqual({ alpha: 'a', beta: 2, gamma: true })
    result['alpha'] = 'modified'
    expect(metadata.alpha).toBe('a')
  })
})

describe('mapPriceItemToDraft', () => {
  it('picks unitGross for amount when price kind is including-tax', () => {
    const modes = new Map<string, 'including-tax' | 'excluding-tax'>([['kind-1', 'including-tax']])
    const item = {
      id: 'price-1',
      price_kind_id: 'kind-1',
      unit_price_net: '975.61',
      unit_price_gross: '1200.00',
      currency_code: 'USD',
    }
    const draft = mapPriceItemToDraft(item, modes)
    expect(draft).not.toBeNull()
    expect(draft!.amount).toBe('1200.00')
    expect(draft!.displayMode).toBe('including-tax')
  })

  it('picks unitNet for amount when price kind is excluding-tax', () => {
    const modes = new Map<string, 'including-tax' | 'excluding-tax'>([['kind-2', 'excluding-tax']])
    const item = {
      id: 'price-2',
      price_kind_id: 'kind-2',
      unit_price_net: '975.61',
      unit_price_gross: '1200.00',
      currency_code: 'EUR',
    }
    const draft = mapPriceItemToDraft(item, modes)
    expect(draft).not.toBeNull()
    expect(draft!.amount).toBe('975.61')
    expect(draft!.displayMode).toBe('excluding-tax')
  })

  it('falls back to heuristic when price kind is unknown', () => {
    const modes = new Map<string, 'including-tax' | 'excluding-tax'>()
    const itemWithGross = {
      price_kind_id: 'unknown-kind',
      unit_price_net: '100.00',
      unit_price_gross: '123.00',
    }
    const draft = mapPriceItemToDraft(itemWithGross, modes)
    expect(draft).not.toBeNull()
    expect(draft!.displayMode).toBe('including-tax')
    expect(draft!.amount).toBe('123.00')
  })

  it('falls back to excluding-tax when price kind is unknown and no gross value', () => {
    const modes = new Map<string, 'including-tax' | 'excluding-tax'>()
    const itemNetOnly = {
      price_kind_id: 'unknown-kind',
      unit_price_net: '100.00',
    }
    const draft = mapPriceItemToDraft(itemNetOnly, modes)
    expect(draft).not.toBeNull()
    expect(draft!.displayMode).toBe('excluding-tax')
    expect(draft!.amount).toBe('100.00')
  })

  it('returns null when no price kind ID is present', () => {
    const modes = new Map<string, 'including-tax' | 'excluding-tax'>()
    const item = { unit_price_net: '100.00' }
    expect(mapPriceItemToDraft(item, modes)).toBeNull()
  })

  it('round-trip stability: including-tax load produces same value that save would send', () => {
    const modes = new Map<string, 'including-tax' | 'excluding-tax'>([['kind-1', 'including-tax']])
    const item = {
      id: 'price-1',
      price_kind_id: 'kind-1',
      unit_price_net: '975.61',
      unit_price_gross: '1200.00',
    }
    const draft = mapPriceItemToDraft(item, modes)
    expect(draft!.amount).toBe('1200.00')
    expect(draft!.displayMode).toBe('including-tax')
  })

  it('round-trip stability: excluding-tax load produces same value that save would send', () => {
    const modes = new Map<string, 'including-tax' | 'excluding-tax'>([['kind-1', 'excluding-tax']])
    const item = {
      id: 'price-1',
      price_kind_id: 'kind-1',
      unit_price_net: '975.61',
      unit_price_gross: '1200.00',
    }
    const draft = mapPriceItemToDraft(item, modes)
    expect(draft!.amount).toBe('975.61')
    expect(draft!.displayMode).toBe('excluding-tax')
  })

  it('handles camelCase field names from API', () => {
    const modes = new Map<string, 'including-tax' | 'excluding-tax'>([['kind-1', 'including-tax']])
    const item = {
      id: 'price-1',
      priceKindId: 'kind-1',
      unitPriceNet: '80.00',
      unitPriceGross: '100.00',
      currencyCode: 'PLN',
    }
    const draft = mapPriceItemToDraft(item, modes)
    expect(draft).not.toBeNull()
    expect(draft!.amount).toBe('100.00')
    expect(draft!.currencyCode).toBe('PLN')
    expect(draft!.priceKindId).toBe('kind-1')
  })

  it('falls back to net when gross is missing for including-tax kind', () => {
    const modes = new Map<string, 'including-tax' | 'excluding-tax'>([['kind-1', 'including-tax']])
    const item = {
      price_kind_id: 'kind-1',
      unit_price_net: '100.00',
    }
    const draft = mapPriceItemToDraft(item, modes)
    expect(draft!.amount).toBe('100.00')
    expect(draft!.displayMode).toBe('including-tax')
  })
})

describe('findInvalidVariantPriceKinds', () => {
  const priceKinds: PriceKindSummary[] = [
    { id: 'regular', code: 'regular', title: 'Regular', currencyCode: 'USD', displayMode: 'excluding-tax' },
    { id: 'promo', code: 'promo', title: 'Promo', currencyCode: 'USD', displayMode: 'including-tax' },
  ]

  it('returns empty list when no prices provided', () => {
    expect(findInvalidVariantPriceKinds(priceKinds, undefined)).toEqual([])
    expect(findInvalidVariantPriceKinds(priceKinds, {})).toEqual([])
  })

  it('ignores empty amounts', () => {
    const drafts = {
      regular: { priceKindId: 'regular', amount: '   ', displayMode: 'excluding-tax' as const },
    }
    expect(findInvalidVariantPriceKinds(priceKinds, drafts)).toEqual([])
  })

  it('accepts valid numeric input', () => {
    const drafts = {
      regular: { priceKindId: 'regular', amount: '99.50', displayMode: 'excluding-tax' as const },
      promo: { priceKindId: 'promo', amount: '0', displayMode: 'including-tax' as const },
    }
    expect(findInvalidVariantPriceKinds(priceKinds, drafts)).toEqual([])
  })

  it('accepts valid numeric input with whitespace separators', () => {
    const drafts = {
      promo: { priceKindId: 'promo', amount: '1 000', displayMode: 'including-tax' as const },
    }
    expect(findInvalidVariantPriceKinds(priceKinds, drafts)).toEqual([])
  })

  it('flags negative values', () => {
    const drafts = {
      regular: { priceKindId: 'regular', amount: '-10', displayMode: 'excluding-tax' as const },
    }
    expect(findInvalidVariantPriceKinds(priceKinds, drafts)).toEqual(['regular'])
  })

  it('flags non-numeric values', () => {
    const drafts = {
      promo: { priceKindId: 'promo', amount: '99q', displayMode: 'including-tax' as const },
    }
    expect(findInvalidVariantPriceKinds(priceKinds, drafts)).toEqual(['promo'])
  })

  it('flags localized decimal strings with commas', () => {
    const drafts = {
      promo: { priceKindId: 'promo', amount: '99,9999', displayMode: 'including-tax' as const },
    }
    expect(findInvalidVariantPriceKinds(priceKinds, drafts)).toEqual(['promo'])
  })

  it('flags values above numeric(16,4) integer precision', () => {
    const drafts = {
      regular: { priceKindId: 'regular', amount: '1000000000000', displayMode: 'excluding-tax' as const },
    }
    expect(findInvalidVariantPriceKinds(priceKinds, drafts)).toEqual(['regular'])
  })

  it('flags values with more than four decimal places', () => {
    const drafts = {
      regular: { priceKindId: 'regular', amount: '12.34567', displayMode: 'excluding-tax' as const },
    }
    expect(findInvalidVariantPriceKinds(priceKinds, drafts)).toEqual(['regular'])
  })
})
