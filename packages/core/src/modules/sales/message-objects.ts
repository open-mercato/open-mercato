import type { MessageObjectTypeDefinition } from '@open-mercato/shared/modules/messages/types'
import clientMessageObjectTypes from './message-objects.client'

type PreviewLoader = NonNullable<MessageObjectTypeDefinition['loadPreview']>

const previewLoaders: Record<string, PreviewLoader | undefined> = {
  order: async (entityId, ctx) => {
    const { loadSalesOrderPreview } = await import('./lib/messageObjectPreviews')
    return loadSalesOrderPreview(entityId, ctx)
  },
  quote: async (entityId, ctx) => {
    const { loadSalesQuotePreview } = await import('./lib/messageObjectPreviews')
    return loadSalesQuotePreview(entityId, ctx)
  },
  channel: async (entityId, ctx) => {
    const { loadSalesChannelPreview } = await import('./lib/messageObjectPreviews')
    return loadSalesChannelPreview(entityId, ctx)
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
