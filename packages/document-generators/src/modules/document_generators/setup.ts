import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['document_generators.documents.view', 'document_generators.documents.generate'],
    admin: ['document_generators.documents.view', 'document_generators.documents.generate'],
  },
}

export default setup
