import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { seedDefaultDocumentTemplates } from './lib/templateSeeds'

export const setup: ModuleSetupConfig = {
  async onTenantCreated({ em, tenantId, organizationId }) {
    await seedDefaultDocumentTemplates(em, { tenantId, organizationId })
  },

  async seedDefaults({ em, tenantId, organizationId }) {
    await seedDefaultDocumentTemplates(em, { tenantId, organizationId })
  },

  defaultRoleFeatures: {
    admin: ['documents.*'],
    employee: ['documents.view', 'documents.create', 'documents.edit', 'documents.share'],
  },
}

export default setup
