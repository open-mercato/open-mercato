import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { appendWidgetsToRoles } from '@open-mercato/core/modules/dashboards/lib/role-widgets'
import { seedStaffAddressTypes, seedStaffTeamExamples } from './lib/seeds'

const TIMESHEETS_DASHBOARD_WIDGET_IDS = [
  'staff.timesheets.timeReporting',
  'staff.timesheets.hoursByProject',
]

export const setup: ModuleSetupConfig = {
  seedDefaults: async (ctx) => {
    const scope = { tenantId: ctx.tenantId, organizationId: ctx.organizationId }
    await seedStaffAddressTypes(ctx.em, scope)
    await appendWidgetsToRoles(ctx.em, {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      roleNames: ['superadmin', 'admin', 'employee'],
      widgetIds: TIMESHEETS_DASHBOARD_WIDGET_IDS,
    })
  },

  seedExamples: async (ctx) => {
    const scope = { tenantId: ctx.tenantId, organizationId: ctx.organizationId }
    await seedStaffTeamExamples(ctx.em, scope)
  },

  defaultRoleFeatures: {
    admin: ['staff.*', 'staff.leave_requests.manage'],
    employee: [
      'staff.leave_requests.send',
      'staff.my_availability.view',
      'staff.my_availability.manage',
      'staff.my_leave_requests.view',
      'staff.my_leave_requests.send',
      'staff.timesheets.view',
      'staff.timesheets.manage_own',
      'staff.timesheets.projects.view',
    ],
  },
}

export default setup
