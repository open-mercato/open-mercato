jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'pl',
    t: (key: string, fallbackOrParams?: string | Record<string, unknown>, params?: Record<string, unknown>) => {
      if (key === 'catalog.products.types.configurable') return 'Konfigurowalny'
      const fallback = typeof fallbackOrParams === 'string' ? fallbackOrParams : key
      const values = typeof fallbackOrParams === 'object' && fallbackOrParams ? fallbackOrParams : params
      let out = fallback
      if (values) for (const [name, value] of Object.entries(values)) out = out.replace(new RegExp(`{{${name}}}`, 'g'), String(value))
      return out
    },
  }),
}))

import { searchConfig } from '../search'
import { metadata as serviceEditPageMetadata } from '../backend/catalog/services/[id]/edit/page.meta'

describe('catalog search config', () => {
  test('product formatResult subtitle uses the translated product type label (#6174)', async () => {
    const productConfig = searchConfig.entities.find((entity) => entity.entityId === 'catalog:catalog_product')
    expect(productConfig?.formatResult).toBeDefined()

    const presenter = await productConfig!.formatResult!({
      record: {
        id: 'product-1',
        title: 'Demo T-shirt',
        sku: 'TSHIRT-001',
        product_type: 'configurable',
        is_active: true,
      },
      customFields: {},
    })

    expect(presenter.subtitle).toBe('TSHIRT-001 · Konfigurowalny')
  })

  test('product formatResult subtitle falls back to the raw value for an unknown type', async () => {
    const productConfig = searchConfig.entities.find((entity) => entity.entityId === 'catalog:catalog_product')

    const presenter = await productConfig!.formatResult!({
      record: {
        id: 'product-2',
        title: 'Demo Widget',
        sku: 'WIDGET-001',
        product_type: 'unknown_type',
        is_active: true,
      },
      customFields: {},
    })

    expect(presenter.subtitle).toBe('WIDGET-001 · unknown_type')
  })

  test('service results link to a page the search ACL already lets the user open', async () => {
    const serviceConfig = searchConfig.entities.find((entity) => entity.entityId === 'catalog:catalog_service')
    expect(serviceConfig?.aclFeatures).toEqual(['catalog.services.view'])

    const url = await serviceConfig!.resolveUrl!({
      record: { id: 'service-1', title: 'Workshop' },
      customFields: {},
    } as never)

    expect(url).toBe('/backend/catalog/services/service-1/edit')
    for (const feature of serviceEditPageMetadata.requireFeatures) {
      expect(serviceConfig!.aclFeatures).toContain(feature)
    }
  })
})
