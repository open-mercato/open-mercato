import { asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { gusRegonHealthCheck } from './lib/health'

export function register(container: AppContainer) {
  container.register({
    gusRegonHealthCheck: asValue(gusRegonHealthCheck),
  })
}
