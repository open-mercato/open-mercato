export const features = [
  {
    id: 'purchases.orders.view',
    title: 'View purchase orders',
    module: 'purchases',
    dependsOn: ['customers.people.view', 'catalog.products.view', 'currencies.view'],
  },
  {
    id: 'purchases.orders.manage',
    title: 'Manage purchase orders',
    module: 'purchases',
    dependsOn: ['purchases.orders.view'],
  },
  {
    id: 'purchases.orders.approve',
    title: 'Approve high-value purchase orders',
    module: 'purchases',
    dependsOn: ['purchases.orders.view'],
  },
  {
    id: 'purchases.settings.view',
    title: 'View purchase settings',
    module: 'purchases',
  },
  {
    id: 'purchases.settings.manage',
    title: 'Manage purchase settings',
    module: 'purchases',
    dependsOn: ['purchases.settings.view'],
  },
  {
    id: 'purchases.bills.view',
    title: 'View purchase bills',
    module: 'purchases',
    dependsOn: ['purchases.orders.view'],
  },
  {
    id: 'purchases.bills.manage',
    title: 'Manage vendor bills and 3-way matching',
    module: 'purchases',
    dependsOn: ['purchases.bills.view'],
  },
  {
    id: 'purchases.reordering.view',
    title: 'View reordering rules',
    module: 'purchases',
    dependsOn: ['purchases.orders.view'],
  },
  {
    id: 'purchases.reordering.manage',
    title: 'Manage reordering rules and run replenishment',
    module: 'purchases',
    dependsOn: ['purchases.reordering.view'],
  },
  {
    id: 'purchases.vendors.view',
    title: 'View vendors',
    module: 'purchases',
  },
  {
    id: 'purchases.vendors.manage',
    title: 'Manage vendors',
    module: 'purchases',
    dependsOn: ['purchases.vendors.view'],
  },
] as const

export default features
