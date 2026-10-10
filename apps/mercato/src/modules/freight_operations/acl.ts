export const features = [
  { id: 'freight.read', title: 'View freight operations', module: 'freight_operations' },
  { id: 'freight.orders.manage', title: 'Manage spot freight orders', module: 'freight_operations', dependsOn: ['freight.read'] },
  { id: 'freight.orders.invoice', title: 'Invoice spot freight orders', module: 'freight_operations', dependsOn: ['freight.orders.manage'] },
  { id: 'freight.contracts.manage', title: 'Manage freight contracts and rates', module: 'freight_operations', dependsOn: ['freight.read'] },
  { id: 'freight.trips.manage', title: 'Record and execute freight trips', module: 'freight_operations', dependsOn: ['freight.read'] },
  { id: 'freight.abstracts.generate', title: 'Generate trip abstracts', module: 'freight_operations', dependsOn: ['freight.read'] },
  { id: 'freight.abstracts.submit', title: 'Submit abstracts to customers', module: 'freight_operations', dependsOn: ['freight.abstracts.generate'] },
  { id: 'freight.abstracts.record_offline_approval', title: 'Record offline customer approvals', module: 'freight_operations', dependsOn: ['freight.abstracts.submit'] },
  { id: 'freight.abstracts.finalize', title: 'Finalize abstracts without customer approval', module: 'freight_operations', dependsOn: ['freight.abstracts.generate'] },
  { id: 'freight.abstracts.resolve', title: 'Resolve customer disputes', module: 'freight_operations', dependsOn: ['freight.abstracts.submit'] },
  { id: 'freight.abstracts.invoice', title: 'Issue invoices from abstracts', module: 'freight_operations', dependsOn: ['freight.abstracts.resolve'] },
  { id: 'freight.abstracts.manage', title: 'Cancel and delete abstracts', module: 'freight_operations', dependsOn: ['freight.abstracts.generate'] },
  { id: 'freight.payments.record', title: 'Record and void freight payments', module: 'freight_operations', dependsOn: ['freight.read'] },
  { id: 'freight.settings.manage', title: 'Manage freight settings', module: 'freight_operations', dependsOn: ['freight.read'] },
  { id: 'freight.admin', title: 'Administer freight operations', module: 'freight_operations', dependsOn: ['freight.settings.manage'] },
]

export default features
