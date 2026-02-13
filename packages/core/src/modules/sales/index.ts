import type { ModuleInfo } from '@open-mercato/shared/modules/registry'
import './commands'
import './lib/providers'

export const metadata: ModuleInfo = {
  name: 'sales',
  title: 'Sales Management',
  version: '0.1.0',
  description:
    'Quoting, ordering, fulfillment, and billing capabilities built on modular pricing and tax pipelines.',
  author: 'Open Mercato Team',
  license: 'Proprietary',
  requires: ['catalog', 'customers', 'dictionaries'],
  ejectable: true,
}

export { features } from './acl'
