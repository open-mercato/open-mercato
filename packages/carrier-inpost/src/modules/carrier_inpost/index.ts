import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'carrier_inpost',
  title: 'InPost Carrier',
  description: 'Ship parcels via InPost lockers (Paczkomat) and courier delivery with tracking and webhook updates.',
  ejectable: true,
}

export { features } from './acl'

export default metadata
