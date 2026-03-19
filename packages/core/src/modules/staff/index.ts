import type { ModuleInfo } from '@open-mercato/shared/modules/registry'
import './commands'

export const metadata: ModuleInfo = {
  name: 'staff',
  title: 'Employees',
  version: '0.1.0',
  description: 'Teams, roles, and employee rosters.',
  author: 'Open Mercato Team',
  license: 'Proprietary',
  requires: ['planner', 'resources'],
  ejectable: true,
}

export { features } from './acl'
