import type { TranslationMap } from '../storefrontCatalogSupport'
import {
  countStorefrontFacets,
  labelStorefrontCountFacets,
  storefrontAvailabilityFacet,
  storefrontCountFacetCacheParts,
  storefrontFacetTranslationRequests,
  storefrontFacetVariantIndex,
  storefrontPriceRangeFacet,
  type StorefrontFacetCategory,
  type StorefrontFacetSelection,
  type StorefrontFacetSource,
} from '../storefrontFacets'

const ROOT = 'cat-root'
const DRESS = 'cat-dress'
const SHOES = 'cat-shoes'
const HIDDEN = 'cat-hidden'
const TEMPLATE = 'template-1'

function category(id: string, name: string, ancestorIds: string[], descendantIds: string[], isActive = true): StorefrontFacetCategory {
  return {
    id,
    name,
    slug: id.replace('cat-', ''),
    depth: ancestorIds.length,
    parentId: ancestorIds[ancestorIds.length - 1] ?? null,
    isActive,
    ancestorIds,
    descendantIds,
  }
}

function source(): StorefrontFacetSource {
  return {
    products: [
      { id: 'p1', productType: 'simple', templateId: null, categoryIds: [DRESS], tagIds: ['t-sale'] },
      { id: 'p2', productType: 'simple', templateId: null, categoryIds: [DRESS], tagIds: [] },
      { id: 'p3', productType: 'configurable', templateId: TEMPLATE, categoryIds: [SHOES], tagIds: ['t-new'] },
      { id: 'p4', productType: 'configurable', templateId: TEMPLATE, categoryIds: [SHOES, HIDDEN], tagIds: ['t-sale'] },
    ],
    variants: new Map([
      [
        'p3',
        [
          { id: 'v31', optionValues: { color: 'red', size: 'm' } },
          { id: 'v32', optionValues: { color: 'blue', size: 'l' } },
        ],
      ],
      [
        'p4',
        [
          { id: 'v41', optionValues: { color: 'red', size: 'l' } },
          { id: 'v42', optionValues: { color: 'green', size: 'm' } },
        ],
      ],
    ]),
    categories: new Map([
      [ROOT, category(ROOT, 'Clothing', [], [DRESS])],
      [DRESS, category(DRESS, 'Dresses', [ROOT], [])],
      [SHOES, category(SHOES, 'Shoes', [], [])],
      [HIDDEN, category(HIDDEN, 'Hidden', [], [], false)],
    ]),
    tags: new Map([
      ['t-sale', { id: 't-sale', slug: 'sale', label: 'Sale' }],
      ['t-new', { id: 't-new', slug: 'new', label: 'New' }],
    ]),
    templates: new Map([
      [
        TEMPLATE,
        [
          {
            code: 'color',
            label: 'Color',
            inputType: 'select',
            choices: [
              { code: 'red', label: 'Red' },
              { code: 'blue', label: 'Blue' },
              { code: 'green', label: 'Green' },
            ],
          },
          { code: 'size', label: 'Size', inputType: 'select', choices: [{ code: 'm', label: 'M' }, { code: 'l', label: 'L' }] },
        ],
      ],
    ]),
  }
}

function selection(overrides: Partial<StorefrontFacetSelection> = {}): StorefrontFacetSelection {
  return { categoryId: null, tagIds: [], productType: null, options: {}, ...overrides }
}

function plain<K, V>(map: Map<K, V>): Record<string, V> {
  return Object.fromEntries(Array.from(map.entries()).map(([key, value]) => [String(key), value]))
}

function optionCounts(raw: ReturnType<typeof countStorefrontFacets>): Record<string, Record<string, number>> {
  return Object.fromEntries(Array.from(raw.options.entries()).map(([code, counts]) => [code, plain(counts)]))
}

