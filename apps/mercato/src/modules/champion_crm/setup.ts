import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['champion_crm.*'],
    admin: ['champion_crm.*'],
    employee: [
      'champion_crm.read',
      'champion_crm.leads.manage',
      'champion_crm.contacts.manage',
      'champion_crm.deals.manage',
      'champion_crm.activities.manage',
      'champion_crm.consents.read',
      'champion_crm.ai.use',
    ],
  },
}

export default setup

