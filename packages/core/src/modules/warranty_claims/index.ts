import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'warranty_claims',
  title: 'Warranty & RMA',
  version: '0.1.0',
  description: 'Warranty, return, core-return, and vendor-recovery claims desk.',
  author: 'Open Mercato',
  license: 'MIT',
  ejectable: true,
}

export { features } from './acl'
