import type { ModuleInfo } from '@/modules/registry'

export const metadata: ModuleInfo = {
  name: 'dashboards',
  title: 'Admin Dashboards',
  version: '0.1.0',
  description: 'Configurable admin dashboard with module-provided widgets.',
  author: 'Open Mercato Team',
  license: 'Proprietary',
}

export { features } from './acl'
