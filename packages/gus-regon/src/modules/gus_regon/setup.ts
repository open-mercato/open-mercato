import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { createCredentialsService } from '@open-mercato/core/modules/integrations/lib/credentials-service'
import { createIntegrationLogService } from '@open-mercato/core/modules/integrations/lib/log-service'
import { createIntegrationStateService } from '@open-mercato/core/modules/integrations/lib/state-service'
import { applyGusRegonEnvPreset } from './lib/preset'

const logger = createLogger('gus_regon')

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['gus_regon.lookup'],
    admin: ['gus_regon.lookup'],
    employee: ['gus_regon.lookup'],
  },

  async onTenantCreated({ em, organizationId, tenantId }) {
    try {
      await applyGusRegonEnvPreset({
        credentialsService: createCredentialsService(em),
        integrationStateService: createIntegrationStateService(em),
        integrationLogService: createIntegrationLogService(em),
        scope: { tenantId, organizationId },
      })
    } catch (error) {
      getTelemetryRuntime()?.reportError(error, { module: 'gus_regon', code: 'gus_regon.preset_failed' })
      logger.warn('Env preset was not applied during tenant setup', { err: error })
    }
  },
}

export default setup
