export const features = [
  { id: 'ecommerce.stores.view', title: 'View stores', module: 'ecommerce' },
  { id: 'ecommerce.stores.manage', title: 'Manage stores', module: 'ecommerce', dependsOn: ['ecommerce.stores.view'] },
  { id: 'ecommerce.branding.manage', title: 'Manage store branding', module: 'ecommerce', dependsOn: ['ecommerce.stores.view'] },
  { id: 'ecommerce.domains.manage', title: 'Manage store domain bindings', module: 'ecommerce', dependsOn: ['ecommerce.stores.view'] },
  { id: 'ecommerce.channels.manage', title: 'Manage store channel bindings', module: 'ecommerce', dependsOn: ['ecommerce.stores.view'] },
]

export default features
