import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'transport_operations',
  title: 'Transport & Fleet Operations',
  version: '0.1.0',
  description: 'Fleet operations: vehicles, drivers, routes, and trip scheduling.',
  author: 'Open Mercato Team',
  license: 'MIT',
  ejectable: true,
}

export { features } from './acl'
