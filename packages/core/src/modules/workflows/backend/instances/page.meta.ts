export const metadata = {
  requireAuth: true,
  requireFeatures: ['workflows.view_instances'],
  pageTitle: 'Workflow Instances',
  pageTitleKey: 'workflows.instances.title',
  pageGroup: 'Workflows',
  pageGroupKey: 'workflows.module.name',
  pagePriority: 20,
  pageOrder: 110,
  icon: 'wrench',
  breadcrumb: [
    { label: 'Workflows', labelKey: 'workflows.module.name' },
    { label: 'Instances', labelKey: 'workflows.instances.plural' },
  ],
}
