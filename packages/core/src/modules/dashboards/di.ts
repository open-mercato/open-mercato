import { asFunction } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { createAnalyticsRegistry } from './services/analyticsRegistry'

export function register(container: AppContainer): void {
  container.register({
    analyticsRegistry: asFunction(() => createAnalyticsRegistry()).singleton(),
  })
}
