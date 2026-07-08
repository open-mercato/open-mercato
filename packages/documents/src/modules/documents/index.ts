import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'documents',
  title: 'Documents',
  version: '0.1.0',
  description: 'Collaborative internal documents',
  author: 'Open Mercato',
  license: 'MIT',
  ejectable: true,
}

export { features } from './acl'
