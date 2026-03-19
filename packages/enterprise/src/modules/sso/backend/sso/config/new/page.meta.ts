export const metadata = {
  requireAuth: true,
  requireFeatures: ['sso.config.manage'],
  pageTitle: 'Configure SSO',
  pageTitleKey: 'sso.admin.create.title',
  pageGroup: 'Auth',
  pageGroupKey: 'settings.sections.auth',
  pageOrder: 521,
  pageContext: 'settings' as const,
  navHidden: true,
  breadcrumb: [
    { label: 'Single Sign-On', labelKey: 'sso.admin.title', href: '/backend/sso' },
    { label: 'Configure SSO', labelKey: 'sso.admin.create.title' },
  ],
}
