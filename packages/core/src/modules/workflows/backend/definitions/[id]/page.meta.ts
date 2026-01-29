export const metadata = {
  requireAuth: true,
  requireFeatures: ['workflows.view'],
  pageTitle: 'Edit Workflow Definition',
  pageTitleKey: 'workflows.edit.title',
  pageContext: 'settings' as const,
  breadcrumb: [
    { label: 'Workflows', labelKey: 'workflows.module.name', href: '/backend/workflows/definitions' },
    { label: 'Edit', labelKey: 'workflows.common.edit' },
  ],
}
