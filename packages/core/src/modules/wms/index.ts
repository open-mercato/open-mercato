import type { ModuleInfo } from '@open-mercato/shared/modules/registry'
import './commands'

export const metadata: ModuleInfo = {
  name: 'wms',
  title: 'Warehouse Management',
  version: '0.1.0',
  description: 'Warehouse and inventory management: multi-warehouse, locations, balances, reservations, FIFO/LIFO/FEFO.',
  author: 'Open Mercato Team',
  license: 'MIT',
  ejectable: true,
}

export { features } from './acl'
