export const metadata = {
  requireAuth: true,
  requireFeatures: ['sso.config.view'],
  pageTitle: 'SSO Configuration',
  pageTitleKey: 'sso.admin.detail.title',
  pageGroup: 'Auth',
  pageGroupKey: 'settings.sections.auth',
  pageOrder: 522,
  pageContext: 'settings' as const,
  navHidden: true,
  breadcrumb: [
    { label: 'Single Sign-On', labelKey: 'sso.admin.title', href: '/backend/sso' },
    { label: 'Configuration', labelKey: 'sso.admin.detail.title' },
  ],
}
