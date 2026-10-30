import type { ModuleInfo } from '@open-mercato/shared/modules/registry'
import './commands'

export const metadata: ModuleInfo = {
  name: 'forms',
  title: 'Forms',
  version: '0.1.0',
  description: 'Audit-grade questionnaire and form primitive — versioned definitions, append-only submissions, role-sliced rendering.',
  author: 'Open Mercato Team',
  license: 'MIT',
  // Hard, unconditional imports: `attachments` for theme-logo storage and the
  // Attachment entity, `customer_accounts` for the portal auth the submission
  // routes and the runtime principal resolve through. Neither is behind a
  // `tryResolve`, so both are genuine dependencies rather than optional peers.
  requires: ['attachments', 'customer_accounts'],
}

export { features } from './acl'
