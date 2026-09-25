export const features = [
  { id: 'fleet.read', title: 'View fleet vehicles', module: 'fleet_management' },
  { id: 'fleet.write', title: 'Manage fleet vehicles', module: 'fleet_management', dependsOn: ['fleet.read'] },
  { id: 'fleet.assign', title: 'Assign and return vehicle custody', module: 'fleet_management', dependsOn: ['fleet.read'] },
  { id: 'fleet.admin', title: 'Administer fleet management', module: 'fleet_management', dependsOn: ['fleet.write', 'fleet.assign'] },
]

export default features
