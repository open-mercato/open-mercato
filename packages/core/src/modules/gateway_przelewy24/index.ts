import type { ModuleInfo } from '@open-mercato/shared/modules/registry'
import { registerIntegration } from '@open-mercato/shared/modules/integrations/types'
import { registerPaymentProvider } from '../sales/lib/providers/registry'
import integration from './integration'

registerIntegration(integration)
registerPaymentProvider({
  key: 'przelewy24',
  label: 'Przelewy24',
  description: 'Przelewy24 payment gateway provider metadata and settings.',
})

export const metadata: ModuleInfo = {
  name: 'gateway_przelewy24',
  title: 'Przelewy24 Gateway',
  version: '0.1.0',
  description: 'Przelewy24 payment gateway integration placeholder module.',
  author: 'Open Mercato Team',
}
