import { inferAkeneoProductMapping } from '../lib/inference'

describe('akeneo inference', () => {
  it('keeps variant axes in option schemas and routes remaining attributes to custom fields/media', () => {
    const inferred = inferAkeneoProductMapping({
      attributes: [
        { code: 'name', type: 'pim_catalog_text', labels: { en_US: 'Name' } },
        { code: 'description', type: 'pim_catalog_textarea', labels: { en_US: 'Description' } },
        { code: 'color', type: 'pim_catalog_simpleselect', labels: { en_US: 'Color' } },
        { code: 'sensor_type', type: 'pim_catalog_simpleselect', labels: { en_US: 'Sensor type' } },
        { code: 'main_image', type: 'pim_catalog_image', labels: { en_US: 'Main image' } },
        { code: 'packshot', type: 'pim_catalog_image', labels: { en_US: 'Packshot' } },
        { code: 'price', type: 'pim_catalog_price_collection', labels: { en_US: 'Price' } },
      ],
      family: {
        code: 'cameras',
        attribute_as_label: 'name',
        attributes: ['name', 'description', 'color', 'sensor_type', 'main_image', 'packshot', 'price'],
      },
      familyVariant: {
        code: 'camera_by_color',
        variant_attribute_sets: [
          {
            level: 1,
            axes: ['color'],
            attributes: ['sensor_type', 'packshot'],
          },
        ],
      },
      fieldMap: {
        title: 'name',
        subtitle: 'subtitle',
        description: 'description',
        sku: 'sku',
        barcode: 'ean',
        weight: 'weight',
        variantName: 'name',
      },
      explicitCustomFieldMappings: [],
      explicitMediaMappings: [],
    })

    expect(inferred.optionSchemaAttributeCodes).toEqual(['color'])
    expect(inferred.autoCustomFieldMappings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          attributeCode: 'sensor_type',
          target: 'variant',
          kind: 'select',
        }),
      ]),
    )
    expect(inferred.autoMediaMappings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          attributeCode: 'main_image',
          target: 'product',
          kind: 'image',
        }),
        expect.objectContaining({
          attributeCode: 'packshot',
          target: 'variant',
          kind: 'image',
        }),
      ]),
    )
    expect(inferred.autoPriceAttributeCodes).toEqual(['price'])
  })

  it('does not auto-map attributes that were explicitly marked as skipped', () => {
    const inferred = inferAkeneoProductMapping({
      attributes: [
        { code: 'focus_mode', type: 'pim_catalog_simpleselect', labels: { en_US: 'Focus mode' } },
        { code: 'packshot', type: 'pim_catalog_image', labels: { en_US: 'Packshot' } },
      ],
      family: null,
      familyVariant: null,
      fieldMap: {
        title: 'name',
        subtitle: 'subtitle',
        description: 'description',
        sku: 'sku',
        barcode: 'ean',
        weight: 'weight',
        variantName: 'name',
      },
      explicitCustomFieldMappings: [
        {
          attributeCode: 'focus_mode',
          target: 'product',
          fieldKey: 'focus_mode',
          skip: true,
        },
      ],
      explicitMediaMappings: [
        {
          attributeCode: 'packshot',
          target: 'product',
          kind: 'image',
        },
      ],
    })

    expect(inferred.autoCustomFieldMappings).toEqual([])
    expect(inferred.autoMediaMappings).toEqual([])
  })
})
