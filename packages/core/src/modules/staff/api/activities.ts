import { makeActivityRoute } from '@open-mercato/core/modules/entities/lib/makeActivityRoute'
import { StaffTeamMemberActivity } from '../data/entities'
import {
  staffTeamMemberActivityCreateSchema,
  staffTeamMemberActivityUpdateSchema,
} from '../data/validators'
import { E } from '#generated/entities.ids.generated'
import { createStaffCrudOpenApi } from './openapi'

const route = makeActivityRoute({
  entity: StaffTeamMemberActivity,
  entityId: E.staff.staff_team_member_activity,
  parentFkColumn: 'member_id',
  parentFkParam: 'memberId',
  features: { view: 'staff.view', manage: 'staff.manage_team' },
  createSchema: staffTeamMemberActivityCreateSchema,
  updateSchema: staffTeamMemberActivityUpdateSchema,
  commandPrefix: 'staff.team-member-activities',
  logPrefix: '[staff.activities]',
  openApiFactory: createStaffCrudOpenApi,
  openApi: {
    resourceName: 'TeamMemberActivity',
    createDescription: 'Adds an activity to a team member timeline.',
    updateDescription: 'Updates a team member activity.',
    deleteDescription: 'Deletes a team member activity.',
  },
})

export const metadata = route.metadata
export const openApi = route.openApi
export const GET = route.GET
export const POST = route.POST
export const PUT = route.PUT
export const DELETE = route.DELETE
