import type { MessageTypeDefinition } from '@open-mercato/shared/modules/messages/types'
import { DefaultMessageActions } from './components/defaults/DefaultMessageActions'
import { MessageConfirmationActions } from './components/confirmation/MessageConfirmationActions'
import { MessageConfirmationContent } from './components/confirmation/MessageConfirmationContent'
import { DefaultMessageContent } from './components/defaults/DefaultMessageContent'
import { DefaultMessageListItem } from './components/defaults/DefaultMessageListItem'

export const messageTypes: MessageTypeDefinition[] = [
  {
    type: 'default',
    module: 'messages',
    labelKey: 'messages.types.default',
    icon: 'mail',
    ui: {
      listItemComponent: 'messages.default.listItem',
      contentComponent: 'messages.default.content',
      actionsComponent: 'messages.default.actions',
    },
    ListItemComponent: DefaultMessageListItem,
    ContentComponent: DefaultMessageContent,
    ActionsComponent: DefaultMessageActions,
    allowReply: true,
    allowForward: true,
  },
  {
    type: 'messages.confirmation',
    module: 'messages',
    labelKey: 'messages.types.confirmation',
    icon: 'badge-check',
    color: 'green',
    ui: {
      listItemComponent: 'messages.default.listItem',
      contentComponent: 'messages.confirmation.content',
      actionsComponent: 'messages.confirmation.actions',
    },
    ListItemComponent: DefaultMessageListItem,
    ContentComponent: MessageConfirmationContent,
    ActionsComponent: MessageConfirmationActions,
    defaultActions: [
      {
        id: 'confirmation',
        label: 'Confirm',
        labelKey: 'messages.actions.confirmation',
        variant: 'default',
        icon: 'check',
        commandId: 'messages.confirmations.confirm',
        isTerminal: true,
        confirmRequired: true,
      },
    ],
    allowReply: true,
    allowForward: true,
  },
  {
    type: 'messages.defaultWithObjects',
    module: 'messages',
    labelKey: 'messages.types.defaultWithObjects',
    icon: 'attachment',
    color: 'blue',
    allowReply: true,
    allowForward: true,
  },
]

export default messageTypes
