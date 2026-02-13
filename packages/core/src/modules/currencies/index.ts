import './commands/currencies'
import './commands/exchange-rates'
import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'currencies',
  title: 'Currencies',
  version: '0.1.0',
  description: 'Currencies and Exchange rate management',
  author: 'Open Mercato Team',
  license: 'Proprietary',
  ejectable: true,
}
