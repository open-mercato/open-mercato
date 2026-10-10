import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'vehicle_rentals',
  title: 'Vehicle Rentals',
  version: '0.1.0',
  description: 'Bus and fleet rental: contracts with or without a driver, handover and return checks, and mileage-based billing.',
  author: 'Open Mercato Team',
  license: 'MIT',
  ejectable: true,
  requires: ['customers'],
}

export { features } from './acl'
