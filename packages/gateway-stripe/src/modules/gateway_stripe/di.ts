import { asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { stripeHealthCheck } from './lib/health'

export function register(container: AppContainer) {
  container.register({
    stripeHealthCheck: asValue(stripeHealthCheck),
  })
}
