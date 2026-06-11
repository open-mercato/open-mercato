import type { ModuleInfo } from '@open-mercato/shared/modules/registry'
import './commands/devices'

export const metadata: ModuleInfo = {
  name: 'devices',
  title: 'Devices',
  version: '0.1.0',
  description: 'Per-tenant user device registry (platform, app/OS metadata, push token storage).',
  author: 'Open Mercato Team',
  license: 'Proprietary',
  requires: ['auth'],
  ejectable: true,
}

export { features } from './acl'
