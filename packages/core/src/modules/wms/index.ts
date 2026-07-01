import type { ModuleInfo } from '@open-mercato/shared/modules/registry'
import './commands'

export const metadata: ModuleInfo = {
  name: 'wms',
  title: 'Warehouse Management System',
  version: '0.1.0',
  description: 'Warehouse topology, inventory balances, reservations, and movement ledger.',
  author: 'Open Mercato Team',
  license: 'Proprietary',
  ejectable: true,
  requires: ['catalog', 'sales', 'feature_toggles'],
}

export { features } from './acl'
