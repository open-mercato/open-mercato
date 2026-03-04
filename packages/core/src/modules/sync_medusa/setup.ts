import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { registerDataSyncAdapter } from '../data_sync/lib/adapter-registry'
import { medusaOrdersAdapter, medusaProductsAdapter } from './lib/adapters'

export const setup: ModuleSetupConfig = {
  async onTenantCreated() {
    registerDataSyncAdapter(medusaProductsAdapter)
    registerDataSyncAdapter(medusaOrdersAdapter)
  },
}

export default setup
