import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'customer_accounts',
  title: 'Customer Identity & Portal Authentication',
  version: '0.1.0',
  description: 'Customer-facing authentication with two-tier identity model and full RBAC.',
  author: 'Open Mercato Team',
  license: 'Proprietary',
  ejectable: true,
}

export { features } from './acl'
