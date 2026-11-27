import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'assisted_selling',
  title: 'Assisted Selling',
  version: '0.1.0',
  description: 'Staff- and AI-authored priced proposals on a buyer\'s basket, accepted as a cart merge.',
  author: 'Open Mercato Team',
  license: 'MIT',
  ejectable: true,
  requires: ['cart'],
}

export { features } from './acl'
