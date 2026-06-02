export const features = [
  {
    id: 'example_customers_sync.view',
    title: 'View Example customer sync diagnostics',
    module: 'example_customers_sync',
    dependsOn: ['customers.people.view'],
  },
  {
    id: 'example_customers_sync.manage',
    title: 'Manage Example customer sync',
    module: 'example_customers_sync',
    dependsOn: ['example_customers_sync.view'],
  },
]

export default features
