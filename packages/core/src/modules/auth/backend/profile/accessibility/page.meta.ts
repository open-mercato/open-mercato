export const metadata = {
  requireAuth: true,
  navHidden: true,
  pageTitle: 'Accessibility',
  pageTitleKey: 'auth.accessibility.section_title',
  pageContext: 'profile' as const,
  breadcrumb: [
    { label: 'Profile', labelKey: 'profile.page.title', href: '/backend/profile' },
    { label: 'Accessibility', labelKey: 'auth.accessibility.section_title' },
  ],
}
