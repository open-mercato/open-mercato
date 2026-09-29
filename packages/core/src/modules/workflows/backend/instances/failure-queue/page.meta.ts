export const metadata = {
  requireAuth: true,
  requireFeatures: ['workflows.instances.view'],
  pageTitle: 'Failure Queue',
  pageTitleKey: 'workflows.failureQueue.title',
  pageGroup: 'Workflows',
  pageGroupKey: 'workflows.module.name',
  pagePriority: 20,
  pageOrder: 115,
  icon: 'triangle-alert',
  breadcrumb: [
    { label: 'Workflows', labelKey: 'workflows.module.name' },
    { label: 'Instances', labelKey: 'workflows.instances.plural' },
    { label: 'Failure Queue', labelKey: 'workflows.failureQueue.title' },
  ],
}
