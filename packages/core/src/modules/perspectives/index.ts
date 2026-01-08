import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'perspectives',
  title: 'Table perspectives',
  version: '0.1.0',
  description: 'Shared persistence for DataTable perspectives (columns, filters, saved views).',
  author: 'Open Mercato Team',
  license: 'Proprietary',
}

export { features } from './acl'
