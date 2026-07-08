import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    admin: ['documents.*'],
    employee: ['documents.view', 'documents.create', 'documents.edit', 'documents.share'],
  },
}

export default setup
