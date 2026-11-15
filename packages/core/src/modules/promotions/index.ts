import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'promotions',
  title: 'Promotions',
  version: '0.1.0',
  description: 'Rule-based promotions engine: condition-benefit trees, promotional codes, and cart effect resolution.',
  author: 'Open Mercato Team',
  license: 'MIT',
  ejectable: true,
}

export { features } from './acl'
