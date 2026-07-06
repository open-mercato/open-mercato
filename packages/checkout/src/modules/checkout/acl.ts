export const features = [
  { id: 'checkout.view', title: 'View checkout links and transactions', module: 'checkout' },
  {
    id: 'checkout.create',
    title: 'Create checkout links and templates',
    module: 'checkout',
    dependsOn: ['checkout.view', 'sales.orders.view', 'customers.people.view'],
  },
  {
    id: 'checkout.edit',
    title: 'Edit checkout links and templates',
    module: 'checkout',
    dependsOn: ['checkout.view'],
  },
  {
    id: 'checkout.delete',
    title: 'Delete checkout links and templates',
    module: 'checkout',
    dependsOn: ['checkout.view'],
  },
  {
    id: 'checkout.viewPii',
    title: 'View checkout customer PII',
    module: 'checkout',
    dependsOn: ['checkout.view', 'customers.people.view'],
  },
  {
    id: 'checkout.export',
    title: 'Export checkout transactions',
    module: 'checkout',
    dependsOn: ['checkout.view'],
  },
]

export default features
