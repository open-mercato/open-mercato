import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'shipping_carriers',
  title: 'Shipping Carriers',
  version: '0.1.0',
  description: 'Carrier-agnostic shipping hub with adapter registry and shipment synchronization.',
  author: 'Open Mercato Team',
}

export { features } from './acl'
