import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'freight_operations',
  title: 'Freight Operations',
  version: '0.1.0',
  description: 'Freight commercial operations: spot truck orders, contracts, trips, trip abstracts, and customer-approved billing.',
  author: 'Open Mercato Team',
  license: 'MIT',
  ejectable: true,
  requires: ['customers', 'sales', 'configs'],
}

export { features } from './acl'
