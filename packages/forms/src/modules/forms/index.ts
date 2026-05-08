import type { ModuleInfo } from '@open-mercato/shared/modules/registry'
import './commands'

export const metadata: ModuleInfo = {
  name: 'forms',
  title: 'Forms',
  version: '0.1.0',
  description: 'Audit-grade questionnaire and form primitive — versioned definitions, append-only submissions, role-sliced rendering.',
  author: 'Open Mercato Team',
  license: 'Proprietary',
}

export { features } from './acl'
