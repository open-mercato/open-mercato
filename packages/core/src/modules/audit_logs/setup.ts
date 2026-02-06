import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    admin: ['audit_logs.*'],
    employee: ['audit_logs.view_self', 'audit_logs.undo_self'],
  },
}

export default setup
