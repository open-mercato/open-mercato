import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { registerIntegration } from '@open-mercato/shared/modules/integrations/types'
import { integration } from './integration'

export const setup: ModuleSetupConfig = {
  async onTenantCreated() {
    registerIntegration(integration)
  },
}

export default setup
