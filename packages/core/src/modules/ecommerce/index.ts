import type { ModuleInfo } from '@open-mercato/shared/modules/registry'
import './commands'

export const metadata: ModuleInfo = {
  name: 'ecommerce',
  title: 'Ecommerce',
  version: '0.1.0',
  description: 'Storefront store management, domain mapping, channel bindings, and public catalog APIs.',
  author: 'Open Mercato Team',
  license: 'Proprietary',
  ejectable: true,
}

export { features } from './acl'
