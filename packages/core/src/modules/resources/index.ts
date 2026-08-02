import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'resources',
  title: 'Resource planning',
  version: '0.1.0',
  description: 'Assets and resources with scheduling policies.',
  author: 'Open Mercato Team',
  license: 'MIT',
  requires: ['planner'],
  ejectable: true,
}

export { features } from './acl'
