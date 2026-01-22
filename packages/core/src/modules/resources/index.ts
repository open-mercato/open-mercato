import type { ModuleInfo } from '@open-mercato/shared/modules/registry'
import './commands'

export const metadata: ModuleInfo = {
  name: 'resources',
  title: 'Resource planning',
  version: '0.1.0',
  description: 'Assets and resources with scheduling policies.',
  author: 'Open Mercato Team',
  license: 'Proprietary',
  requires: ['planner'],
}

export { features } from './acl'
