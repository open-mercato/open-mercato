import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['api_docs.*'],
    admin: ['api_docs.view'],
    employee: ['api_docs.view'],
  },
}

export default setup
