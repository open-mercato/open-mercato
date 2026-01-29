export const metadata = {
  requireAuth: true,
  requireFeatures: ['workflows.view_tasks'],
  pageTitle: 'Task Details',
  pageTitleKey: 'workflows.tasks.singular',
  pageContext: 'settings' as const,
  breadcrumb: [
    { label: 'Workflows', labelKey: 'workflows.module.name', href: '/backend/workflows/definitions' },
    { label: 'Tasks', labelKey: 'workflows.tasks.plural', href: '/backend/workflows/tasks' },
    { label: 'Details', labelKey: 'common.details' },
  ],
}
