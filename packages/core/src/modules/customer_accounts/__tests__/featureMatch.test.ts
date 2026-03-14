import { matchFeature, hasAllFeatures } from '@open-mercato/shared/lib/auth/featureMatch'

describe('matchFeature', () => {
  it('returns true for exact match', () => {
    expect(matchFeature('catalog.view', 'catalog.view')).toBe(true)
  })

  it('returns false for non-match', () => {
    expect(matchFeature('catalog.view', 'catalog.edit')).toBe(false)
  })

  it('returns true when granted is global wildcard *', () => {
    expect(matchFeature('catalog.view', '*')).toBe(true)
  })

  it('returns true when prefix.* matches prefix.child', () => {
    expect(matchFeature('catalog.view', 'catalog.*')).toBe(true)
  })

  it('returns true when prefix.* matches prefix.child.grandchild', () => {
    expect(matchFeature('catalog.products.edit', 'catalog.*')).toBe(true)
  })

  it('returns true when prefix.* matches the exact prefix itself', () => {
    expect(matchFeature('catalog', 'catalog.*')).toBe(true)
  })

  it('returns false when prefix.* does not match unrelated prefix', () => {
    expect(matchFeature('sales.view', 'catalog.*')).toBe(false)
  })
})

describe('hasAllFeatures', () => {
  it('returns true when all features are satisfied', () => {
    expect(
      hasAllFeatures(['catalog.view', 'sales.view'], ['catalog.*', 'sales.*']),
    ).toBe(true)
  })

  it('returns false when any feature is missing', () => {
    expect(
      hasAllFeatures(['catalog.view', 'sales.edit'], ['catalog.*']),
    ).toBe(false)
  })

  it('returns true for empty required list', () => {
    expect(hasAllFeatures([], ['catalog.*'])).toBe(true)
  })

  it('returns false when granted is empty but required is not', () => {
    expect(hasAllFeatures(['catalog.view'], [])).toBe(false)
  })
})
