import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import type { EntityManager } from '@mikro-orm/postgresql'
import { seedChampionCrmDemoData } from './lib/demo-flow'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['champion_crm.*'],
    admin: ['champion_crm.*'],
    employee: [
      'champion_crm.read',
      'champion_crm.leads.manage',
      'champion_crm.contacts.manage',
      'champion_crm.deals.manage',
      'champion_crm.investments.manage',
      'champion_crm.apartments.manage',
      'champion_crm.activities.manage',
      'champion_crm.consents.read',
      'champion_crm.audit.read',
      'champion_crm.ai.use',
    ],
  },

  async seedExamples({ em, tenantId, organizationId }) {
    await seedChampionCrmDemoData(em as EntityManager, { tenantId, organizationId, actorUserId: null })
  },
}

export default setup
