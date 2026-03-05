import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { registerIntegration } from '@open-mercato/shared/modules/integrations/types'
import { registerShippingProvider } from '@open-mercato/core/modules/sales/lib/providers'
import { registerShippingAdapter } from '@open-mercato/core/modules/shipping_carriers/lib/adapter-registry'
import { integration } from './integration'
import { inpostAdapter } from './lib/adapter'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['shipping_carriers.view', 'shipping_carriers.manage'],
    admin: ['shipping_carriers.view', 'shipping_carriers.manage'],
  },
  async onTenantCreated() {
    registerIntegration(integration)
    registerShippingProvider({
      key: 'inpost',
      label: 'InPost',
      description: 'InPost carrier services.',
      settings: { fields: [] },
      calculate: () => ({ adjustments: [] }),
    })
    registerShippingAdapter(inpostAdapter)
  },
}

export default setup
