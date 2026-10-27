export const features = [
  { id: 'property_management.view', title: 'View buildings, floors and units', module: 'property_management' },
  {
    id: 'property_management.manage',
    title: 'Manage buildings, floors, spaces, units and settings',
    module: 'property_management',
    dependsOn: ['property_management.view'],
  },
  {
    id: 'property_management.buildings.manage_all',
    title: 'See and manage every building (not only assigned ones)',
    module: 'property_management',
    dependsOn: ['property_management.view'],
  },
  {
    id: 'property_management.availability.manage',
    title: 'Make buildings, floors, spaces and units unavailable',
    module: 'property_management',
    dependsOn: ['property_management.view'],
  },
  {
    id: 'property_management.leases.manage',
    title: 'Manage leases and lease proposals',
    module: 'property_management',
    dependsOn: ['property_management.view'],
  },
  {
    id: 'property_management.bookings.manage',
    title: 'Manage bookings',
    module: 'property_management',
    dependsOn: ['property_management.view'],
  },
]

export const portalFeatures = [
  'portal.property_bookings.view',
  'portal.property_bookings.manage',
  'portal.property_leases.view',
  'portal.property_leases.manage',
] as const

export default features
