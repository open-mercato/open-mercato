export const features = [
  {
    id: 'progress.view',
    title: 'View progress jobs',
    module: 'progress',
  },
  {
    id: 'progress.create',
    title: 'Create progress jobs',
    module: 'progress',
    dependsOn: ['progress.view'],
  },
  {
    id: 'progress.update',
    title: 'Update progress jobs',
    module: 'progress',
    dependsOn: ['progress.view'],
  },
  {
    id: 'progress.cancel',
    title: 'Cancel progress jobs',
    module: 'progress',
    dependsOn: ['progress.view'],
  },
  {
    id: 'progress.manage',
    title: 'Manage all progress jobs',
    module: 'progress',
    dependsOn: ['progress.view'],
  },
]

export default features
