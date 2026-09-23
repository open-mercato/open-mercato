import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'availability',
  title: 'Availability',
  version: '0.1.0',
  description: 'Sell-policy layer (stock-managed, backorder, preorder, thresholds) on top of the shared availability contract.',
  author: 'Open Mercato Team',
  license: 'MIT',
  ejectable: true,
}

export { features } from './acl'
