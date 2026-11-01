import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { registerAvailabilityReservationSweeperSchedules } from './lib/scheduling'

const logger = createLogger('availability')

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    admin: ['availability.*'],
    employee: ['availability.policies.view'],
  },

  // Step 2.3 — §10's two sweeper schedules (expire-reservations, reconcile-reservations).
  // Best-effort: a scheduler failure must not abort tenant initialization for every other
  // module (mirrors cart/promotions/push_notifications). The same registration also runs for
  // existing tenants via the `availability.register-reservation-sweep-schedules` upgrade
  // action (`configs/lib/upgrade-actions.ts`).
  async seedDefaults({ container, tenantId }) {
    try {
      await registerAvailabilityReservationSweeperSchedules(container, { tenantId })
    } catch (error) {
      logger.warn('Failed to register availability reservation sweeper schedules', { err: error })
    }
  },
}

export default setup
