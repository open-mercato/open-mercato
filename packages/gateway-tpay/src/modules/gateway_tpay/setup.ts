import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { createCredentialsService } from '@open-mercato/core/modules/integrations/lib/credentials-service'
import { createIntegrationLogService } from '@open-mercato/core/modules/integrations/lib/log-service'
import { createIntegrationStateService } from '@open-mercato/core/modules/integrations/lib/state-service'
import { applyTpayEnvPreset } from './lib/preset'
import { syncTpayReconciliationSchedule } from './lib/reconciliation-schedule'

const logger = createLogger('gateway_tpay')

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['gateway_tpay.view', 'gateway_tpay.configure'],
    admin: ['gateway_tpay.view', 'gateway_tpay.configure'],
  },

  async onTenantCreated({ em, organizationId, tenantId }) {
    try {
      await applyTpayEnvPreset({
        credentialsService: createCredentialsService(em),
        integrationStateService: createIntegrationStateService(em),
        integrationLogService: createIntegrationLogService(em),
        scope: { tenantId, organizationId },
      })
    } catch (error) {
      getTelemetryRuntime()?.reportError(error, { module: 'gateway_tpay', code: 'gateway_tpay.preset_failed' })
      logger.warn('Failed to apply env preset during tenant setup', { err: error })
    }
  },

  async seedDefaults({ em, container, organizationId, tenantId }) {
    try {
      const scope = { tenantId, organizationId }
      const enabled = await createIntegrationStateService(em).isEnabled('gateway_tpay', scope)
      if (!enabled) return
      await syncTpayReconciliationSchedule({ container, scope, enabled: true, onlyIfMissing: true })
    } catch (error) {
      getTelemetryRuntime()?.reportError(error, {
        module: 'gateway_tpay',
        code: 'gateway_tpay.reconciliation_schedule_failed',
      })
      logger.warn('Failed to register Tpay reconciliation schedule during tenant setup', { err: error })
    }
  },
}

export default setup
