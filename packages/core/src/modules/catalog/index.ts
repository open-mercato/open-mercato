import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'catalog',
  title: 'Product Catalog',
  version: '0.1.0',
  description: 'Configurable catalog for products, variants, and pricing used by the sales module.',
  author: 'Open Mercato Team',
  license: 'MIT',
  ejectable: true,
}

export { features } from './acl'
