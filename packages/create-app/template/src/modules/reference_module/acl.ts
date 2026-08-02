export const features = [
  { id: 'reference_module.view', title: 'View reference tasks', module: 'reference_module' },
  {
    id: 'reference_module.manage',
    title: 'Manage reference tasks',
    module: 'reference_module',
    dependsOn: ['reference_module.view'],
  },
  {
    id: 'reference_module.import',
    title: 'Import reference tasks',
    module: 'reference_module',
    dependsOn: ['reference_module.manage'],
  },
]

export default features
