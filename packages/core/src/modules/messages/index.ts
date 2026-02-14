import type { ModuleInfo } from '@open-mercato/shared/modules/registry'
import './commands/confirmations'

export const metadata: ModuleInfo = {
  name: 'messages',
  title: 'Messages',
  version: '0.1.0',
  description: 'Internal messaging system with attachments, actions, and email forwarding.',
  author: 'Open Mercato Team',
  license: 'Proprietary',
}

export { features } from './acl'
