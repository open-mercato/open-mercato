import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { createCredentialsService } from '@open-mercato/core/modules/integrations/lib/credentials-service'
import { createIntegrationLogService } from '@open-mercato/core/modules/integrations/lib/log-service'
import { createIntegrationStateService } from '@open-mercato/core/modules/integrations/lib/state-service'
import { applyInpostEnvPreset } from './lib/preset'

const logger = createLogger('carrier_inpost')

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
      logger.warn('Failed to apply env preset during tenant setup', { err: error })
    }
  },
}

export default setup
