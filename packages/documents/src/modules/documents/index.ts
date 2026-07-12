import type { ModuleInfo } from '@open-mercato/shared/modules/registry'
import './commands'

export const metadata: ModuleInfo = {
  name: 'documents',
  title: 'Documents',
  version: '0.1.0',
  description: 'Collaborative internal documents',
  author: 'Open Mercato',
  license: 'MIT',
  ejectable: true,
  requires: ['attachments'],
}

export { features } from './acl'
