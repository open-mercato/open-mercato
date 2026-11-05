export const metadata = {
  requireAuth: true,
  requireFeatures: ['workflows.view_tasks'],
  pageTitle: 'Task Details',
  pageTitleKey: 'workflows.tasks.singular',
  breadcrumb: [
    { label: 'Workflows', labelKey: 'workflows.module.name', href: '/backend/definitions' },
    { label: 'Tasks', labelKey: 'workflows.tasks.plural', href: '/backend/tasks' },
    { label: 'Details', labelKey: 'common.details' },
  ],
}
