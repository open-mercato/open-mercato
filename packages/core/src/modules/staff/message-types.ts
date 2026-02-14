import type { MessageTypeDefinition } from '@open-mercato/shared/modules/messages/types'

export const messageTypes: MessageTypeDefinition[] = [
  {
    type: 'staff.leave_request_approval',
    module: 'staff',
    labelKey: 'staff.messages.leaveRequestApproval',
    icon: 'calendar-clock',
    color: 'amber',
    isCreateableByUser: true,
    ui: {
      listItemComponent: 'messages.default.listItem',
      contentComponent: 'messages.default.content',
      actionsComponent: 'messages.default.actions',
    },
    allowReply: true,
    allowForward: true,
    actionsExpireAfterHours: 168,
  },
  {
    type: 'staff.leave_request_status',
    module: 'staff',
    labelKey: 'staff.messages.leaveRequestStatus',
    icon: 'calendar-check',
    color: 'green',
    isCreateableByUser: true,
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
