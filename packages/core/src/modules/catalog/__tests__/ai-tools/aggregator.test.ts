/**
 * Steps 3.10 + 3.11 + 3.12 + 5.14 — verifies the module-root catalog
 * ai-tools aggregator (base coverage + D18 merchandising read tools +
 * D18 AI authoring tools + D18 mutation tools).
 */
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(),
  findOneWithDecryption: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({
  loadCustomFieldValues: jest.fn(),
  loadCustomFieldDefinitionIndex: jest.fn().mockResolvedValue(new Map()),
}))

import aiTools from '../../ai-tools'
import { knownFeatureIds } from './shared'

describe('catalog module-root ai-tools aggregator', () => {
  it('exports every required read-only base + D18 merchandising tool', () => {
    const names = aiTools.map((tool) => tool.name).sort()
    expect(names).toEqual(
      [
        // Base coverage (Step 3.10)
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
        // Demo dynamic UI part (Phase 5d preview): inline "Catalog overview" card.
        'catalog.show_stats',
        // D18 merchandising (Step 3.11)
        'catalog.search_products',
        'catalog.get_product_bundle',
        'catalog.list_selected_products',
        'catalog.get_product_media',
        'catalog.get_attribute_schema',
        'catalog.get_category_brief',
        'catalog.list_price_kinds',
        // D18 authoring (Step 3.12)
        'catalog.draft_description_from_attributes',
        'catalog.extract_attributes_from_description',
        'catalog.draft_description_from_media',
        'catalog.suggest_title_variants',
        'catalog.suggest_price_adjustment',
        // D18 mutation (Step 5.14)
        'catalog.update_product',
        'catalog.bulk_update_products',
        'catalog.apply_attribute_extraction',
        'catalog.update_product_media_descriptions',
      ].sort(),
    )
  })

  it('every tool declares requiredFeatures that exist in acl.ts', () => {
    for (const tool of aiTools) {
      expect(tool.requiredFeatures?.length ?? 0).toBeGreaterThan(0)
      for (const feature of tool.requiredFeatures!) {
        expect(knownFeatureIds.has(feature)).toBe(true)
      }
    }
  })

  it('only the Step 5.14 D18 mutation tools declare isMutation=true', () => {
    const D18_MUTATION_NAMES = new Set([
      'catalog.update_product',
      'catalog.bulk_update_products',
      'catalog.apply_attribute_extraction',
      'catalog.update_product_media_descriptions',
    ])
    for (const tool of aiTools) {
      if (D18_MUTATION_NAMES.has(tool.name)) {
        expect(tool.isMutation).toBe(true)
      } else {
        expect(tool.isMutation).toBeFalsy()
      }
    }
  })

  it('coexists: catalog.list_price_kinds_base (Step 3.10) and catalog.list_price_kinds (Step 3.11) are both registered', () => {
    const names = new Set(aiTools.map((tool) => tool.name))
    expect(names.has('catalog.list_price_kinds_base')).toBe(true)
    expect(names.has('catalog.list_price_kinds')).toBe(true)
  })

  it('every D18 merchandising tool name matches the spec exactly', () => {
    const names = new Set(aiTools.map((tool) => tool.name))
    for (const expected of [
      'catalog.search_products',
      'catalog.get_product_bundle',
      'catalog.list_selected_products',
      'catalog.get_product_media',
      'catalog.get_attribute_schema',
      'catalog.get_category_brief',
      'catalog.list_price_kinds',
    ]) {
      expect(names.has(expected)).toBe(true)
    }
  })

  it('every D18 authoring tool name matches the spec exactly (Step 3.12)', () => {
    const names = new Set(aiTools.map((tool) => tool.name))
    for (const expected of [
      'catalog.draft_description_from_attributes',
      'catalog.extract_attributes_from_description',
      'catalog.draft_description_from_media',
      'catalog.suggest_title_variants',
      'catalog.suggest_price_adjustment',
    ]) {
      expect(names.has(expected)).toBe(true)
    }
  })

  it('every D18 mutation tool name matches the spec exactly (Step 5.14)', () => {
    const names = new Set(aiTools.map((tool) => tool.name))
    for (const expected of [
      'catalog.update_product',
      'catalog.bulk_update_products',
      'catalog.apply_attribute_extraction',
      'catalog.update_product_media_descriptions',
    ]) {
      expect(names.has(expected)).toBe(true)
    }
  })
})
