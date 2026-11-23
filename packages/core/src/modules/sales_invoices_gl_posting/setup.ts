import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    admin: [
      'sales_invoices_gl_posting.invoices.post',
      'sales_invoices_gl_posting.settings.manage',
    ],
  },
}

export default setup
