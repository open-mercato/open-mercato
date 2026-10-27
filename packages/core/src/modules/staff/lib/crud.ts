import type { CrudEventsConfig } from '@open-mercato/shared/lib/crud/types'
import type {
  StaffLeaveRequest,
  StaffTeam,
  StaffTeamMember,
  StaffTeamMemberActivity,
  StaffTeamMemberAddress,
  StaffTeamMemberComment,
  StaffTeamMemberJobHistory,
  StaffTeamRole,
  StaffTimeEntry,
  StaffTimeProject,
  StaffTimeProjectMember,
  StaffTimeReport,
  StaffTimeTag,
  StaffTimeTask,
  StaffTimeTaskComment,
  StaffTimeTaskStatus,
} from '../data/entities'

function buildCrudEvents<TEntity>(entity: string): CrudEventsConfig<TEntity> {
  return {
    module: 'staff',
    entity,
    persistent: true,
    buildPayload: (ctx) => ({
      id: ctx.identifiers.id,
      organizationId: ctx.identifiers.organizationId,
      tenantId: ctx.identifiers.tenantId,
    }),
  }
}

export const staffTeamCrudEvents = buildCrudEvents<StaffTeam>('team')
export const staffTeamRoleCrudEvents = buildCrudEvents<StaffTeamRole>('team_role')
export const staffTeamMemberCrudEvents = buildCrudEvents<StaffTeamMember>('team_member')
export const staffLeaveRequestCrudEvents = buildCrudEvents<StaffLeaveRequest>('leave_request')
export const staffTeamMemberAddressCrudEvents = buildCrudEvents<StaffTeamMemberAddress>('address')
export const staffTeamMemberCommentCrudEvents = buildCrudEvents<StaffTeamMemberComment>('comment')
export const staffTeamMemberActivityCrudEvents = buildCrudEvents<StaffTeamMemberActivity>('activity')
export const staffTeamMemberJobHistoryCrudEvents = buildCrudEvents<StaffTeamMemberJobHistory>('job_history')

// Timesheets
/**
 * Command ids the time-entries CRUD route registers. Exported so the route and the
 * custom write routes that drive the same commands share one string instead of
 * re-typing it (#4970). The CRUD cache resource tag no longer follows these ids —
 * the route declares an `events` config, which the factory prefers; see
 * `lib/timesheets/timeEntryCacheInvalidation.ts`.
 */
export const staffTimeEntryCommandIds = {
  create: 'staff.timesheets.time_entries.create',
  update: 'staff.timesheets.time_entries.update',
  delete: 'staff.timesheets.time_entries.delete',
} as const

export const staffTimeEntryCrudEvents = buildCrudEvents<StaffTimeEntry>('timesheets.time_entry')
export const staffTimeProjectCrudEvents = buildCrudEvents<StaffTimeProject>('timesheets.time_project')
export const staffTimeProjectMemberCrudEvents = buildCrudEvents<StaffTimeProjectMember>('timesheets.time_project_member')
export const staffTimeTaskCrudEvents = buildCrudEvents<StaffTimeTask>('timesheets.time_task')
export const staffTimeTaskStatusCrudEvents = buildCrudEvents<StaffTimeTaskStatus>('timesheets.time_task_status')
export const staffTimeTaskCommentCrudEvents = buildCrudEvents<StaffTimeTaskComment>('timesheets.time_task_comment')
export const staffTimeTagCrudEvents = buildCrudEvents<StaffTimeTag>('timesheets.time_tag')
export const staffTimeReportCrudEvents = buildCrudEvents<StaffTimeReport>('timesheets.time_report')
