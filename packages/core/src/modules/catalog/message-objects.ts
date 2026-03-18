import type { MessageObjectTypeDefinition } from '@open-mercato/shared/modules/messages/types'
import { MessageObjectDetail, MessageObjectPreview } from '@open-mercato/ui/backend/messages'

const objectMessageTypes = ['default', 'messages.defaultWithObjects']

export const messageObjectTypes: MessageObjectTypeDefinition[] = [
  {
    module: 'catalog',
    entityType: 'product',
    messageTypes: objectMessageTypes,
    entityId: 'catalog:catalog_product',
    optionLabelField: 'title',
    optionSubtitleField: 'subtitle',
    labelKey: 'catalog.messageObjects.product.title',
    icon: 'package',
    PreviewComponent: MessageObjectPreview,
    DetailComponent: MessageObjectDetail,
    actions: [
      {
        id: 'view',
        labelKey: 'common.view',
        variant: 'outline',
        href: '/backend/catalog/products/{entityId}',
      },
    ],
    loadPreview: async (entityId, ctx) => {
      if (typeof window !== 'undefined') {
        return { title: 'Product', subtitle: entityId }
      }
      const previews = await import('./lib/messageObjectPreviews')
      const productLoader = (
        previews as typeof previews & {
          loadCatalogProductPreview?: (id: string, previewCtx: typeof ctx) => Promise<{ title: string; subtitle?: string }>
        }
      ).loadCatalogProductPreview
      if (productLoader) return productLoader(entityId, ctx)
      return previews.loadCatalogCategoryPreview(entityId, ctx)
    },
  },
  {
    module: 'catalog',
    entityType: 'variant',
    messageTypes: objectMessageTypes,
    entityId: 'catalog:catalog_product_variant',
    optionLabelField: 'name',
    optionSubtitleField: 'sku',
    labelKey: 'catalog.variants.form.editTitle',
    icon: 'package-plus',
    PreviewComponent: MessageObjectPreview,
    DetailComponent: MessageObjectDetail,
    actions: [
      {
        id: 'view',
        labelKey: 'common.view',
        variant: 'outline',
        href: '/backend/catalog/products',
      },
    ],
    loadPreview: async (entityId, ctx) => {
      if (typeof window !== 'undefined') {
        return { title: 'Variant', subtitle: entityId }
      }
      const previews = await import('./lib/messageObjectPreviews')
      const variantLoader = (
        previews as typeof previews & {
          loadCatalogVariantPreview?: (id: string, previewCtx: typeof ctx) => Promise<{ title: string; subtitle?: string }>
        }
      ).loadCatalogVariantPreview
      if (variantLoader) return variantLoader(entityId, ctx)
      return previews.loadCatalogProductPreview(entityId, ctx)
    },
  },
  {
    module: 'catalog',
    entityType: 'category',
    messageTypes: objectMessageTypes,
    entityId: 'catalog:catalog_product_category',
    optionLabelField: 'name',
    optionSubtitleField: 'description',
    labelKey: 'catalog.messageObjects.category.title',
    icon: 'tag',
    PreviewComponent: MessageObjectPreview,
    DetailComponent: MessageObjectDetail,
    actions: [
      {
        id: 'view',
        labelKey: 'common.view',
        variant: 'outline',
        href: '/backend/catalog/categories/{entityId}/edit',
      },
    ],
    loadPreview: async (entityId, ctx) => {
      if (typeof window !== 'undefined') {
        return { title: 'Category', subtitle: entityId }
      }
      const { loadCatalogCategoryPreview } = await import('./lib/messageObjectPreviews')
      return loadCatalogCategoryPreview(entityId, ctx)
    },
  },
]

export default messageObjectTypes
