import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { createCredentialsService } from '@open-mercato/core/modules/integrations/lib/credentials-service'
import { createIntegrationLogService } from '@open-mercato/core/modules/integrations/lib/log-service'
import { createIntegrationStateService } from '@open-mercato/core/modules/integrations/lib/state-service'
import { applyStripeEnvPreset } from './lib/preset'
import {
  STRIPE_INTEGRATION_TEST_PUBLISHABLE_KEY,
  STRIPE_INTEGRATION_TEST_SECRET_KEY,
  STRIPE_INTEGRATION_TEST_WEBHOOK_SECRET,
} from './lib/testing-recurring-runtime'

function resolveStripePresetEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  if (env.OM_INTEGRATION_TEST === 'true' && env.OM_SUBSCRIPTIONS_USE_REAL_STRIPE !== '1') {
    return {
      ...env,
      OM_INTEGRATION_STRIPE_PUBLISHABLE_KEY: STRIPE_INTEGRATION_TEST_PUBLISHABLE_KEY,
      OM_INTEGRATION_STRIPE_SECRET_KEY: STRIPE_INTEGRATION_TEST_SECRET_KEY,
      OM_INTEGRATION_STRIPE_WEBHOOK_SECRET: STRIPE_INTEGRATION_TEST_WEBHOOK_SECRET,
      OM_INTEGRATION_STRIPE_FORCE_PRECONFIGURE: 'true',
      OM_INTEGRATION_STRIPE_ENABLED: 'true',
    }
  }
  return env
}

const logger = createLogger('gateway_stripe')

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['gateway_stripe.view', 'gateway_stripe.configure'],
    admin: ['gateway_stripe.view', 'gateway_stripe.configure'],
  },

  async onTenantCreated({ em, organizationId, tenantId }) {
    try {
      await applyStripeEnvPreset({
        credentialsService: createCredentialsService(em),
        integrationStateService: createIntegrationStateService(em),
        integrationLogService: createIntegrationLogService(em),
        scope: { tenantId, organizationId },
        env: resolveStripePresetEnv(),
      })
    } catch (error) {
      logger.warn('Failed to apply env preset during tenant setup', { err: error })
    }
  },
}

export default setup
