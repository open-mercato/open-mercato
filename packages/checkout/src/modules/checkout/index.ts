import type { ModuleInfo } from '@open-mercato/shared/modules/registry'
import './commands'

export const metadata: ModuleInfo = {
  name: 'checkout',
  title: 'Checkout',
  version: '0.1.0',
  description: 'Pay links, checkout templates, public payment pages, and checkout transaction tracking.',
  author: 'Open Mercato Team',
  license: 'Proprietary',
  ejectable: true,
}

export { features } from './acl'
