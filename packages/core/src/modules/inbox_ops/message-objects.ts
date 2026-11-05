import type { MessageObjectTypeDefinition } from '@open-mercato/shared/modules/messages/types'
import { InboxEmailPreview } from './components/messages/InboxEmailPreview'

export const messageObjectTypes: MessageObjectTypeDefinition[] = [
  {
    module: 'inbox_ops',
    entityType: 'inbox_email',
    messageTypes: ['inbox_ops.email', 'inbox_ops.reply'],
    labelKey: 'inbox_ops.title',
    icon: 'mail-open',
    PreviewComponent: InboxEmailPreview,
    actions: [
      {
        id: 'view',
        labelKey: 'inbox_ops.view_in_messages',
        variant: 'outline',
        href: '/backend/inbox-ops',
      },
    ],
    loadPreview: async (entityId, ctx) => {
      try {
        if (typeof window !== 'undefined') {
          return { title: 'Inbox Email', subtitle: entityId }
        }
        const { loadInboxEmailPreview } = await import('./lib/messageObjectPreviews')
        return loadInboxEmailPreview(entityId, ctx)
      } catch {
        return { title: 'Inbox Email', subtitle: entityId }
      }
    },
  },
]

export default messageObjectTypes
