import { asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { registerDataSyncAdapter } from '@open-mercato/core/modules/data_sync/lib/adapter-registry'
import { akeneoHealthCheck } from './lib/health'
import { akeneoDataSyncAdapter } from './lib/adapter'

export function register(container: AppContainer) {
  registerDataSyncAdapter(akeneoDataSyncAdapter)

  container.register({
    akeneoHealthCheck: asValue(akeneoHealthCheck),
  })
}
