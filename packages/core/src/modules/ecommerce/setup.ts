import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { seedDraftStore } from './lib/seedDraftStore'

export const setup: ModuleSetupConfig = {
  async onTenantCreated({ em, tenantId, organizationId }) {
    await seedDraftStore(em, { tenantId, organizationId })
  },
  defaultRoleFeatures: {
    superadmin: ['ecommerce.*'],
    admin: ['ecommerce.*'],
    employee: ['ecommerce.stores.view'],
  },
}

export default setup
