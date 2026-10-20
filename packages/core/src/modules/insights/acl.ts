export const features = [
  { id: 'insights.explain.view', title: 'Explain record values', module: 'insights' },
  {
    id: 'insights.explain.access_detail',
    title: 'View access explanation details',
    module: 'insights',
    dependsOn: ['insights.explain.view'],
  },
]

export default features
