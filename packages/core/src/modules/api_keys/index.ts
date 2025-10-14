import type { ModuleInfo } from '@/modules/registry'

export const metadata: ModuleInfo = {
  name: 'api_keys',
  title: 'API Keys',
  version: '0.1.0',
  description: 'Manage access tokens for external API access.',
  author: 'Open Mercato Team',
  license: 'Proprietary',
  requires: ['auth'],
}

export { features } from './acl'
