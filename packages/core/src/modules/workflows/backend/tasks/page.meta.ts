export const metadata = {
  requireAuth: true,
  requireFeatures: ['workflows.view_tasks'],
  pageTitle: 'User Tasks',
  pageTitleKey: 'workflows.tasks.title',
  pageGroup: 'Workflows',
  pageGroupKey: 'workflows.module.name',
  pagePriority: 30,
  pageOrder: 120,
  icon: 'check-square',
  breadcrumb: [
    { label: 'Workflows', labelKey: 'workflows.module.name' },
    { label: 'Tasks', labelKey: 'workflows.tasks.plural' },
  ],
}
