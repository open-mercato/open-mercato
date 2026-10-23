import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'purchases',
  title: 'Purchases & Procurement',
  version: '0.1.0',
  description:
    'Procurement management with RFQs, Purchase Orders, vendor pricelists, goods receipt (PZ), and 3-way matching.',
  author: 'Open Mercato Team',
  license: 'MIT',
  requires: ['catalog', 'customers', 'currencies'],
  ejectable: true,
}

export { features } from './acl'