describe('countStorefrontFacets — cross-exclusion (§5.4)', () => {
  it('counts every dimension over the whole universe when no filter is active', () => {
    const raw = countStorefrontFacets(source(), selection())
    expect(plain(raw.categories)).toEqual({ [ROOT]: 2, [DRESS]: 2, [SHOES]: 2, [HIDDEN]: 1 })
    expect(plain(raw.tags)).toEqual({ 't-sale': 2, 't-new': 1 })
    expect(plain(raw.productTypes)).toEqual({ simple: 2, configurable: 2 })
    expect(optionCounts(raw)).toEqual({ color: { red: 2, blue: 1, green: 1 }, size: { m: 2, l: 2 } })
  })

  it('keeps sibling values of a selected option and applies it to every other dimension', () => {
    const raw = countStorefrontFacets(source(), selection({ options: { color: ['red'] } }))
    expect(optionCounts(raw)).toEqual({ color: { red: 2, blue: 1, green: 1 }, size: { m: 1, l: 1 } })
    expect(plain(raw.productTypes)).toEqual({ configurable: 2 })
    expect(plain(raw.tags)).toEqual({ 't-sale': 1, 't-new': 1 })
    expect(plain(raw.categories)).toEqual({ [SHOES]: 2, [HIDDEN]: 1 })
  })

  it('matches option filters on the same variant', () => {
    const raw = countStorefrontFacets(source(), selection({ options: { color: ['green'], size: ['l'] } }))
    expect(optionCounts(raw)).toEqual({ color: { red: 1, blue: 1 }, size: { m: 1 } })
    expect(plain(raw.productTypes)).toEqual({})
  })

  it('counts a category with its descendants and keeps sibling categories when one is selected', () => {
    const raw = countStorefrontFacets(source(), selection({ categoryId: ROOT }))
    expect(plain(raw.categories)).toEqual({ [ROOT]: 2, [DRESS]: 2, [SHOES]: 2, [HIDDEN]: 1 })
    expect(plain(raw.tags)).toEqual({ 't-sale': 1 })
    expect(plain(raw.productTypes)).toEqual({ simple: 2 })
    expect(raw.options.size).toBe(0)
  })

  it('keeps unselected tags and product types under their own filters', () => {
    const byTag = countStorefrontFacets(source(), selection({ tagIds: ['t-new'] }))
    expect(plain(byTag.tags)).toEqual({ 't-sale': 2, 't-new': 1 })
    expect(plain(byTag.productTypes)).toEqual({ configurable: 1 })
    const byType = countStorefrontFacets(source(), selection({ productType: 'simple' }))
    expect(plain(byType.productTypes)).toEqual({ simple: 2, configurable: 2 })
    expect(plain(byType.categories)).toEqual({ [ROOT]: 2, [DRESS]: 2 })
  })
})

describe('labelStorefrontCountFacets', () => {
  const productTypeLabel = (type: string) => (type === 'simple' ? 'Prosty' : type)

  it('drops inactive and out-of-assortment categories and applies the translated labels', () => {
    const facetSource = source()
    const raw = countStorefrontFacets(facetSource, selection())
    const translations = new Map<string, TranslationMap>([
      ['catalog:catalog_product_category', new Map([[DRESS, { pl: { name: 'Sukienki' } }]])],
      ['catalog:catalog_product_tag', new Map([['t-sale', { pl: { label: 'Wyprzedaż' } }]])],
      [
        'catalog:catalog_option_schema_template',
        new Map([[TEMPLATE, { pl: { 'options.color.label': 'Kolor', 'options.color.choices.blue.label': 'Niebieski' } }]]),
      ],
    ])
    const facets = labelStorefrontCountFacets(facetSource, raw, {
      locales: ['pl', 'en'],
      translations,
      assortmentScope: [{ categoryIds: [ROOT] }],
      productTypeLabel,
    })
    expect(facets.categories).toEqual([
      { id: ROOT, name: 'Clothing', slug: 'root', depth: 0, parentId: null, count: 2 },
      { id: DRESS, name: 'Sukienki', slug: 'dress', depth: 1, parentId: ROOT, count: 2 },
    ])
    expect(facets.tags).toEqual([
      { slug: 'sale', label: 'Wyprzedaż', count: 2 },
      { slug: 'new', label: 'New', count: 1 },
    ])
    expect(facets.options).toEqual([
      {
        code: 'color',
        label: 'Kolor',
        values: [
          { code: 'red', label: 'Red', count: 2 },
          { code: 'blue', label: 'Niebieski', count: 1 },
          { code: 'green', label: 'Green', count: 1 },
        ],
      },
      {
        code: 'size',
        label: 'Size',
        values: [
          { code: 'm', label: 'M', count: 2 },
          { code: 'l', label: 'L', count: 2 },
        ],
      },
    ])
    expect(facets.productTypes).toEqual([
      { type: 'simple', label: 'Prosty', count: 2 },
      { type: 'configurable', label: 'configurable', count: 2 },
    ])
  })

  it('drops an active category whose ancestor is inactive, as the category tree does', () => {
    const facetSource = source()
    const root = facetSource.categories.get(ROOT)
    if (!root) throw new Error('[internal] fixture lacks the root category')
    facetSource.categories.set(ROOT, { ...root, isActive: false })
    const raw = countStorefrontFacets(facetSource, selection())
    const facets = labelStorefrontCountFacets(facetSource, raw, {
      locales: ['en'],
      translations: new Map(),
      assortmentScope: null,
      productTypeLabel,
    })
    expect(facets.categories.map((category) => category.id)).not.toContain(ROOT)
    expect(facets.categories.map((category) => category.id)).not.toContain(DRESS)
    expect(facets.categories.map((category) => category.id)).toContain(SHOES)
  })

  it('falls back to option codes and stored values when no template defines them', () => {
    const facetSource = source()
    facetSource.templates = new Map()
    const raw = countStorefrontFacets(facetSource, selection())
    const facets = labelStorefrontCountFacets(facetSource, raw, {
      locales: ['en'],
      translations: new Map(),
      assortmentScope: null,
      productTypeLabel,
    })
    expect(facets.options[0]).toEqual({
      code: 'color',
      label: 'color',
      values: [
        { code: 'blue', label: 'blue', count: 1 },
        { code: 'green', label: 'green', count: 1 },
        { code: 'red', label: 'red', count: 2 },
      ],
    })
  })

  it('requests the overlays of the counted categories, tags and the templates in one batch', () => {
    const facetSource = source()
    const raw = countStorefrontFacets(facetSource, selection({ productType: 'configurable' }))
    expect(storefrontFacetTranslationRequests(facetSource, raw)).toEqual([
      { entityType: 'catalog:catalog_product_category', ids: [SHOES, HIDDEN] },
      { entityType: 'catalog:catalog_product_tag', ids: ['t-new', 't-sale'] },
      { entityType: 'catalog:catalog_option_schema_template', ids: [TEMPLATE] },
    ])
  })
})

