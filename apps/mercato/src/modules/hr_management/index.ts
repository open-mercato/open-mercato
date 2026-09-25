import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'hr_management',
  title: 'HR Management & Approvals',
  version: '0.1.0',
  description: 'Human resources: departments, employees, driver profiles, attendance, leave, documents, and a generic approvals engine.',
  author: 'Open Mercato Team',
  license: 'MIT',
  ejectable: true,
}

export { features } from './acl'
