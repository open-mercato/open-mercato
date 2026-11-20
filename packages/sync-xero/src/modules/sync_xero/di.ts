import { asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { registerDataSyncAdapter } from '@open-mercato/core/modules/data_sync/lib/adapter-registry'
import { xeroContactsAdapter } from './lib/contacts/adapter'
import { xeroHealthCheck } from './lib/health'

export function register(container: AppContainer) {
  registerDataSyncAdapter(xeroContactsAdapter)

  container.register({
    xeroHealthCheck: asValue(xeroHealthCheck),
  })
}
