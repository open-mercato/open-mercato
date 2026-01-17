import type { ModuleInfo } from '@open-mercato/shared/modules/registry'
import './commands'

export const metadata: ModuleInfo = {
  name: 'booking',
  title: 'Booking',
  version: '0.1.0',
  description: 'Tenant-aware booking services, resources, availability, and events.',
  author: 'Open Mercato Team',
  license: 'Proprietary',
}

export { features } from './acl'
