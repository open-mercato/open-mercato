import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'fleet_management',
  title: 'Fleet & Vehicle Management',
  version: '0.1.0',
  description: 'Fleet vehicles, licensing documents, custody assignments with approvals, and odometer history.',
  author: 'Open Mercato Team',
  license: 'MIT',
  ejectable: true,
}

export { features } from './acl'
