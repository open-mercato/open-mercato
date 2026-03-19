import type { MessageTypeDefinition } from '@open-mercato/shared/modules/messages/types'

export const messageTypes: MessageTypeDefinition[] = [
  {
    type: 'staff.leave_request_approval',
    module: 'staff',
    labelKey: 'staff.messages.leaveRequestApproval',
    icon: 'calendar-clock',
    color: 'amber',
    ui: {
      listItemComponent: 'messages.default.listItem',
      contentComponent: 'messages.default.content',
      actionsComponent: 'messages.default.actions',
    },
    allowReply: true,
    allowForward: true,
    actionsExpireAfterHours: 168,
  }
]

export default messageTypes
