export const metadata = {
  requireAuth: true,
  requireFeatures: ['security.profile.view'],
  navHidden: true,
  pageTitleKey: 'security.profile.mfa.title',
  breadcrumb: [
    { label: 'Profile', labelKey: 'auth.profile.title' },
    { label: 'Security & MFA', labelKey: 'security.profile.pageTitle' },
    { label: 'Multi-factor authentication', labelKey: 'security.profile.mfa.title' },
  ],
}
