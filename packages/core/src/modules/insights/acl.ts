export const features = [
  { id: 'insights.explain.view', title: 'Explain record values', module: 'insights' },
  {
    id: 'insights.explain.access_detail',
    title: 'View access explanation details',
    module: 'insights',
    dependsOn: ['insights.explain.view'],
  },
  { id: 'insights.xray.view', title: 'View Process X-Ray', module: 'insights' },
  {
    id: 'insights.xray.manage',
    title: 'Manage Process X-Ray',
    module: 'insights',
    dependsOn: ['insights.xray.view'],
  },
  {
    id: 'insights.xray.view_individuals',
    title: 'View Process X-Ray per-person breakdowns',
    module: 'insights',
    dependsOn: ['insights.xray.view'],
  },
  { id: 'insights.simulator.view', title: 'View own change simulations', module: 'insights' },
  {
    id: 'insights.simulator.run',
    title: 'Run change simulations',
    module: 'insights',
    dependsOn: ['insights.simulator.view'],
  },
]

export default features
