import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'portal',
  title: 'Customer Portal',
  version: '0.1.0',
  description: 'Self-service customer portal framework with login, signup, dashboard, sidebar navigation, and extensible widget system.',
  requires: ['customer_accounts'],
}
