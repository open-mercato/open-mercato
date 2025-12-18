import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import ProductSeoWidget from './widget.client'

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
      // Example: Validate that title and description are SEO-friendly
      const title = data?.title || data?.name
      if (typeof title === 'string' && title.length > 0) {
        if (title.length < 10) {
          console.warn('[Product SEO] Title is too short for good SEO (< 10 characters)')
        }
        if (title.length > 60) {
          console.warn('[Product SEO] Title is too long for optimal SEO (> 60 characters)')
        }
      }
      
      const description = data?.description
      if (typeof description === 'string' && description.length > 0) {
        if (description.length < 50) {
          console.warn('[Product SEO] Description is too short for good SEO (< 50 characters)')
        }
      }
      
      return true
    },
  },
}

export default widget
