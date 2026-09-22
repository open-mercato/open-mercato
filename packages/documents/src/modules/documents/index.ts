import type { ModuleInfo } from '@open-mercato/shared/modules/registry'
import './commands'

export const metadata: ModuleInfo = {
  name: 'documents',
  title: 'Documents',
  version: '0.1.0',
  description: 'Collaborative internal documents',
  author: 'Open Mercato',
  license: 'MIT',
  // The collaboration sidecar resolves package-owned entities and services.
  // Keep ejection disabled until it can load an app-ejected implementation.
  ejectable: false,
  requires: ['auth', 'directory', 'attachments'],
}

export { features } from './acl'
