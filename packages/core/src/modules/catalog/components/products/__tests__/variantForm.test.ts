import {
  VARIANT_BASE_VALUES,
  createVariantInitialValues,
  normalizeOptionSchema,
  buildVariantMetadata,
} from '../variantForm'
import type { VariantFormValues } from '../variantForm'

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
