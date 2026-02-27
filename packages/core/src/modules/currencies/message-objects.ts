import type { MessageObjectTypeDefinition } from '@open-mercato/shared/modules/messages/types'
import { MessageObjectDetail, MessageObjectPreview } from '@open-mercato/ui/backend/messages'

const objectMessageTypes = ['default', 'messages.defaultWithObjects']

export const messageObjectTypes: MessageObjectTypeDefinition[] = [
  {
    module: 'currencies',
    entityType: 'currency',
    messageTypes: objectMessageTypes,
    entityId: 'currencies:currency',
    optionLabelField: 'name',
    optionSubtitleField: 'code',
    labelKey: 'currencies.messageObjects.currency.title',
    icon: 'coins',
    PreviewComponent: MessageObjectPreview,
    DetailComponent: MessageObjectDetail,
    actions: [
      {
        id: 'view',
        labelKey: 'common.view',
        variant: 'outline',
        href: '/backend/currencies/{entityId}',
      },
    ],
    loadPreview: async (entityId, ctx) => {
      if (typeof window !== 'undefined') {
        return {
          title: 'Currency',
          subtitle: entityId,
          metadata: { id: entityId },
        }
      }
      const { loadCurrencyPreview } = await import('./lib/messageObjectPreviews')
      return loadCurrencyPreview(entityId, ctx)
    },
  },
]

export default messageObjectTypes
