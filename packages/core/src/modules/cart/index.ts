import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'cart',
  title: 'Cart',
  version: '0.1.0',
  description: 'Channel-agnostic basket module: priced lines, promotions, totals, and token-bound public access.',
  author: 'Open Mercato Team',
  license: 'MIT',
  ejectable: true,
  requires: ['catalog', 'sales', 'customer_groups', 'promotions'],
}

export { features } from './acl'
