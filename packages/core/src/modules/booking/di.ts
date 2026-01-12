import { asFunction } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { DefaultBookingAvailabilityService } from './services/bookingAvailabilityService'

export function register(container: AppContainer) {
  container.register({
    bookingAvailabilityService: asFunction(() => {
      return new DefaultBookingAvailabilityService()
    }).singleton(),
  })
}
