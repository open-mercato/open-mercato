import type { ModuleInfo } from '@open-mercato/shared/modules/registry'
import { registerIntegration } from '@open-mercato/shared/modules/integrations/types'
import { registerPaymentProvider } from '@open-mercato/core/modules/sales/lib/providers/registry'
import integration from './integration'

registerIntegration(integration)
registerPaymentProvider({
  key: 'payu',
  label: 'PayU',
  description: 'PayU payment gateway provider metadata and settings.',
})

export const metadata: ModuleInfo = {
  name: 'gateway_payu',
  title: 'PayU Gateway',
  version: '0.1.0',
  description: 'PayU payment gateway integration placeholder module.',
  author: 'Open Mercato Team',
}
