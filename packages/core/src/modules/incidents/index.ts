import type { ModuleInfo } from '@open-mercato/shared/modules/registry'
import './commands'

export const metadata: ModuleInfo = {
  name: 'incidents',
  title: 'Incident Management',
  version: '0.1.0',
  description: 'Operational incident management with customer/order impact and escalation',
  author: 'Open Mercato Team',
  license: 'MIT',
  ejectable: true,
}

export { features } from './acl'
