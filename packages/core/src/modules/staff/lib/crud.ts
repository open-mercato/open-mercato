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
export const staffTimeEntryCrudEvents = buildCrudEvents<StaffTimeEntry>('timesheets.time_entry')
export const staffTimeProjectCrudEvents = buildCrudEvents<StaffTimeProject>('timesheets.time_project')
