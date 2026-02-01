export const metadata = {
  requireAuth: true,
  requireFeatures: ['workflows.view_instances'],
  pageTitle: 'Workflow Instance Details',
  pageTitleKey: 'workflows.instances.singular',
  pageContext: 'settings' as const,
  breadcrumb: [
    { label: 'Workflows', labelKey: 'workflows.module.name', href: '/backend/definitions' },
    { label: 'Instances', labelKey: 'workflows.instances.plural', href: '/backend/instances' },
    { label: 'Details', labelKey: 'common.details' },
  ],
}
