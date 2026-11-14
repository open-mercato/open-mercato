import { z } from 'zod'
import {
  buildCatalogVariantLabelFilters,
  CATALOG_VARIANT_LABEL_FIELDS,
  parseCatalogVariantLabelsQuery,
  toCatalogVariantLabelItem,
} from '../catalogVariantLabels'

const VARIANT_A = '33333333-3333-4333-8333-333333333333'
const VARIANT_B = '44444444-4444-4444-8444-444444444444'

describe('catalog variant label query', () => {
  it('keeps the response field list to identity columns', () => {
    expect(CATALOG_VARIANT_LABEL_FIELDS).toEqual(['id', 'name', 'sku', 'is_active'])
  })

  it('searches name, sku, and barcode without treating wildcard characters as wildcards', () => {
    const query = parseCatalogVariantLabelsQuery(new URLSearchParams({ search: 'wid_get%' }))

    expect(query.search).toBe('widget')
    expect(buildCatalogVariantLabelFilters(query)).toEqual({
      $or: [
        { name: { $ilike: '%widget%' } },
        { sku: { $ilike: '%widget%' } },
        { barcode: { $ilike: '%widget%' } },
      ],
    })
  })

  it('escapes a backslash in the search term', () => {
    const query = parseCatalogVariantLabelsQuery(new URLSearchParams({ search: 'a\\b' }))

    expect(buildCatalogVariantLabelFilters(query)).toEqual({
      $or: [
        { name: { $ilike: '%a\\\\b%' } },
        { sku: { $ilike: '%a\\\\b%' } },
        { barcode: { $ilike: '%a\\\\b%' } },
      ],
    })
  })

  it('filters one id with equality and several ids with inclusion', () => {
    const one = parseCatalogVariantLabelsQuery(new URLSearchParams({ id: VARIANT_A, pageSize: '1' }))
    expect(buildCatalogVariantLabelFilters(one)).toEqual({ id: { $eq: VARIANT_A } })

    const many = parseCatalogVariantLabelsQuery(new URLSearchParams({ ids: `${VARIANT_A},${VARIANT_B}` }))
    expect(buildCatalogVariantLabelFilters(many)).toEqual({ id: { $in: [VARIANT_A, VARIANT_B] } })
  })

  it('rejects more than 100 ids', () => {
    const ids = Array.from({ length: 101 }, (_, index) =>
      `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    ).join(',')

    expect(() => parseCatalogVariantLabelsQuery(new URLSearchParams({ ids }))).toThrow(z.ZodError)
  })

  it('drops rows that are not a variant id and omits non-label fields', () => {
    expect(toCatalogVariantLabelItem({
      id: VARIANT_A,
      sku: ' SKU-1 ',
      name: '',
      is_active: false,
      barcode: '999',
      metadata: { cost: 12 },
    })).toEqual({
      id: VARIANT_A,
      sku: 'SKU-1',
      name: null,
      is_active: false,
    })
    expect(toCatalogVariantLabelItem({ id: 'not-a-uuid', sku: 'SKU-1' })).toBeNull()
  })
})
