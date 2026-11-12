export const features = [
  { id: 'dashboards.view', title: 'View dashboard', module: 'dashboards' },
  { id: 'dashboards.configure', title: 'Customize dashboard layout', module: 'dashboards' },
  { id: 'dashboards.admin.assign-widgets', title: 'Manage dashboard widget availability', module: 'dashboards' },
  { id: 'analytics.view', title: 'View analytics widgets', module: 'dashboards' },
  {
    id: 'dashboards.insights.view',
    title: 'View AI insights digest',
    module: 'dashboards',
    dependsOn: ['dashboards.view'],
  },
  {
    id: 'dashboards.catalog.view',
    title: 'Browse analytics catalog',
    module: 'dashboards',
    dependsOn: ['dashboards.view'],
  },
]

export default features
