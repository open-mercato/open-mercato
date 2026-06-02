export const features = [
  { id: 'resources.view', title: 'View resources', module: 'resources' },
  {
    id: 'resources.manage_resources',
    title: 'Manage resources',
    module: 'resources',
    dependsOn: ['resources.view'],
  },
]

export default features
