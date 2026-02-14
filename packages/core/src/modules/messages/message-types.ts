import type { MessageTypeDefinition } from '@open-mercato/shared/modules/messages/types'
import { DefaultMessageActions } from './components/DefaultMessageActions'
import { MessageConfirmationActions } from './components/MessageConfirmationActions'
import { MessageConfirmationContent } from './components/MessageConfirmationContent'
import { DefaultMessageContent } from './components/DefaultMessageContent'
import { DefaultMessageListItem } from './components/DefaultMessageListItem'

export const messageTypes: MessageTypeDefinition[] = [
  {
    type: 'default',
    module: 'messages',
    labelKey: 'messages.types.default',
    icon: 'mail',
    isCreateableByUser: true,
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
    isCreateableByUser: true,
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
  }
]

export default messageTypes
