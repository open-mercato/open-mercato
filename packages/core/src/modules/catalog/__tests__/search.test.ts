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
})
