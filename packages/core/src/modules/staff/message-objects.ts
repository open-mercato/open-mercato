import type { MessageObjectTypeDefinition } from '@open-mercato/shared/modules/messages/types'
import { LeaveRequestDetail } from './components/LeaveRequestDetail'
import { LeaveRequestObjectPicker } from './components/LeaveRequestObjectPicker'
import { LeaveRequestPreview } from './components/LeaveRequestPreview'

export const messageObjectTypes: MessageObjectTypeDefinition[] = [
  {
    module: 'staff',
    entityType: 'leave_request',
    messageTypes: ['default', 'staff.leave_request_approval', 'staff.leave_request_status'],
    entityId: 'staff:staff_leave_request',
    optionLabelField: 'id',
    optionSubtitleField: 'status',
    labelKey: 'staff.messageObjects.leaveRequest',
    icon: 'calendar-clock',
    PreviewComponent: LeaveRequestPreview,
    DetailComponent: LeaveRequestDetail,
    ObjectPickerComponent: LeaveRequestObjectPicker,
    actions: [
      {
        id: 'approve',
        labelKey: 'staff.notifications.leaveRequest.actions.approve',
        variant: 'default',
        commandId: 'staff.leave-requests.accept',
        icon: 'check',
      },
      {
        id: 'reject',
        labelKey: 'staff.notifications.leaveRequest.actions.reject',
        variant: 'destructive',
        commandId: 'staff.leave-requests.reject',
        icon: 'x',
      },
      {
        id: 'view',
        labelKey: 'common.view',
        variant: 'outline',
        href: '/backend/staff/leave-requests/{entityId}',
        icon: 'external-link',
        isTerminal: false,
      },
    ],
    loadPreview: async (entityId, ctx) => {
      if (typeof window !== 'undefined') {
        return {
          title: 'Leave request',
          subtitle: entityId,
        }
      }
      const { loadLeaveRequestPreview } = await import('./lib/messageObjectPreviews')
      return loadLeaveRequestPreview(entityId, ctx)
    },
  },
]

export default messageObjectTypes
