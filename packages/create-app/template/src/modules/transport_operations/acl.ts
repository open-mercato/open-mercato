export const features = [
  { id: 'transport.read', title: 'View transport operations', module: 'transport_operations' },
  { id: 'transport.write', title: 'Manage transport operations', module: 'transport_operations', dependsOn: ['transport.read'] },
  { id: 'transport.admin', title: 'Administer transport operations', module: 'transport_operations', dependsOn: ['transport.write'] },
]

export default features
