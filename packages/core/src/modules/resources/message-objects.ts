import type { MessageObjectTypeDefinition } from '@open-mercato/shared/modules/messages/types'
import { MessageObjectDetail } from '@open-mercato/ui/backend/messages/MessageObjectDetail'
import { MessageObjectPreview } from '@open-mercato/ui/backend/messages/MessageObjectPreview'

const objectMessageTypes = ['default', 'messages.defaultWithObjects']

export const messageObjectTypes: MessageObjectTypeDefinition[] = [
  {
    module: 'resources',
    entityType: 'resource',
    messageTypes: objectMessageTypes,
    entityId: 'resources:resources_resource',
    optionLabelField: 'name',
    optionSubtitleField: 'description',
    labelKey: 'resources.messageObjects.resource.title',
    icon: 'package',
    PreviewComponent: MessageObjectPreview,
    DetailComponent: MessageObjectDetail,
    actions: [
      {
        id: 'view',
        labelKey: 'common.view',
        variant: 'outline',
        href: '/backend/resources/resources/{entityId}',
      },
    ],
    loadPreview: async (entityId, ctx) => {
      if (typeof window !== 'undefined') {
        return { title: 'Resource', subtitle: entityId }
      }
      const { loadResourcePreview } = await import('./lib/messageObjectPreviews')
      return loadResourcePreview(entityId, ctx)
    },
  },
]

export default messageObjectTypes
