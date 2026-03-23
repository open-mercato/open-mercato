import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: 'staff.team.created', label: 'Team Created', entity: 'team', category: 'crud' },
  { id: 'staff.team.updated', label: 'Team Updated', entity: 'team', category: 'crud' },
  { id: 'staff.team.deleted', label: 'Team Deleted', entity: 'team', category: 'crud' },
  { id: 'staff.team_role.created', label: 'Team Role Created', entity: 'team_role', category: 'crud' },
  { id: 'staff.team_role.updated', label: 'Team Role Updated', entity: 'team_role', category: 'crud' },
  { id: 'staff.team_role.deleted', label: 'Team Role Deleted', entity: 'team_role', category: 'crud' },
  { id: 'staff.team_member.created', label: 'Team Member Created', entity: 'team_member', category: 'crud' },
  { id: 'staff.team_member.updated', label: 'Team Member Updated', entity: 'team_member', category: 'crud' },
  { id: 'staff.team_member.deleted', label: 'Team Member Deleted', entity: 'team_member', category: 'crud' },
  { id: 'staff.leave_request.created', label: 'Leave Request Created', entity: 'leave_request', category: 'crud' },
  { id: 'staff.leave_request.updated', label: 'Leave Request Updated', entity: 'leave_request', category: 'crud' },
  { id: 'staff.leave_request.deleted', label: 'Leave Request Deleted', entity: 'leave_request', category: 'crud' },
  { id: 'staff.address.created', label: 'Staff Address Created', entity: 'address', category: 'crud' },
  { id: 'staff.address.updated', label: 'Staff Address Updated', entity: 'address', category: 'crud' },
  { id: 'staff.address.deleted', label: 'Staff Address Deleted', entity: 'address', category: 'crud' },
  { id: 'staff.comment.created', label: 'Staff Comment Created', entity: 'comment', category: 'crud' },
  { id: 'staff.comment.updated', label: 'Staff Comment Updated', entity: 'comment', category: 'crud' },
  { id: 'staff.comment.deleted', label: 'Staff Comment Deleted', entity: 'comment', category: 'crud' },
  { id: 'staff.activity.created', label: 'Staff Activity Created', entity: 'activity', category: 'crud' },
  { id: 'staff.activity.updated', label: 'Staff Activity Updated', entity: 'activity', category: 'crud' },
  { id: 'staff.activity.deleted', label: 'Staff Activity Deleted', entity: 'activity', category: 'crud' },
  { id: 'staff.job_history.created', label: 'Job History Created', entity: 'job_history', category: 'crud' },
  { id: 'staff.job_history.updated', label: 'Job History Updated', entity: 'job_history', category: 'crud' },
  { id: 'staff.job_history.deleted', label: 'Job History Deleted', entity: 'job_history', category: 'crud' },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'staff',
  events,
})

export const emitStaffEvent = eventsConfig.emit

export type StaffEventId = typeof events[number]['id']

export default eventsConfig
