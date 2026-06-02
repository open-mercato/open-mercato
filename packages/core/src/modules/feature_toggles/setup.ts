import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    // Global feature toggles are a platform-wide (non-tenant-scoped) table, so
    // creating/updating/deleting them is restricted to super administrators.
    superadmin: ['feature_toggles.global.manage'],
    // Tenant admins may view global toggles and manage their own per-tenant
    // overrides, but MUST NOT mutate the shared global toggle definitions.
    // Granted explicitly (not via `feature_toggles.*`) so the wildcard does not
    // implicitly cover `feature_toggles.global.manage`.
    admin: ['feature_toggles.view', 'feature_toggles.manage'],
  },
}

export default setup
