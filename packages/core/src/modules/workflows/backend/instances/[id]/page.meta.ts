export const metadata = {
  requireAuth: true,
  requireFeatures: ['workflows.instances.view'],
  pageTitle: 'Workflow Instance Details',
  pageTitleKey: 'workflows.instances.singular',
  breadcrumb: [
    { label: 'Workflows', labelKey: 'workflows.module.name', href: '/backend/definitions' },
    { label: 'Instances', labelKey: 'workflows.instances.plural', href: '/backend/instances' },
    { label: 'Details', labelKey: 'common.details' },
  ],
}
