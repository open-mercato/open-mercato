import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

/**
 * Grants reach NEW tenants here; an existing tenant needs the idempotent
 * `yarn mercato auth sync-role-acls` to pick up a feature added after it was
 * created — which is exactly how a screen can be visible to one tenant's admins
 * and forbidden to another's.
 */
export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['saudi_localization.*'],
    admin: ['saudi_localization.*'],
    employee: [
      'saudi_localization.settings.view',
      'saudi_localization.vat_return.view',
      'saudi_localization.withholding.view',
      'saudi_localization.zakat.view',
      'saudi_localization.einvoicing.view',
    ],
  },
}

export default setup
