import { asValue, type AwilixContainer } from 'awilix'
import { ensureTransactionExpirySchedule } from './setup'

export function register(container: AwilixContainer): void {
  // #8822: lets `configs`'s `checkout.register-schedules` upgrade action reach this
  // module's schedule registration without `@open-mercato/core` statically importing
  // `@open-mercato/checkout` (checkout depends on core, never the reverse).
  container.register({
    checkoutScheduleUpgradeRegistrar: asValue(ensureTransactionExpirySchedule),
  })
}

export default { register }
