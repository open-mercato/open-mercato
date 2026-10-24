import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'gus_regon',
  title: 'GUS REGON Company Lookup',
  description: 'Autofill Polish company name and registered address by NIP from the GUS REGON registry (BIR1).',
  ejectable: true,
  requires: ['integrations'],
}

export { features } from './acl'

export default metadata
