import type { ModuleInfo } from '@/modules/registry'

export const metadata: ModuleInfo = {
  name: 'instructors',
  title: 'KARIANA Instructor Platform',
  version: '0.1.0',
  description: 'Instructor profiles with Unreal Engine credential verification for the KARIANA ecosystem.',
  author: 'KARIANA Team',
  license: 'Proprietary',
}

export { features } from './acl'
