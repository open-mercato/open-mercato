import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { createCredentialsService } from '@open-mercato/core/modules/integrations/lib/credentials-service'
import { createIntegrationLogService } from '@open-mercato/core/modules/integrations/lib/log-service'
import { applyS3EnvPreset } from './lib/preset'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('storage_s3')

const S3_INTEGRATION_ID = 'storage_s3'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['storage_providers.manage'],
    admin: ['storage_providers.manage'],
  },

  async onTenantCreated({ em, organizationId, tenantId }) {
    const integrationLogService = createIntegrationLogService(em)
    try {
      await applyS3EnvPreset({
        credentialsService: createCredentialsService(em),
        integrationLogService,
        scope: { tenantId, organizationId },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown S3 preset error'
      try {
        await integrationLogService
          .scoped(S3_INTEGRATION_ID, { tenantId, organizationId })
          .error(`Failed to apply S3 env preset during tenant setup: ${message}`)
      } catch (logError) {
        const logMessage = logError instanceof Error ? logError.message : 'Unknown integration log error'
        logger.error('Failed to apply env preset during tenant setup; persisting to integration logs also failed', {
          presetError: message,
          logError: logMessage,
        })
      }
    }
  },
}

export default setup
