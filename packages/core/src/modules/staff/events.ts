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

  // Timesheets (Phase 1)
  { id: 'staff.timesheets.time_entry.created', label: 'Time Entry Created', entity: 'time_entry', category: 'crud', clientBroadcast: true },
  { id: 'staff.timesheets.time_entry.updated', label: 'Time Entry Updated', entity: 'time_entry', category: 'crud', clientBroadcast: true },
  { id: 'staff.timesheets.time_entry.deleted', label: 'Time Entry Deleted', entity: 'time_entry', category: 'crud', clientBroadcast: true },
  { id: 'staff.timesheets.time_entry.timer_started', label: 'Timer Started', entity: 'time_entry', category: 'lifecycle', clientBroadcast: true },
  { id: 'staff.timesheets.time_entry.timer_stopped', label: 'Timer Stopped', entity: 'time_entry', category: 'lifecycle', clientBroadcast: true },
  { id: 'staff.timesheets.time_project.created', label: 'Time Project Created', entity: 'time_project', category: 'crud' },
  { id: 'staff.timesheets.time_project.updated', label: 'Time Project Updated', entity: 'time_project', category: 'crud' },
  { id: 'staff.timesheets.time_project.deleted', label: 'Time Project Deleted', entity: 'time_project', category: 'crud' },
  { id: 'staff.timesheets.time_project_member.created', label: 'Time Project Member Assigned', entity: 'time_project_member', category: 'crud' },
  { id: 'staff.timesheets.time_project_member.updated', label: 'Time Project Member Updated', entity: 'time_project_member', category: 'crud' },
  { id: 'staff.timesheets.time_project_member.deleted', label: 'Time Project Member Unassigned', entity: 'time_project_member', category: 'crud' },

  // Time tracking (Phase 2)
  { id: 'staff.timesheets.time_task.created', label: 'Time Task Created', entity: 'time_task', category: 'crud' },
  { id: 'staff.timesheets.time_task.updated', label: 'Time Task Updated', entity: 'time_task', category: 'crud' },
  { id: 'staff.timesheets.time_task.deleted', label: 'Time Task Deleted', entity: 'time_task', category: 'crud' },
  { id: 'staff.timesheets.time_task.status_changed', label: 'Time Task Status Changed', entity: 'time_task', category: 'lifecycle', clientBroadcast: true },
  { id: 'staff.timesheets.time_task_comment.created', label: 'Time Task Comment Created', entity: 'time_task_comment', category: 'crud' },
  { id: 'staff.timesheets.time_task_comment.updated', label: 'Time Task Comment Updated', entity: 'time_task_comment', category: 'crud' },
  { id: 'staff.timesheets.time_task_comment.deleted', label: 'Time Task Comment Deleted', entity: 'time_task_comment', category: 'crud' },
  { id: 'staff.timesheets.time_report.created', label: 'Time Report Created', entity: 'time_report', category: 'crud' },
  { id: 'staff.timesheets.time_report.updated', label: 'Time Report Updated', entity: 'time_report', category: 'crud' },
  { id: 'staff.timesheets.time_report.deleted', label: 'Time Report Deleted', entity: 'time_report', category: 'crud' },
  { id: 'staff.timesheets.time_report.closed', label: 'Time Report Closed', entity: 'time_report', category: 'lifecycle', clientBroadcast: true },
  { id: 'staff.timesheets.time_report.unlocked', label: 'Time Report Unlocked', entity: 'time_report', category: 'lifecycle', clientBroadcast: true },
  { id: 'staff.timesheets.time_project.budget_threshold_reached', label: 'Time Project Budget Threshold Reached', entity: 'time_project', category: 'lifecycle', clientBroadcast: true },
  { id: 'staff.timesheets.project_access.requested', label: 'Time Project Access Requested', entity: 'time_project', category: 'lifecycle' },

  // `clientBroadcast: true` above puts the event on the DOM Event Bridge, whose only
  // audience filter is tenant + organization (`events/api/stream/route.ts`): every
  // signed-in user of the organization receives the payload, with no feature check.
  // So a broadcast payload MUST NOT carry a rate, a cost or an amount — money is
  // gated on `staff.timesheets.rates.view` (staff/AGENTS.md), a gate SSE cannot
  // apply. `time_report.closed` and `time_project.budget_threshold_reached` emit
  // their money fields conditionally for exactly this reason; see their emitters.

  // Time tracking (Phase 3) — transitions owned by the hand-rolled routes that sit
  // beside the CRUD factory resources. Declared here so a third-party module can
  // subscribe to a bulk grid save, a copy, a segment edit, an export or a settings
  // change with the same contract the CRUD ids already offer.
  { id: 'staff.timesheets.time_entry.bulk_updated', label: 'Time Entries Bulk Saved', entity: 'time_entry', category: 'lifecycle' },
  { id: 'staff.timesheets.time_entry.copied', label: 'Time Entry Copied', entity: 'time_entry', category: 'lifecycle' },
  { id: 'staff.timesheets.time_entry.locked', label: 'Time Entries Locked', entity: 'time_entry', category: 'lifecycle' },
  { id: 'staff.timesheets.time_entry.unlocked', label: 'Time Entries Unlocked', entity: 'time_entry', category: 'lifecycle' },
  { id: 'staff.timesheets.time_entry_segment.created', label: 'Time Entry Segment Created', entity: 'time_entry_segment', category: 'crud' },
  { id: 'staff.timesheets.time_entry_segment.updated', label: 'Time Entry Segment Updated', entity: 'time_entry_segment', category: 'crud' },
  { id: 'staff.timesheets.time_entry_segment.deleted', label: 'Time Entry Segment Deleted', entity: 'time_entry_segment', category: 'crud' },
  { id: 'staff.timesheets.time_report.exported', label: 'Time Report Exported', entity: 'time_report', category: 'lifecycle' },
  { id: 'staff.timesheets.time_project.currency_changed', label: 'Time Project Currency Changed', entity: 'time_project', category: 'lifecycle' },
  { id: 'staff.timesheets.time_project_access.granted', label: 'Time Project Access Granted', entity: 'time_project', category: 'lifecycle' },
  { id: 'staff.timesheets.time_project_access.denied', label: 'Time Project Access Denied', entity: 'time_project', category: 'lifecycle' },
  { id: 'staff.timesheets.time_tracking.settings_updated', label: 'Time Tracking Settings Updated', entity: 'time_tracking', category: 'lifecycle' },
  { id: 'staff.timesheets.time_tracking.rounding_reapplied', label: 'Time Tracking Rounding Reapplied', entity: 'time_tracking', category: 'lifecycle' },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'staff',
  events,
})

export const emitStaffEvent = eventsConfig.emit

export type StaffEventId = typeof events[number]['id']

export default eventsConfig
