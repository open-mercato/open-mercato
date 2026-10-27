import type { ModuleInfo } from '@open-mercato/shared/modules/registry'
import './commands'

export const metadata: ModuleInfo = {
  name: 'property_management',
  title: 'Property Management',
  version: '0.1.0',
  description: 'Buildings, floors, spaces and units for leased and bookable space.',
  author: 'Open Mercato Team',
  license: 'MIT',
  ejectable: true,
  requires: ['catalog', 'customers', 'sales'],
}

export { features } from './acl'
