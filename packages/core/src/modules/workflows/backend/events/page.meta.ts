export const metadata = {
  requireAuth: true,
  requireFeatures: ['workflows.view_logs'],
  pageTitle: 'Workflow Events',
  pageTitleKey: 'workflows.events.title',
  pageGroup: 'Workflows',
  pageGroupKey: 'workflows.module.name',
  pagePriority: 40,
  pageOrder: 130,
  icon: 'activity',
  breadcrumb: [
    { label: 'Workflows', labelKey: 'workflows.module.name' },
    { label: 'Events', labelKey: 'workflows.events.plural' },
  ],
}
