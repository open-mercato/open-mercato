import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

const buildingManagerFeatures = [
  'property_management.view',
  'property_management.manage',
  'property_management.availability.manage',
  'property_management.leases.manage',
  'property_management.bookings.manage',
]

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    admin: ['property_management.*'],
    employee: buildingManagerFeatures,
  },
  defaultCustomerRoleFeatures: {
    buyer: ['portal.property_bookings.view', 'portal.property_bookings.manage', 'portal.property_leases.view'],
    viewer: ['portal.property_bookings.view', 'portal.property_leases.view'],
  },
}

export default setup
