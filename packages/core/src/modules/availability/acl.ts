export const features = [
  { id: 'availability.policies.view', title: 'View availability policies', module: 'availability' },
  {
    id: 'availability.policies.manage',
    title: 'Manage availability policies',
    module: 'availability',
    dependsOn: ['availability.policies.view'],
  },
  { id: 'availability.check', title: 'Run availability checks', module: 'availability' },
]

export default features
