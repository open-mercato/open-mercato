import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'materials',
  title: 'Materials Master Data',
  version: '0.1.0',
  description: 'ERP master data for materials, supplier links, units, and pricing.',
  author: 'Open Mercato Team',
  license: 'Proprietary',
  ejectable: true,
}

export { features } from './acl'
