export const metadata = {
  requireAuth: true,
  requireFeatures: ['security.profile.view'],
  navHidden: true,
  pageTitleKey: 'security.profile.mfa.recovery.title',
  breadcrumb: [
    { label: 'Profile', labelKey: 'auth.profile.title' },
    { label: 'Security & MFA', labelKey: 'security.profile.pageTitle' },
    { label: 'Multi-factor authentication', labelKey: 'security.profile.mfa.title', href: '/backend/profile/security/mfa' },
    { label: 'Recovery codes', labelKey: 'security.profile.mfa.recovery.title' },
  ],
}
