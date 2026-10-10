export const features = [
  { id: 'rentals.read', title: 'View vehicle rentals', module: 'vehicle_rentals' },
  { id: 'rentals.manage', title: 'Create and edit rental contracts', module: 'vehicle_rentals', dependsOn: ['rentals.read'] },
  { id: 'rentals.handover', title: 'Hand over and return rental vehicles', module: 'vehicle_rentals', dependsOn: ['rentals.manage'] },
  { id: 'rentals.checks.manage', title: 'Record vehicle condition checks', module: 'vehicle_rentals', dependsOn: ['rentals.read'] },
  { id: 'rentals.admin', title: 'Administer vehicle rentals', module: 'vehicle_rentals', dependsOn: ['rentals.handover'] },
]

export default features
