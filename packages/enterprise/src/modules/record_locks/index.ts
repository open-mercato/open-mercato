import './commands/conflicts'

import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'record_locks',
  title: 'Record Locking',
  version: '0.1.0',
  description: 'Optimistic and pessimistic record locking with conflict resolution.',
  author: 'Open Mercato Team',
  license: 'Proprietary',
}

export { features } from './acl'
