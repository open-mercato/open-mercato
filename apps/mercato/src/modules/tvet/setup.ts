import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['tvet.*'],
    admin: ['tvet.*'],
    registrar: ['tvet.academics.*', 'tvet.admissions.*'],
    trainer: ['tvet.academics.view'],
    finance: ['tvet.finance.*'],
    hr: ['tvet.hr.*'],
  },

  async onTenantCreated({ em, tenantId, organizationId }) {
    // Initial setup if needed
  },
}

export default setup
