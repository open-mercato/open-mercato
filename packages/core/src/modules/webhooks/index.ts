import type { ModuleInfo } from '@/modules/registry'

export const metadata: ModuleInfo = {
  name: 'webhooks',
  title: 'Webhooks',
  version: '0.1.0',
  description: 'Configure webhook endpoints for event delivery.',
  author: 'Open Mercato Team',
  license: 'Proprietary',
  requires: ['auth'],
}

export { features } from './acl'
