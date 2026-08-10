import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'document_generators',
  title: 'Document Generators',
  version: '0.1.0',
  description: 'Extensible document generation with built-in PDF templates.',
  author: 'Open Mercato Team',
  license: 'MIT',
}

export { features } from './acl'
export default metadata
