import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'records',
  title: 'Records',
  version: '0.1.0',
  description: 'EZD records: incoming shipments and JRWA',
  author: 'Open Mercato Team',
  license: 'Proprietary',
}

export { features } from './acl'
