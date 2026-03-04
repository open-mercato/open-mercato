import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'payment_gateways',
  title: 'Payment Gateways',
  version: '0.1.0',
  description: 'Provider-agnostic payment gateway hub with adapter registry and checkout orchestration.',
  author: 'Open Mercato Team',
}

export { features } from './acl'
