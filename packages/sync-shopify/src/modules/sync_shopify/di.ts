import { asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { registerDataSyncAdapter } from '@open-mercato/core/modules/data_sync/lib/adapter-registry'
import { shopifyDataSyncAdapter } from './lib/adapter'
import { shopifyHealthCheck } from './lib/health'

export function register(container: AppContainer) {
  registerDataSyncAdapter(shopifyDataSyncAdapter)
  container.register({
    shopifyHealthCheck: asValue(shopifyHealthCheck),
  })
}
