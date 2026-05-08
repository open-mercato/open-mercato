import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    admin: [
      'forms.view',
      'forms.design',
      'forms.submissions.manage',
      'forms.submissions.anonymize',
    ],
  },
}

export default setup