describe('storefront facet helpers', () => {
  it('keys count facets on the resolved selection and search term only', () => {
    const base = selection({ tagIds: ['t-sale'] })
    const parts = storefrontCountFacetCacheParts(base, null)
    expect(parts[0]).toBe('products-count-facets')
    expect(storefrontCountFacetCacheParts(selection({ tagIds: ['t-sale', 't-sale'] }), null)).toEqual(parts)
    expect(storefrontCountFacetCacheParts({ ...base, options: { color: ['red'] } }, null)).not.toEqual(parts)
    expect(storefrontCountFacetCacheParts(base, 'dress')).not.toEqual(parts)
    expect(storefrontCountFacetCacheParts({ ...base, categoryId: DRESS }, null)).not.toEqual(parts)
    expect(storefrontCountFacetCacheParts({ ...base, productType: 'simple' }, null)).not.toEqual(parts)
  })

  it('normalizes the order of tags, option codes and option values in the key', () => {
    expect(
      storefrontCountFacetCacheParts(
        selection({ tagIds: ['t-b', 't-a'], options: { size: ['l', 'm'], color: ['red'] } }),
        null,
      ),
    ).toEqual(
      storefrontCountFacetCacheParts(
        selection({ tagIds: ['t-a', 't-b'], options: { color: ['red'], size: ['m', 'l'] } }),
        null,
      ),
    )
  })

  it('ranges over finite amounts and is null without any', () => {
    expect(storefrontPriceRangeFacet([30, null, 12.5, 80], 'PLN')).toEqual({ min: 12.5, max: 80, currencyCode: 'PLN' })
    expect(storefrontPriceRangeFacet([null, Number.NaN], 'PLN')).toBeNull()
    expect(storefrontPriceRangeFacet([], 'PLN')).toBeNull()
  })

  it('counts page availability states in a stable order', () => {
    expect(storefrontAvailabilityFacet(['out_of_stock', 'in_stock', 'backorder', 'in_stock'])).toEqual([
      { state: 'in_stock', count: 2 },
      { state: 'backorder', count: 1 },
      { state: 'out_of_stock', count: 1 },
    ])
  })

  it('indexes the universe variants per product for the listing pricing', () => {
    const index = storefrontFacetVariantIndex(source())
    expect(index.get('p3')).toEqual(['v31', 'v32'])
    expect(index.get('p1')).toEqual([])
  })
})
