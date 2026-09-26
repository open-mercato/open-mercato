import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['hr.*', 'approvals.*'],
    admin: ['hr.*', 'approvals.action', 'approvals.config'],
    employee: ['hr.read'],
  },
}

export default setup