import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { appendWidgetsToRoles } from '@open-mercato/core/modules/dashboards/lib/role-widgets'
import { seedStaffAddressTypes, seedStaffTeamExamples } from './lib/seeds'
import { seedStaffTimeTrackingExamples } from './lib/timeTrackingSeeds'

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
    // Runs after the team examples because every project it staffs, every task it
    // assigns and every hour it logs points at a staff member those seeds create.
    await seedStaffTimeTrackingExamples(ctx.em, scope)
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
      'staff.timesheets.tasks.view',
      'staff.timesheets.tasks.manage',
      'staff.timesheets.rates.view',
    ],
  },

  /**
   * EP-50. `portal.time_reports.view` is a **customer** feature, granted through
   * `CustomerRoleAcl`, and it is deliberately absent from `acl.ts` — that file is
   * the staff feature catalog and the two namespaces are graded by different RBAC
   * services.
   *
   * `viewer` gets it as well as `buyer`: reading the hours already delivered is a
   * read, and a client who may see their invoices may see what they paid for.
   * `portal_admin` holds `portal.*` and needs no entry.
   */
  defaultCustomerRoleFeatures: {
    buyer: ['portal.time_reports.view'],
    viewer: ['portal.time_reports.view'],
  },
}

export default setup
