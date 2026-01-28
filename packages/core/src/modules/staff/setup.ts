import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { seedStaffAddressTypes, seedStaffTeamExamples } from './lib/seeds'

export const setup: ModuleSetupConfig = {
  seedDefaults: async (ctx) => {
    const scope = { tenantId: ctx.tenantId, organizationId: ctx.organizationId }
    await seedStaffAddressTypes(ctx.em, scope)
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
    ],
  },
}

export default setup
