import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'push_notifications',
  title: 'Push Notifications',
  version: '0.1.0',
  description:
    'Push delivery rails: a `push` notification delivery strategy that fans out to registered devices and sends through the communication_channels hub.',
  author: 'Open Mercato Team',
  license: 'MIT',
  requires: ['auth', 'devices', 'notifications', 'communication_channels', 'integrations'],
  ejectable: true,
}

export { features } from './acl'
