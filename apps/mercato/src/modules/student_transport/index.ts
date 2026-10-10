import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'student_transport',
  title: 'Student Transport',
  version: '0.1.0',
  description: 'School transport: subscription plans, per-student subscriptions with B2C/B2B billing, and daily boarding attendance.',
  author: 'Open Mercato Team',
  license: 'MIT',
  ejectable: true,
  requires: ['customers'],
}

export { features } from './acl'
