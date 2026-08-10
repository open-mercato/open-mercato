import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['document_generators.view', 'document_generators.generate'],
    admin: ['document_generators.view', 'document_generators.generate'],
  },
}

export default setup
