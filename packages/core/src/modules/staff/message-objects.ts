import type { MessageObjectTypeDefinition } from '@open-mercato/shared/modules/messages/types'
import { LeaveRequestDetail } from './components/LeaveRequestDetail'
import { LeaveRequestPreview } from './components/LeaveRequestPreview'
import { StaffMessageObjectDetail } from './components/StaffMessageObjectDetail'
import { StaffMessageObjectPreview } from './components/StaffMessageObjectPreview'

export const messageObjectTypes: MessageObjectTypeDefinition[] = [
  {
    module: 'staff',
    entityType: 'leave_request',
    messageTypes: ['default', 'messages.defaultWithObjects', 'staff.leave_request_approval', 'staff.leave_request_status'],
    entityId: 'staff:staff_leave_request',
    optionLabelField: 'id',
    optionSubtitleField: 'status',
    labelKey: 'staff.leaveRequests.page.title',
    icon: 'calendar-clock',
    PreviewComponent: LeaveRequestPreview,
    DetailComponent: LeaveRequestDetail,
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
  {
    module: 'staff',
    entityType: 'team',
    messageTypes: ['default', 'messages.defaultWithObjects'],
    entityId: 'staff:staff_team',
    optionLabelField: 'name',
    optionSubtitleField: 'description',
    labelKey: 'staff.teams.page.title',
    icon: 'users',
    PreviewComponent: StaffMessageObjectPreview,
    DetailComponent: StaffMessageObjectDetail,
    actions: [],
    loadPreview: async (entityId, ctx) => {
      if (typeof window !== 'undefined') {
        return {
          title: 'Team',
          subtitle: entityId,
        }
      }
      const { loadTeamPreview } = await import('./lib/messageObjectPreviews')
      return loadTeamPreview(entityId, ctx)
    },
  },
  {
    module: 'staff',
    entityType: 'team_member',
    messageTypes: ['default', 'messages.defaultWithObjects'],
    entityId: 'staff:staff_team_member',
    optionLabelField: 'displayName',
    optionSubtitleField: 'email',
    labelKey: 'staff.teamMembers.page.title',
    icon: 'user-round',
    PreviewComponent: StaffMessageObjectPreview,
    DetailComponent: StaffMessageObjectDetail,
    actions: [],
    loadPreview: async (entityId, ctx) => {
      if (typeof window !== 'undefined') {
        return {
          title: 'Team member',
          subtitle: entityId,
        }
      }
      const { loadTeamMemberPreview } = await import('./lib/messageObjectPreviews')
      return loadTeamMemberPreview(entityId, ctx)
    },
  },
]

export default messageObjectTypes
