import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import type { CredentialsService } from '../integrations/lib/credentials-service'
import type { IntegrationStateService } from '../integrations/lib/state-service'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['sync_excel.view', 'sync_excel.run'],
    admin: ['sync_excel.view', 'sync_excel.run'],
  },
  async seedDefaults({ tenantId, organizationId, container }) {
    const credentialsService = container.resolve('integrationCredentialsService') as CredentialsService
    const integrationStateService = container.resolve('integrationStateService') as IntegrationStateService
    const scope = { tenantId, organizationId }

    await credentialsService.save('sync_excel', {}, scope)
    await integrationStateService.upsert('sync_excel', { isEnabled: true }, scope)
  },
}

export default setup
