export const metadata = {
  requireAuth: true,
  requireFeatures: ['integrations.view'],
  pageContext: 'settings' as const,
  pageTitle: 'Bundle Configuration',
  pageTitleKey: 'integrations.bundle.title',
  navHidden: true,
  breadcrumb: [
    { label: 'Integrations', labelKey: 'integrations.nav.title', href: '/backend/integrations' },
  ],
}
