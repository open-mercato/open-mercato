import type { MessageObjectTypeDefinition } from '@open-mercato/shared/modules/messages/types'
import { MessageObjectDetail, MessageObjectPreview } from '@open-mercato/ui/backend/messages'
import { LeaveRequestDetail } from './components/LeaveRequestDetail'
import { LeaveRequestPreview } from './components/LeaveRequestPreview'

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
    loadPreview: async (entityId) => {
      return {
        title: 'Leave request',
        subtitle: entityId,
      }
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
    PreviewComponent: MessageObjectPreview,
    DetailComponent: MessageObjectDetail,
    actions: [
      {
        id: 'view',
        labelKey: 'common.view',
        variant: 'outline',
        href: '/backend/staff/teams/{entityId}/edit',
        icon: 'external-link',
        isTerminal: false,
      },
    ],
    loadPreview: async (entityId) => {
      return {
        title: 'Team',
        subtitle: entityId,
      }
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
    PreviewComponent: MessageObjectPreview,
    DetailComponent: MessageObjectDetail,
    actions: [
      {
        id: 'view',
        labelKey: 'common.view',
        variant: 'outline',
        href: '/backend/staff/team-members/{entityId}',
        icon: 'external-link',
        isTerminal: false,
      },
    ],
    loadPreview: async (entityId) => {
      return {
        title: 'Team member',
        subtitle: entityId,
      }
    },
  },
  {
    module: 'staff',
    entityType: 'team_role',
    messageTypes: ['default', 'messages.defaultWithObjects'],
    entityId: 'staff:staff_team_role',
    optionLabelField: 'name',
    optionSubtitleField: 'description',
    labelKey: 'staff.messageObjects.teamRole.title',
    icon: 'shield',
    PreviewComponent: MessageObjectPreview,
    DetailComponent: MessageObjectDetail,
    actions: [
      {
        id: 'view',
        labelKey: 'common.view',
        variant: 'outline',
        href: '/backend/staff/team-roles/{entityId}/edit',
      },
    ],
    loadPreview: async (entityId) => {
      return { title: 'Team role', subtitle: entityId }
    },
  },
  {
    module: 'staff',
    entityType: 'my_availability',
    messageTypes: ['default', 'messages.defaultWithObjects'],
    entityId: 'planner:planner_availability_rule_set',
    optionLabelField: 'name',
    optionSubtitleField: 'description',
    labelKey: 'staff.messageObjects.myAvailability.title',
    icon: 'calendar-clock',
    PreviewComponent: MessageObjectPreview,
    DetailComponent: MessageObjectDetail,
    actions: [
      {
        id: 'view',
        labelKey: 'common.view',
        variant: 'outline',
        href: '/backend/staff/my-availability',
      },
    ],
    loadPreview: async (entityId) => {
      return { title: 'My availability', subtitle: entityId }
    },
  },
]

export default messageObjectTypes
