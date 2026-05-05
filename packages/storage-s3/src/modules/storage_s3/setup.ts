import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { createCredentialsService } from '@open-mercato/core/modules/integrations/lib/credentials-service'
import { createIntegrationLogService } from '@open-mercato/core/modules/integrations/lib/log-service'
import { applyS3EnvPreset } from './lib/preset'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['storage_providers.manage'],
    admin: ['storage_providers.manage'],
  },

  async onTenantCreated({ em, organizationId, tenantId }) {
    try {
      await applyS3EnvPreset({
        credentialsService: createCredentialsService(em),
        integrationLogService: createIntegrationLogService(em),
        scope: { tenantId, organizationId },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown S3 preset error'
      console.warn(`[storage_s3] Failed to apply env preset during tenant setup: ${message}`)
    }
  },
}

export default setup
