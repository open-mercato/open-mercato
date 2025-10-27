import type { ModuleInfo } from '@/modules/registry'

export const metadata: ModuleInfo = {
  name: 'onboarding',
  title: 'Onboarding',
  version: '0.1.0',
  description: 'Self-service tenant and organization onboarding flow.',
  author: 'Open Mercato Team',
  license: 'Proprietary',
}

export { features } from './acl'
