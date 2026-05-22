import type { ModuleInfo } from '@open-mercato/shared/modules/registry'
import './commands'

export const metadata: ModuleInfo = {
  name: 'subscriptions',
  title: 'Subscriptions',
  version: '0.1.0',
  description: 'Recurring billing domain layer that sits above payment gateways. Owns plans, subscriptions, billing records, and the external-app access API.',
  author: 'Open Mercato Team',
  license: 'MIT',
  ejectable: true,
}

export { features } from './acl'
