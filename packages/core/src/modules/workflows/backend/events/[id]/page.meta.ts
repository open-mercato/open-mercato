export const metadata = {
  requireAuth: true,
  requireFeatures: ['workflows.view_logs'],
  pageTitle: 'Event Details',
  pageTitleKey: 'workflows.events.detail.title',
  pageContext: 'settings' as const,
  breadcrumb: [
    { label: 'Workflows', labelKey: 'workflows.module.name', href: '/backend/definitions' },
    { label: 'Events', labelKey: 'workflows.events.plural', href: '/backend/events' },
    { label: 'Details', labelKey: 'common.details' },
  ],
}
