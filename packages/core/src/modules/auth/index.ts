import type { ModuleInfo } from '@/modules/registry'

export const metadata: ModuleInfo = {
  name: 'auth',
  title: 'Authentication & Accounts',
  version: '0.1.0',
  description: 'User accounts, sessions, roles and password resets.',
  author: 'Open Mercato Team',
  license: 'Proprietary',
}

// Re-export features from module root acl.ts so generator can pick them up regardless of consumer imports
export { features } from './acl'
