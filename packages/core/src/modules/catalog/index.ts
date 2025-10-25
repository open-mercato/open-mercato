import type { ModuleInfo } from '@/modules/registry'
import './commands'

export const metadata: ModuleInfo = {
  name: 'catalog',
  title: 'Product Catalog',
  version: '0.1.0',
  description: 'Configurable catalog for products, variants, and pricing used by the sales module.',
  author: 'Open Mercato Team',
  license: 'Proprietary',
}

export { features } from './acl'
