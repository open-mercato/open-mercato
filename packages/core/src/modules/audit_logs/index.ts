import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'audit_logs',
  title: 'Audit & Action Logs',
  version: '0.1.0',
  description: 'Tracks user actions and data accesses with undo support scaffolding.',
  author: 'Open Mercato Team',
  license: 'Proprietary',
}

export { features } from './acl'
