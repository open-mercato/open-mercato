import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'ecommerce',
  title: 'Ecommerce Stores',
  version: '0.1.0',
  description: 'Storefront definition, hostname and sales-channel binding, buyer-context resolution and per-store branding for the public storefront API.',
  author: 'Open Mercato Team',
  license: 'MIT',
  ejectable: true,
  requires: ['catalog', 'sales', 'customer_accounts', 'customer_groups'],
}

export { features } from './acl'
