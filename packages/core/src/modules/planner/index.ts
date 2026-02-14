import type { ModuleInfo } from '@open-mercato/shared/modules/registry'
import './commands'

export const metadata: ModuleInfo = {
  name: 'planner',
  title: 'Worktime / Availabilities',
  version: '0.1.0',
  description: 'Availability schedules, rulesets, and shared planning rules.',
  author: 'Open Mercato Team',
  license: 'Proprietary',
  ejectable: true,
}

export { features } from './acl'
