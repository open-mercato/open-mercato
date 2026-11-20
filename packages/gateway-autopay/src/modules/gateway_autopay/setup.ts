import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { createCredentialsService } from '@open-mercato/core/modules/integrations/lib/credentials-service'
import { createIntegrationLogService } from '@open-mercato/core/modules/integrations/lib/log-service'
import { createIntegrationStateService } from '@open-mercato/core/modules/integrations/lib/state-service'
import { reportAutopayError } from './lib/error-reporting'
import { applyAutopayEnvPreset } from './lib/preset'
import { registerAutopayStatusPollerSchedule } from './lib/status-poller-schedule'

const logger = createLogger('gateway_autopay')

async function ensureStatusPollerSchedule(ctx: {
  container: import('awilix').AwilixContainer
  tenantId: string
  organizationId: string
}): Promise<void> {
  const scope = { tenantId: ctx.tenantId, organizationId: ctx.organizationId }
  try {
    const registered = await registerAutopayStatusPollerSchedule(ctx.container, scope)
    if (!registered) {
      logger.warn('Scheduler module is unavailable; Autopay status reconciliation is not scheduled', scope)
    }
  } catch (error) {
    logger.warn('Failed to register the Autopay status reconciliation schedule', { ...scope, err: error })
    reportAutopayError(error, 'gateway_autopay.schedule_registration_failed')
  }
}

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['gateway_autopay.view', 'gateway_autopay.configure'],
    admin: ['gateway_autopay.view', 'gateway_autopay.configure'],
  },

  async onTenantCreated({ em, organizationId, tenantId }) {
    try {
      await applyAutopayEnvPreset({
        credentialsService: createCredentialsService(em),
        integrationStateService: createIntegrationStateService(em),
        integrationLogService: createIntegrationLogService(em),
        scope: { tenantId, organizationId },
      })
    } catch (error) {
      logger.warn('Failed to apply env preset during tenant setup', { err: error })
      reportAutopayError(error, 'gateway_autopay.setup_preset_failed')
    }
  },

  async seedDefaults(ctx) {
    await ensureStatusPollerSchedule(ctx)
  },

  async onOrganizationCreated(ctx) {
    await ensureStatusPollerSchedule(ctx)
  },
}

export default setup
