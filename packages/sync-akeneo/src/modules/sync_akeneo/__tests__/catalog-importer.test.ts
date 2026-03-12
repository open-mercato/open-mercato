import {
  filterAkeneoAttributeMappingsByAvailableAttributes,
  normalizeAkeneoSelectValue,
  readLayeredAkeneoValue,
  readPreferredAkeneoValue,
  resolveAkeneoMediaTarget,
  resolveAkeneoFieldsetMemberships,
  resolveAkeneoFieldKeysToDetach,
} from '../lib/catalog-importer'

describe('akeneo catalog importer value resolution', () => {
  it('does not fall back to a different locale when a base locale is selected', () => {
    const value = readPreferredAkeneoValue(
      {
        description: [
          { locale: 'de_DE', scope: null, data: 'Deutsch' },
          { locale: 'fr_FR', scope: null, data: 'Francais' },
        ],
      },
      'description',
      'en_US',
      null,
    )

    expect(value).toBeNull()
  })

  it('still falls back to non-localized values for non-localizable attributes', () => {
    const value = readPreferredAkeneoValue(
      {
        sku: [
          { locale: null, scope: null, data: 'SKU-123' },
          { locale: 'de_DE', scope: null, data: 'SKU-DE' },
        ],
      },
      'sku',
      'en_US',
      null,
    )

    expect(value).toBe('SKU-123')
  })

  it('does not fall back to a different channel when a channel is selected', () => {
    const value = readPreferredAkeneoValue(
      {
        name: [
          { locale: 'en_US', scope: 'print', data: 'Print title' },
          { locale: 'en_US', scope: 'mobile', data: 'Mobile title' },
        ],
      },
      'name',
      'en_US',
      'ecommerce',
    )

    expect(value).toBeNull()
  })

  it('checks later layers without leaking other locales into the selected one', () => {
    const value = readLayeredAkeneoValue(
      [
        {
          description: [
            { locale: 'de_DE', scope: null, data: 'Deutsch' },
          ],
        },
        {
          description: [
            { locale: 'en_US', scope: null, data: 'English' },
          ],
        },
      ],
      'description',
      'en_US',
      null,
    )

    expect(value).toBe('English')
  })

  it('maps Akeneo select codes to the localized option labels stored by OM variants', () => {
    const value = normalizeAkeneoSelectValue(
      'large',
      new Map([
        ['small', 'Small'],
        ['large', 'Large'],
      ]),
    )

    expect(value).toBe('Large')
  })

  it('joins multi-value Akeneo selections after label normalization', () => {
    const value = normalizeAkeneoSelectValue(
      ['red', 'blue'],
      new Map([
        ['red', 'Red'],
        ['blue', 'Blue'],
      ]),
    )

    expect(value).toBe('Red, Blue')
  })

  it('limits synced field mappings to the current family attributes', () => {
    const mappings = filterAkeneoAttributeMappingsByAvailableAttributes(
      [
        { attributeCode: 'camera_brand', fieldKey: 'camera_brand', target: 'product' as const },
        { attributeCode: 'material', fieldKey: 'material', target: 'product' as const },
      ],
      ['material', 'size'],
    )

    expect(mappings).toEqual([
      { attributeCode: 'material', fieldKey: 'material', target: 'product' },
    ])
  })

  it('routes generated media mappings to product when the current family only exposes a product-level value', () => {
    const target = resolveAkeneoMediaTarget({
      mappingTarget: 'variant',
      attributeCode: 'picture',
      variantAttributeCodes: [],
      productScopedValue: '4/5/6/product-image.jpg',
      variantScopedValue: null,
    })

    expect(target).toBe('product')
  })

  it('routes media mappings to variant when the current family variant owns the attribute', () => {
    const target = resolveAkeneoMediaTarget({
      mappingTarget: 'product',
      attributeCode: 'variation_image',
      variantAttributeCodes: ['variation_image'],
      productScopedValue: '4/5/6/product-image.jpg',
      variantScopedValue: '7/8/9/variant-image.jpg',
    })

    expect(target).toBe('variant')
  })

  it('detaches stale Akeneo-managed fields from a family fieldset during reconciliation', () => {
    const keys = resolveAkeneoFieldKeysToDetach(
      [
        {
          key: 'power_requirements',
          description: 'Akeneo attribute power_requirements',
          fieldset: 'akeneo_product_mp3_players',
          fieldsets: ['akeneo_product_mp3_players'],
        },
        {
          key: 'wash_temperature',
          description: 'Akeneo attribute wash_temperature',
          fieldset: 'akeneo_product_mp3_players',
          fieldsets: ['akeneo_product_mp3_players'],
        },
        {
          key: 'custom_note',
          description: 'User-defined note',
          fieldset: 'akeneo_product_mp3_players',
          fieldsets: ['akeneo_product_mp3_players'],
        },
      ],
      ['power_requirements'],
      'akeneo_product_mp3_players',
    )

    expect(keys).toEqual(['wash_temperature'])
  })

  it('detaches stale Akeneo-managed membership from multi-fieldset definitions without touching active memberships', () => {
    const keys = resolveAkeneoFieldKeysToDetach(
      [
        {
          key: 'auto_exposure',
          description: 'Akeneo attribute auto_exposure',
          fieldset: null,
          fieldsets: ['akeneo_product_digital_cameras', 'akeneo_product_camcorders'],
        },
        {
          key: 'optical_zoom',
          description: 'Akeneo attribute optical_zoom',
          fieldset: null,
          fieldsets: ['akeneo_product_digital_cameras'],
        },
      ],
      ['auto_exposure'],
      'akeneo_product_digital_cameras',
    )

    expect(keys).toEqual(['optical_zoom'])
  })

  it('adds the current family fieldset without dropping existing Akeneo memberships', () => {
    const memberships = resolveAkeneoFieldsetMemberships(
      ['akeneo_product_multifunctionals'],
      'akeneo_product_digital_cameras',
    )

    expect(memberships).toEqual([
      'akeneo_product_multifunctionals',
      'akeneo_product_digital_cameras',
    ])
  })
})
