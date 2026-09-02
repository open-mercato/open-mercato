export const features = [
  { id: 'data_erasure.view', title: 'View privacy operations', module: 'data_erasure' },
  {
    id: 'data_erasure.manage',
    title: 'Manage privacy operations',
    module: 'data_erasure',
    dependsOn: ['data_erasure.view'],
  },
]

export default features
