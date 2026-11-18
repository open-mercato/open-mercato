import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { registerCodeReservationSweepSchedule } from './lib/scheduling'

const logger = createLogger('promotions')

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['promotions.*'],
    admin: ['promotions.*'],
  },

  // Step 6.5 — the code-reservation sweep's own schedule (SPEC-055 rev A.6/X7). Best-effort:
  // a scheduler failure must not abort tenant initialization for every other module (mirrors
  // `cart`/`push_notifications`/`communication_channels`/`payment_gateways`). The same
  // registration also runs for existing tenants via the
  // `promotions.register-code-reservation-sweep-schedule` upgrade action
  // (`configs/lib/upgrade-actions.ts`).
  async seedDefaults({ container, tenantId }) {
    try {
      await registerCodeReservationSweepSchedule(container, { tenantId })
    } catch (error) {
      logger.warn('Failed to register promotions code-reservation sweep schedule', { err: error })
    }
  },
}

export default setup
