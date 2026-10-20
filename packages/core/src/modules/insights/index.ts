import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'insights',
  title: 'Insights',
  version: '0.1.0',
  description: 'Explains why a record value is what it is, based on the causation recorded in audit logs.',
  author: 'Open Mercato Team',
  license: 'MIT',
  requires: ['audit_logs', 'auth'],
}

export { features } from './acl'
