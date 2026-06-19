export const features = [
  {
    id: 'sales.orders.view',
    title: 'View sales orders',
    module: 'sales',
    dependsOn: [
      'sales.channels.view',
      'sales.settings.view',
      'customers.people.view',
      'catalog.products.view',
      'currencies.view',
    ],
  },
  {
    id: 'sales.orders.manage',
    title: 'Manage sales orders',
    module: 'sales',
    dependsOn: ['sales.orders.view'],
  },
  {
    id: 'sales.orders.approve',
    title: 'Approve sales orders',
    module: 'sales',
    dependsOn: ['sales.orders.view'],
  },
  {
    id: 'sales.widgets.new-orders',
    title: 'View new orders widget',
    module: 'sales',
    dependsOn: ['sales.orders.view'],
  },
  {
    id: 'sales.widgets.new-quotes',
    title: 'View new quotes widget',
    module: 'sales',
    dependsOn: ['sales.quotes.view'],
  },
  {
    id: 'sales.quotes.view',
    title: 'View sales quotes',
    module: 'sales',
    dependsOn: [
      'sales.channels.view',
      'sales.settings.view',
      'customers.people.view',
      'catalog.products.view',
    ],
  },
  {
    id: 'sales.quotes.manage',
    title: 'Manage sales quotes',
    module: 'sales',
    dependsOn: ['sales.quotes.view'],
  },
  {
    id: 'sales.documents.number.edit',
    title: 'Edit sales document numbers',
    module: 'sales',
    dependsOn: ['sales.orders.view'],
  },
  {
    id: 'sales.shipments.manage',
    title: 'Manage order shipments',
    module: 'sales',
    dependsOn: ['sales.orders.view', 'shipping_carriers.view'],
  },
  {
    id: 'sales.payments.manage',
    title: 'Manage order payments',
    module: 'sales',
    dependsOn: ['sales.orders.view', 'payment_gateways.view'],
  },
  {
    id: 'sales.returns.view',
    title: 'View order returns',
    module: 'sales',
    dependsOn: ['sales.orders.view'],
  },
  {
    id: 'sales.returns.create',
    title: 'Create order returns',
    module: 'sales',
    dependsOn: ['sales.returns.view', 'sales.orders.manage'],
  },
  {
    id: 'sales.returns.manage',
    title: 'Edit and delete order returns',
    module: 'sales',
    dependsOn: ['sales.returns.create'],
  },
  {
    id: 'sales.invoices.manage',
    title: 'Manage sales invoices',
    module: 'sales',
    dependsOn: ['sales.orders.view'],
  },
  {
    id: 'sales.credit_memos.manage',
    title: 'Manage credit memos',
    module: 'sales',
    dependsOn: ['sales.invoices.manage'],
  },
  { id: 'sales.channels.view', title: 'View sales channels', module: 'sales' },
  {
    id: 'sales.channels.manage',
    title: 'Manage sales channels',
    module: 'sales',
    dependsOn: ['sales.channels.view'],
  },
  { id: 'sales.settings.view', title: 'View sales configuration', module: 'sales' },
  {
    id: 'sales.settings.manage',
    title: 'Manage sales configuration',
    module: 'sales',
    dependsOn: ['sales.settings.view'],
  },
]

export default features
