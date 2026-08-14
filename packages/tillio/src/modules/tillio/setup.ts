import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { applyTillioEnvPreset } from './lib/preset'
import type { TillioCredentialsService } from './lib/operators-store'

const logger = createLogger('tillio').child({ component: 'setup' })

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    admin: [
      'tillio.*',
    ],
  },

  async seedDefaults({ tenantId, organizationId, container }) {
    try {
      const result = await applyTillioEnvPreset({
        credentialsService: container.resolve('integrationCredentialsService') as TillioCredentialsService,
        integrationStateService: container.resolve('integrationStateService'),
        integrationHealthService: container.resolve('integrationHealthService'),
        integrationLogService: container.resolve('integrationLogService'),
        scope: { tenantId, organizationId },
      })
      if (result.status === 'skipped') {
        logger.debug('env preset not applied', { reason: result.reason })
      } else {
        logger.info('env preset applied', {
          credentialsAction: result.credentialsAction,
          health: result.health,
          operator: result.operator,
        })
      }
    } catch (err) {
      // A provider preset is never worth failing tenant bootstrap over; the operator can rerun
      // `mercato tillio configure-from-env` once the deployment is fixed.
      logger.warn('failed to apply the env preset during tenant setup', { err })
    }
  },
}

export default setup
