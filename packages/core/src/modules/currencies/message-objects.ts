import type { MessageObjectTypeDefinition } from '@open-mercato/shared/modules/messages/types'
import clientMessageObjectTypes from './message-objects.client'

type PreviewLoader = NonNullable<MessageObjectTypeDefinition['loadPreview']>

const previewLoaders: Record<string, PreviewLoader | undefined> = {
  currency: async (entityId, ctx) => {
    const { loadCurrencyPreview } = await import('./lib/messageObjectPreviews')
    return loadCurrencyPreview(entityId, ctx)
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
