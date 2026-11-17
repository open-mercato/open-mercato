import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'customer_groups',
  title: 'Customer Groups & B2B Terms',
  version: '0.1.0',
  description: 'Customer groups, memberships, and per-group commercial terms consumed by catalog pricing and sales tax resolution.',
  author: 'Open Mercato Team',
  license: 'MIT',
  ejectable: true,
}

export { features } from './acl'
