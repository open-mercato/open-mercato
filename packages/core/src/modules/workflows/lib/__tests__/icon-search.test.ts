import { filterIconNames, ICON_SEARCH_RESULT_LIMIT, normalizeIconName } from '../icon-search'

const names = ['cart', 'shopping-cart', 'shopping-bag', 'bell', 'bell-ring', 'clock']

describe('normalizeIconName', () => {
  it('leaves a registry key untouched', () => {
    expect(normalizeIconName('shopping-cart')).toBe('shopping-cart')
  })

  it('converts the legacy free-text PascalCase values the field has always accepted', () => {
    expect(normalizeIconName('ShoppingCart')).toBe('shopping-cart')
    expect(normalizeIconName('BarChart3')).toBe('bar-chart3')
    expect(normalizeIconName('URLScan')).toBe('url-scan')
  })

  it('strips a lucide: prefix and normalizes separators', () => {
    expect(normalizeIconName('lucide:shopping-cart')).toBe('shopping-cart')
    expect(normalizeIconName('shopping_cart')).toBe('shopping-cart')
    expect(normalizeIconName('  shopping cart ')).toBe('shopping-cart')
  })

  it('treats empty and missing values as unset', () => {
    expect(normalizeIconName('')).toBe('')
    expect(normalizeIconName('   ')).toBe('')
    expect(normalizeIconName(null)).toBe('')
    expect(normalizeIconName(undefined)).toBe('')
  })
})

describe('filterIconNames', () => {
  it('returns the whole set (capped) for an empty query', () => {
    expect(filterIconNames(names, '')).toEqual(names)
    expect(filterIconNames(names, '   ')).toEqual(names)
  })

  it('ranks prefix matches above substring matches', () => {
    expect(filterIconNames(names, 'cart')).toEqual(['cart', 'shopping-cart'])
    expect(filterIconNames(names, 'bell')).toEqual(['bell', 'bell-ring'])
  })

  it('matches regardless of the separator or casing the author typed', () => {
    expect(filterIconNames(names, 'Shopping Cart')).toEqual(['shopping-cart'])
    expect(filterIconNames(names, 'shopping_bag')).toEqual(['shopping-bag'])
  })

  it('returns nothing when no icon matches', () => {
    expect(filterIconNames(names, 'zzz')).toEqual([])
  })

  it('caps the result set so the grid never renders the whole registry', () => {
    const many = Array.from({ length: ICON_SEARCH_RESULT_LIMIT + 40 }, (_, index) => `icon-${index}`)
    expect(filterIconNames(many, '')).toHaveLength(ICON_SEARCH_RESULT_LIMIT)
    expect(filterIconNames(many, 'icon')).toHaveLength(ICON_SEARCH_RESULT_LIMIT)
    expect(filterIconNames(many, 'icon', 5)).toHaveLength(5)
  })
})
