export const metadata = {
  requireAuth: true,
  requireFeatures: ['security.profile.view'],
  navHidden: true,
  pageTitle: 'Security & MFA',
  pageTitleKey: 'security.profile.pageTitle',
  breadcrumb: [
    { label: 'Profile', labelKey: 'auth.profile.title' },
    { label: 'Security & MFA', labelKey: 'security.profile.pageTitle' },
  ],
}
