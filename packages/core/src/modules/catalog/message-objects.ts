import type { MessageObjectTypeDefinition } from '@open-mercato/shared/modules/messages/types'
import clientMessageObjectTypes from './message-objects.client'

type PreviewLoader = NonNullable<MessageObjectTypeDefinition['loadPreview']>

const previewLoaders: Record<string, PreviewLoader | undefined> = {
  product: async (entityId, ctx) => {
    const previews = await import('./lib/messageObjectPreviews')
    const productLoader = (
      previews as typeof previews & {
        loadCatalogProductPreview?: (id: string, previewCtx: typeof ctx) => Promise<{ title: string; subtitle?: string }>
      }
    ).loadCatalogProductPreview
    if (productLoader) return productLoader(entityId, ctx)
    return previews.loadCatalogCategoryPreview(entityId, ctx)
  },
  variant: async (entityId, ctx) => {
    const previews = await import('./lib/messageObjectPreviews')
    const variantLoader = (
      previews as typeof previews & {
        loadCatalogVariantPreview?: (id: string, previewCtx: typeof ctx) => Promise<{ title: string; subtitle?: string }>
      }
    ).loadCatalogVariantPreview
    if (variantLoader) return variantLoader(entityId, ctx)
    return previews.loadCatalogProductPreview(entityId, ctx)
  },
  category: async (entityId, ctx) => {
    const { loadCatalogCategoryPreview } = await import('./lib/messageObjectPreviews')
    return loadCatalogCategoryPreview(entityId, ctx)
  },
}

export const messageObjectTypes: MessageObjectTypeDefinition[] = clientMessageObjectTypes.map((type) => {
  const loadServerPreview = previewLoaders[type.entityType]
  if (!loadServerPreview) return type
  return {
    ...type,
    loadPreview: (entityId, ctx) => {
      if (typeof window !== 'undefined' && type.loadPreview) return type.loadPreview(entityId, ctx)
      return loadServerPreview(entityId, ctx)
    },
  }
})

export default messageObjectTypes
