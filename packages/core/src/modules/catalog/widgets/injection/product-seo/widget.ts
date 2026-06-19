import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import ProductSeoWidget from './widget.client'
import { publishProductSeoValidation } from './state'
import { evaluateProductSeo } from './validation'

const widget: InjectionWidgetModule<any, any> = {
  metadata: {
    id: 'catalog.injection.product-seo',
    title: 'Product SEO Helper',
    description: 'Helps optimize product metadata for search engines',
    features: ['catalog.products.edit'],
    priority: 90,
    enabled: true,
    requiredFields: ['description'],
  },
  Widget: ProductSeoWidget,
  eventHandlers: {
    onBeforeSave: async (data) => {
      const evaluation = evaluateProductSeo(data as Record<string, unknown>)

      if (!evaluation.ok) {
        publishProductSeoValidation({ ok: false, issues: evaluation.issues, message: evaluation.message })
        return { ok: false, message: evaluation.message, fieldErrors: evaluation.fieldErrors }
      }

      publishProductSeoValidation({ ok: true, issues: [] })
      return { ok: true }
    },
  },
}

export default widget
