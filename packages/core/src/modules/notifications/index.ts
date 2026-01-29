import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'notifications',
  title: 'Notifications',
  version: '0.1.0',
  description: 'In-app notifications with module-extensible types and actions.',
  author: 'Open Mercato Team',
  license: 'Proprietary',
}

export { features } from './acl'
