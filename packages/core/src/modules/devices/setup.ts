import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    // `auth.users.list` is granted alongside `devices.admin` rather than left to the auth module's
    // own `admin: ['auth.*']`, so the dependency declared in `acl.ts` holds even where that grant
    // was narrowed. Without it the owner picker has nothing to offer and the register form cannot
    // be completed. Existing tenants pick this up via `yarn mercato auth sync-role-acls`.
    superadmin: ['devices.*', 'auth.users.list'],
    admin: ['devices.*', 'auth.users.list'],
    employee: ['devices.view', 'devices.manage'],
  },
}

export default setup
