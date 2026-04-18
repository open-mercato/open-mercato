/**
 * Step 3.10 — verifies the module-root catalog ai-tools aggregator.
 */
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(),
  findOneWithDecryption: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({
  loadCustomFieldValues: jest.fn(),
}))

import aiTools from '../../ai-tools'
import { knownFeatureIds } from './shared'

describe('catalog module-root ai-tools aggregator', () => {
  it('exports every required read-only base tool', () => {
    const names = aiTools.map((tool) => tool.name).sort()
    expect(names).toEqual(
      [
        'catalog.list_products',
        'catalog.get_product',
        'catalog.list_categories',
        'catalog.get_category',
        'catalog.list_variants',
        'catalog.list_prices',
        'catalog.list_price_kinds_base',
        'catalog.list_offers',
        'catalog.list_product_media',
        'catalog.list_product_tags',
        'catalog.list_option_schemas',
        'catalog.list_unit_conversions',
      ].sort(),
    )
  })

  it('every tool declares requiredFeatures that exist in acl.ts and none is a mutation', () => {
    for (const tool of aiTools) {
      expect(tool.requiredFeatures?.length ?? 0).toBeGreaterThan(0)
      for (const feature of tool.requiredFeatures!) {
        expect(knownFeatureIds.has(feature)).toBe(true)
      }
      expect(tool.isMutation).toBeFalsy()
    }
  })

  it('reserves catalog.list_price_kinds for Step 3.11 D18 ownership (base tool uses the `_base` suffix)', () => {
    const names = new Set(aiTools.map((tool) => tool.name))
    expect(names.has('catalog.list_price_kinds_base')).toBe(true)
    expect(names.has('catalog.list_price_kinds')).toBe(false)
  })
})
