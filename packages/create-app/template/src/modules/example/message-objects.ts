import type { MessageObjectTypeDefinition } from '@open-mercato/shared/modules/messages/types'
import { MessageObjectDetail, MessageObjectPreview } from '@open-mercato/ui/backend/messages'

const objectMessageTypes = ['default', 'messages.defaultWithObjects']

export const messageObjectTypes: MessageObjectTypeDefinition[] = [
  {
    module: 'example',
    entityType: 'todo',
    messageTypes: objectMessageTypes,
    entityId: 'example:todo',
    optionLabelField: 'title',
    labelKey: 'example.todos.table.title',
    icon: 'check-square',
    PreviewComponent: MessageObjectPreview,
    DetailComponent: MessageObjectDetail,
    actions: [
      {
        id: 'view',
        labelKey: 'common.view',
        variant: 'outline',
        href: '/backend/todos/{entityId}/edit',
      },
    ],
    loadPreview: async (entityId, ctx) => {
      if (typeof window !== 'undefined') {
        return { title: 'Todo', subtitle: entityId }
      }
      const { loadTodoPreview } = await import('./lib/messageObjectPreviews')
      return loadTodoPreview(entityId, ctx)
    },
  },
]

export default messageObjectTypes
