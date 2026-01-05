import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import ProductSeoWidget from './widget.client'
import { publishProductSeoValidation } from './state'

const widget: InjectionWidgetModule<any, any> = {
  metadata: {
    id: 'catalog.injection.product-seo',
    title: 'Product SEO Helper',
    description: 'Helps optimize product metadata for search engines',
    features: ['catalog.products.edit'],
    priority: 90,
    enabled: true,
  },
  Widget: ProductSeoWidget,
  eventHandlers: {
    onBeforeSave: async (data, context) => {
      const issues: string[] = []
      const fieldErrors: Record<string, string> = {}

      const title = data?.title || data?.name
      if (typeof title === 'string' && title.length > 0) {
        if (title.length < 10) {
          issues.push('Title is too short (min 10 characters).')
          fieldErrors.title = 'Title is too short for good SEO (min 10 characters).'
        } else if (title.length > 60) {
          issues.push('Title is too long (max 60 characters recommended).')
          fieldErrors.title = 'Title is too long for optimal SEO (max 60 characters).'
        }
      }

      const description = data?.description
      if (typeof description === 'string') {
        if (description.trim().length === 0) {
          issues.push('Add a product description for better SEO.')
          fieldErrors.description = 'Provide a description to help search engines understand this product.'
        } else if (description.length < 50) {
          issues.push('Description is too short (min 50 characters).')
          fieldErrors.description = 'Description is too short for good SEO (min 50 characters).'
        }
      }

      if (issues.length) {
        const message = 'SEO helper blocked save. Improve the highlighted fields.'
        publishProductSeoValidation({ ok: false, issues, message })
        return { ok: false, message, fieldErrors }
      }

      publishProductSeoValidation({ ok: true, issues: [] })
      return { ok: true }
    },
  },
}

export default widget
