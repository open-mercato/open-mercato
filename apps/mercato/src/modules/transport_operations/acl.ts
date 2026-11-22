export const features = [
  { id: 'transport.read', title: 'View transport operations', module: 'transport_operations' },
  { id: 'transport.write', title: 'Manage transport operations', module: 'transport_operations', dependsOn: ['transport.read'] },
  { id: 'transport.tracking.view', title: 'View the live tracking board', module: 'transport_operations', dependsOn: ['transport.read'] },
  { id: 'transport.telematics.ingest', title: 'Ingest telematics vehicle positions', module: 'transport_operations' },
  { id: 'transport.admin', title: 'Administer transport operations', module: 'transport_operations', dependsOn: ['transport.write'] },
]

export default features
