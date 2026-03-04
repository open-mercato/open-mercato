import type { ModuleInfo } from '@open-mercato/shared/modules/registry'
import './lib/register'

export const metadata: ModuleInfo = {
  name: 'gateway_stripe',
  title: 'Stripe Gateway',
  version: '0.1.0',
  description: 'Stripe payment gateway integration module with hosted checkout sessions.',
  author: 'Open Mercato Team',
}

export { features } from './acl'
