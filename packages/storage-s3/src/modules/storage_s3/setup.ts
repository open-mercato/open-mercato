import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { createCredentialsService } from '@open-mercato/core/modules/integrations/lib/credentials-service'
import { createIntegrationLogService } from '@open-mercato/core/modules/integrations/lib/log-service'
import { applyS3EnvPreset } from './lib/preset'

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
        console.error(
          `[storage_s3] Failed to apply env preset during tenant setup: ${message}. ` +
            `Also failed to persist the error to integration logs: ${logMessage}`,
        )
      }
    }
  },
}

export default setup
