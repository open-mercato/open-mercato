export const metadata = {
  requireAuth: true,
  requireFeatures: ['integrations.view'],
  pageContext: 'settings' as const,
  pageTitle: 'Integration Detail',
  pageTitleKey: 'integrations.detail.title',
  navHidden: true,
  breadcrumb: [
    { label: 'Integrations', labelKey: 'integrations.nav.title', href: '/backend/integrations' },
  ],
}
