import { buildAkeneoMappingsFromPreset, readAkeneoEnvPreset } from '../lib/preset'

describe('akeneo preset', () => {
  it('reads credentials and optional settings from env', () => {
    const preset = readAkeneoEnvPreset({
      OM_INTEGRATION_AKENEO_API_URL: 'https://example.akeneo.com',
      OM_INTEGRATION_AKENEO_CLIENT_ID: 'client-id',
      OM_INTEGRATION_AKENEO_CLIENT_SECRET: 'client-secret',
      OM_INTEGRATION_AKENEO_USERNAME: 'api-user',
      OM_INTEGRATION_AKENEO_PASSWORD: 'api-pass',
      OM_INTEGRATION_AKENEO_PRODUCT_LOCALE: 'de_DE',
      OM_INTEGRATION_AKENEO_IMPORT_CHANNELS: 'ecommerce, mobile',
      OM_INTEGRATION_AKENEO_PRODUCTS_SETTINGS_JSON: JSON.stringify({
        fieldMap: {
          title: 'marketing_name',
        },
      }),
    })

    expect(preset).not.toBeNull()
    expect(preset?.credentials.apiUrl).toBe('https://example.akeneo.com')
    expect(preset?.productLocale).toBe('de_DE')
    expect(preset?.productChannels).toEqual(['ecommerce', 'mobile'])
    expect(preset?.productsSettingsOverride).toEqual({
      fieldMap: {
        title: 'marketing_name',
      },
    })
  })

  it('builds discovered mappings and applies env overrides', () => {
    const preset = readAkeneoEnvPreset({
      OM_INTEGRATION_AKENEO_API_URL: 'https://example.akeneo.com',
      OM_INTEGRATION_AKENEO_CLIENT_ID: 'client-id',
      OM_INTEGRATION_AKENEO_CLIENT_SECRET: 'client-secret',
      OM_INTEGRATION_AKENEO_USERNAME: 'api-user',
      OM_INTEGRATION_AKENEO_PASSWORD: 'api-pass',
      OM_INTEGRATION_AKENEO_PRODUCT_LOCALE: 'de_DE',
      OM_INTEGRATION_AKENEO_PRODUCT_CHANNEL: 'ecommerce',
      OM_INTEGRATION_AKENEO_IMPORT_ALL_CHANNELS: 'false',
      OM_INTEGRATION_AKENEO_IMPORT_CHANNELS: 'ecommerce',
      OM_INTEGRATION_AKENEO_ATTRIBUTE_FAMILY_FILTER: 'clothing',
      OM_INTEGRATION_AKENEO_PRODUCTS_SETTINGS_JSON: JSON.stringify({
        createMissingChannels: false,
      }),
    })

    if (!preset) {
      throw new Error('Expected preset to be parsed')
    }

    const mappings = buildAkeneoMappingsFromPreset({
      preset,
      discovery: {
        locales: [{ code: 'de_DE', label: 'German', enabled: true }],
        channels: [{ code: 'ecommerce', label: 'Ecommerce', locales: ['de_DE'] }],
        attributes: [
          { code: 'name', type: 'pim_catalog_text', label: 'Name', localizable: true, scopable: false },
          { code: 'description', type: 'pim_catalog_textarea', label: 'Description', localizable: true, scopable: false },
          { code: 'color', type: 'pim_catalog_simpleselect', label: 'Color', localizable: false, scopable: false },
          { code: 'sensor_type', type: 'pim_catalog_simpleselect', label: 'Sensor type', localizable: false, scopable: false },
          { code: 'packshot', type: 'pim_catalog_image', label: 'Packshot', localizable: false, scopable: false },
          { code: 'price', type: 'pim_catalog_price_collection', label: 'Price', localizable: false, scopable: true },
        ],
        families: [{ code: 'clothing', label: 'Clothing', attributeCount: 6 }],
        familyVariants: [{ familyCode: 'clothing', code: 'clothing_by_color', label: 'Clothing by color', axes: ['color'], attributes: ['sensor_type', 'packshot'] }],
      },
      localChannels: [{ code: 'online', name: 'Online' }],
      priceKinds: [{ code: 'regular', title: 'Regular', displayMode: 'money' }],
    })

    expect(mappings.productsMapping.settings?.products?.locale).toBe('de_DE')
    expect(mappings.productsMapping.settings?.products?.channel).toBe('ecommerce')
    expect(mappings.productsMapping.settings?.products?.importAllChannels).toBe(false)
    expect(mappings.productsMapping.settings?.products?.channels).toEqual(['ecommerce'])
    expect(mappings.productsMapping.settings?.products?.createMissingChannels).toBe(false)
    expect(mappings.productsMapping.settings?.products?.fieldMap.title).toBe('name')
    expect(mappings.productsMapping.settings?.products?.customFieldMappings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          attributeCode: 'sensor_type',
          target: 'variant',
        }),
      ]),
    )
    expect(mappings.productsMapping.settings?.products?.mediaMappings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          attributeCode: 'packshot',
          target: 'variant',
        }),
      ]),
    )
    expect(mappings.productsMapping.settings?.products?.priceMappings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          attributeCode: 'price',
          localChannelCode: 'online',
        }),
      ]),
    )
    expect(mappings.productsMapping.settings?.products?.fieldsetMappings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceCode: 'clothing',
          target: 'product',
        }),
        expect.objectContaining({
          sourceCode: 'clothing_by_color',
          target: 'variant',
        }),
      ]),
    )
    expect(mappings.attributesMapping.settings?.attributes?.familyCodeFilter).toEqual(['clothing'])
  })

  it('defaults product and category locale to en_US when env does not override it', () => {
    const preset = readAkeneoEnvPreset({
      OM_INTEGRATION_AKENEO_API_URL: 'https://example.akeneo.com',
      OM_INTEGRATION_AKENEO_CLIENT_ID: 'client-id',
      OM_INTEGRATION_AKENEO_CLIENT_SECRET: 'client-secret',
      OM_INTEGRATION_AKENEO_USERNAME: 'api-user',
      OM_INTEGRATION_AKENEO_PASSWORD: 'api-pass',
    })

    if (!preset) {
      throw new Error('Expected preset to be parsed')
    }

    const mappings = buildAkeneoMappingsFromPreset({
      preset,
      discovery: {
        locales: [{ code: 'de_DE', label: 'German', enabled: true }],
        channels: [{ code: 'ecommerce', label: 'Ecommerce', locales: ['de_DE'] }],
        attributes: [],
        families: [],
        familyVariants: [],
      },
      localChannels: [{ code: 'online', name: 'Online' }],
      priceKinds: [{ code: 'regular', title: 'Regular', displayMode: 'money' }],
    })

    expect(mappings.productsMapping.settings?.products?.locale).toBe('en_US')
    expect(mappings.categoriesMapping.settings?.categories?.locale).toBe('en_US')
  })

  it('keeps backward compatibility with legacy OPENMERCATO_AKENEO aliases', () => {
    const preset = readAkeneoEnvPreset({
      OPENMERCATO_AKENEO_API_URL: 'https://example.akeneo.com',
      OPENMERCATO_AKENEO_CLIENT_ID: 'client-id',
      OPENMERCATO_AKENEO_CLIENT_SECRET: 'client-secret',
      OPENMERCATO_AKENEO_USERNAME: 'api-user',
      OPENMERCATO_AKENEO_PASSWORD: 'api-pass',
    })

    expect(preset).not.toBeNull()
    expect(preset?.credentials.apiUrl).toBe('https://example.akeneo.com')
  })
})
