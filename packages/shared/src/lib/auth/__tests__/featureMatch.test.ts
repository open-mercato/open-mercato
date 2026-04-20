import {
  extractFeatureStrings,
  featureScope,
  featureString,
  hasAllFeatures,
  matchFeature,
} from '../featureMatch'

describe('featureString', () => {
  it('returns raw string entries unchanged', () => {
    expect(featureString('catalog.view')).toBe('catalog.view')
  })

  it('reads the id from structured feature entries', () => {
    expect(featureString({ id: 'catalog.edit', title: 'Edit catalog' })).toBe('catalog.edit')
  })
})

describe('featureScope', () => {
  it('returns the whole feature id when there is no nested segment', () => {
    expect(featureScope('catalog')).toBe('catalog')
  })

  it('returns the top-level scope for nested feature ids', () => {
    expect(featureScope('catalog.product.edit')).toBe('catalog')
    expect(featureScope('catalog.*')).toBe('catalog')
  })
})

describe('extractFeatureStrings', () => {
  it('normalizes mixed feature entry arrays into string ids', () => {
    expect(
      extractFeatureStrings([
        'catalog.view',
        { id: 'sales.edit', module: 'sales', title: 'Edit sales' },
      ]),
    ).toEqual(['catalog.view', 'sales.edit'])
  })
})

describe('matchFeature', () => {
  it('matches exact feature ids', () => {
    expect(matchFeature('catalog.view', 'catalog.view')).toBe(true)
    expect(matchFeature('catalog.view', 'catalog.edit')).toBe(false)
  })

  it('accepts the global wildcard grant', () => {
    expect(matchFeature('catalog.view', '*')).toBe(true)
  })

  it('matches module wildcards against nested features and the bare prefix', () => {
    expect(matchFeature('catalog.product.edit', 'catalog.*')).toBe(true)
    expect(matchFeature('catalog', 'catalog.*')).toBe(true)
  })

  it('does not treat partial prefixes as module matches', () => {
    expect(matchFeature('cataloging.view', 'catalog.*')).toBe(false)
    expect(matchFeature('sales.view', 'catalog.*')).toBe(false)
  })
})

describe('hasAllFeatures', () => {
  it('returns true when no features are required', () => {
    expect(hasAllFeatures([], ['catalog.*'])).toBe(true)
  })

  it('returns false when features are required but none are granted', () => {
    expect(hasAllFeatures(['catalog.view'], [])).toBe(false)
  })

  it('returns true when every required feature is satisfied', () => {
    expect(hasAllFeatures(['catalog.view', 'sales.edit'], ['catalog.*', 'sales.edit'])).toBe(true)
  })

  it('returns false when any required feature is missing', () => {
    expect(hasAllFeatures(['catalog.view', 'sales.edit'], ['catalog.*'])).toBe(false)
  })
})
