import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import type { CredentialsService } from '@open-mercato/core/modules/integrations/lib/credentials-service'
import type { IntegrationLogService } from '@open-mercato/core/modules/integrations/lib/log-service'
import type { IntegrationStateService } from '@open-mercato/core/modules/integrations/lib/state-service'
import { applyAkeneoEnvPreset } from './lib/preset'

export const setup: ModuleSetupConfig = {
  async seedDefaults({ em, tenantId, organizationId, container }) {
    const credentialsService = container.resolve('integrationCredentialsService') as CredentialsService
    const integrationStateService = container.resolve('integrationStateService') as IntegrationStateService
    const integrationLogService = container.resolve('integrationLogService') as IntegrationLogService

    try {
      await applyAkeneoEnvPreset({
        em,
        credentialsService,
        integrationStateService,
        integrationLogService,
        scope: { tenantId, organizationId },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown Akeneo preset error'
      console.warn(`[sync_akeneo] Failed to apply env preset during tenant setup: ${message}`)
      await integrationLogService.scoped('sync_akeneo', { tenantId, organizationId }).warn(
        'Akeneo env preset could not be applied during tenant setup.',
        { errorMessage: message },
      )
    }
  },
}

export default setup
