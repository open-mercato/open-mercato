import { buildDefaultAkeneoMapping, normalizeAkeneoMapping } from '../lib/shared'

describe('akeneo mappings', () => {
  it('provides a default products mapping', () => {
    const mapping = buildDefaultAkeneoMapping('products')
    expect(mapping.entityType).toBe('products')
    expect(mapping.settings?.products?.fieldMap.title).toBe('name')
    expect(mapping.settings?.products?.reconciliation.deleteMissingMedia).toBe(true)
    expect(mapping.settings?.products?.importAllChannels).toBe(true)
  })

  it('normalizes persisted mappings without dropping settings', () => {
    const mapping = normalizeAkeneoMapping('products', {
      entityType: 'products',
      matchStrategy: 'externalId',
      fields: [{ externalField: 'title_attr', localField: 'title' }],
      settings: {
        products: {
          locale: 'pl_PL',
          channel: 'ecommerce',
          channels: ['ecommerce', 'mobile'],
          importAllChannels: false,
          fieldMap: {
            title: 'title_attr',
            subtitle: 'subtitle_attr',
            description: 'description_attr',
            sku: 'sku_attr',
            barcode: 'barcode_attr',
            weight: 'weight_attr',
            variantName: 'variant_name_attr',
          },
          customFieldMappings: [
            { attributeCode: 'material', target: 'product', fieldKey: 'akeneo_material', kind: 'select', skip: true },
          ],
          priceMappings: [
            { attributeCode: 'price', priceKindCode: 'regular', akeneoChannel: 'ecommerce', localChannelCode: 'web' },
          ],
          mediaMappings: [
            { attributeCode: 'main_image', target: 'product', kind: 'image' },
          ],
          syncAssociations: false,
          reconciliation: {
            deactivateMissingCategories: false,
            deactivateMissingProducts: true,
            deactivateMissingAttributes: true,
            deleteMissingOffers: false,
            deleteMissingPrices: true,
            deleteMissingMedia: false,
            deleteMissingAttachments: true,
          },
        },
      },
    })
    expect(mapping.fields[0]?.externalField).toBe('title_attr')
    expect(mapping.settings?.products?.locale).toBe('pl_PL')
    expect(mapping.settings?.products?.channel).toBe('ecommerce')
    expect(mapping.settings?.products?.channels).toEqual(['ecommerce', 'mobile'])
    expect(mapping.settings?.products?.importAllChannels).toBe(false)
    expect(mapping.settings?.products?.customFieldMappings[0]?.fieldKey).toBe('akeneo_material')
    expect(mapping.settings?.products?.customFieldMappings[0]?.skip).toBe(true)
    expect(mapping.settings?.products?.priceMappings[0]?.localChannelCode).toBe('web')
    expect(mapping.settings?.products?.mediaMappings[0]?.kind).toBe('image')
    expect(mapping.settings?.products?.syncAssociations).toBe(false)
    expect(mapping.settings?.products?.reconciliation.deleteMissingMedia).toBe(false)
  })
})
