import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { createCredentialsService } from '@open-mercato/core/modules/integrations/lib/credentials-service'
import { createIntegrationLogService } from '@open-mercato/core/modules/integrations/lib/log-service'
import { createIntegrationStateService } from '@open-mercato/core/modules/integrations/lib/state-service'
import { applyInpostEnvPreset } from './lib/preset'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['carrier_inpost.view', 'carrier_inpost.configure'],
    admin: ['carrier_inpost.view', 'carrier_inpost.configure'],
  },

  async onTenantCreated({ em, organizationId, tenantId }) {
    try {
      await applyInpostEnvPreset({
        credentialsService: createCredentialsService(em),
        integrationStateService: createIntegrationStateService(em),
        integrationLogService: createIntegrationLogService(em),
        scope: { tenantId, organizationId },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown InPost preset error'
      console.warn(`[carrier_inpost] Failed to apply env preset during tenant setup: ${message}`)
    }
  },
}

export default setup
