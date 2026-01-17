import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'entities',
  title: 'Custom Entities & Fields',
  version: '0.1.0',
  description: 'User-defined entities, custom fields, and dynamic records storage.',
  author: 'Open Mercato Team',
  license: 'Proprietary',
  // Ensure query/index layer is present for hybrid querying of custom entities
  requires: ['query_index'],
}

