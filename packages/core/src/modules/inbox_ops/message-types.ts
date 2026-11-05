import type { MessageTypeDefinition } from '@open-mercato/shared/modules/messages/types'
import { InboxEmailContent } from './components/messages/InboxEmailContent'

export const messageTypes: MessageTypeDefinition[] = [
  {
    type: 'inbox_ops.email',
    module: 'inbox_ops',
    labelKey: 'inbox_ops.title',
    icon: 'mail-open',
    color: 'blue',
    ui: {
      listItemComponent: 'messages.default.listItem',
      contentComponent: 'inbox_ops.email.content',
      actionsComponent: 'messages.default.actions',
    },
    ContentComponent: InboxEmailContent,
    allowReply: false,
    allowForward: true,
  },
  {
    type: 'inbox_ops.reply',
    module: 'inbox_ops',
    labelKey: 'inbox_ops.action_type.draft_reply',
    icon: 'reply',
    color: 'green',
    ui: {
      listItemComponent: 'messages.default.listItem',
      contentComponent: 'messages.default.content',
      actionsComponent: 'messages.default.actions',
    },
    allowReply: true,
    allowForward: true,
  },
]

export default messageTypes
