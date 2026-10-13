import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { registerDataSyncAdapter } from '@open-mercato/core/modules/data_sync/lib/adapter-registry'
import { xeroContactsAdapter } from './lib/contacts/adapter'

export function register(_container: AppContainer) {
  registerDataSyncAdapter(xeroContactsAdapter)
}
