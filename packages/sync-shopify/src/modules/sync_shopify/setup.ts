import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { CredentialsService } from '@open-mercato/core/modules/integrations/lib/credentials-service'
import type { IntegrationLogService } from '@open-mercato/core/modules/integrations/lib/log-service'
import type { IntegrationStateService } from '@open-mercato/core/modules/integrations/lib/state-service'
import { applyShopifyEnvPreset } from './lib/preset'

const logger = createLogger('sync_shopify')

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['sync_shopify.view', 'sync_shopify.configure'],
    admin: ['sync_shopify.view', 'sync_shopify.configure'],
  },

  async seedDefaults({ tenantId, organizationId, container }) {
    const credentialsService = container.resolve('integrationCredentialsService') as CredentialsService
    const integrationStateService = container.resolve('integrationStateService') as IntegrationStateService
    const integrationLogService = container.resolve('integrationLogService') as IntegrationLogService
    try {
      await applyShopifyEnvPreset({
        credentialsService,
        integrationStateService,
        integrationLogService,
        scope: { tenantId, organizationId },
      })
    } catch (error) {
      logger.warn('Failed to apply Shopify env preset during tenant setup', { err: error })
    }
  },
}

export default setup
