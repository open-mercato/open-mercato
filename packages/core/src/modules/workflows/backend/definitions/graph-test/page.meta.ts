export const metadata = {
  requireAuth: true,
  requireFeatures: ['workflows.view'],
  pageTitle: 'Workflow Graph Test',
  pageGroup: 'Workflows',
  pageGroupKey: 'workflows.module.name',
  pagePriority: 10,
  pageOrder: 999, // Test page - put at end
  breadcrumb: [
    { label: 'Workflows', labelKey: 'workflows.module.name' },
    { label: 'Graph Test', labelKey: 'workflows.nav.graphTest' },
  ],
}
