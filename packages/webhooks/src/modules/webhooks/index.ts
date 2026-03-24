import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'webhooks',
  title: 'Webhooks',
  version: '0.1.0',
  description: 'Standard Webhooks compliant outbound webhook delivery for platform events.',
  author: 'Open Mercato Team',
  license: 'Proprietary',
}

export { features } from './acl'
