export const metadata = {
  requireAuth: true,
  navHidden: true,
  pageTitle: 'Change Password',
  pageTitleKey: 'auth.changePassword.title',
  pageContext: 'profile' as const,
  breadcrumb: [
    { label: 'Profile', labelKey: 'profile.page.title', href: '/backend/profile' },
    { label: 'Change Password', labelKey: 'auth.changePassword.title' },
  ],
}
